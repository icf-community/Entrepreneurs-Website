import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCsp, generateNonce, buildStaticCsp, STATIC_CSP_ROUTES } from "./csp";
import { config as proxyConfig } from "@/proxy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("generateNonce", () => {
  it("produces a unique base64 string each call", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/=]+$/);
    // 16 random bytes -> 24 base64 chars (incl. padding).
    expect(a.length).toBe(24);
  });
});

describe("buildCsp — strict-dynamic is production-only", () => {
  // strict-dynamic is dropped in development so Turbopack's un-nonced HMR
  // chunks stop being blocked (see buildCsp for the full reasoning). The
  // concession must never reach production: without strict-dynamic the
  // `https:` fallback token becomes live, and the policy degrades from
  // "only what the nonce vouches for" to "anything over https".
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps strict-dynamic when NODE_ENV is production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const csp = buildCsp("ABC123");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it("drops strict-dynamic in development, but still emits the nonce", () => {
    vi.stubEnv("NODE_ENV", "development");
    const csp = buildCsp("ABC123");
    expect(csp).not.toContain("'strict-dynamic'");
    expect(csp).toContain("'nonce-ABC123'");
    // 'self' is what has to become effective again for the dev chunks to load.
    expect(csp).toContain("script-src 'self' 'nonce-ABC123'");
  });
});

describe("buildCsp", () => {
  it("embeds the nonce and strict-dynamic in script-src", () => {
    const csp = buildCsp("ABC123");
    expect(csp).toContain("script-src 'self' 'nonce-ABC123' 'strict-dynamic'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("derives Supabase https + wss origins from the env URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcxyz.supabase.co");
    const csp = buildCsp("n");
    expect(csp).toContain("https://abcxyz.supabase.co");
    expect(csp).toContain("wss://abcxyz.supabase.co");
  });

  it("allows the PostHog host + its sibling assets host", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com");
    const csp = buildCsp("n");
    expect(csp).toContain("https://eu.i.posthog.com");
    expect(csp).toContain("https://eu-assets.i.posthog.com");
  });

  it("allows the Sentry ingest origin parsed from the DSN", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://abc123@o4509.ingest.de.sentry.io/123");
    const csp = buildCsp("n");
    expect(csp).toContain("https://o4509.ingest.de.sentry.io");
  });

  it("always allows the Turnstile host in frame-src and connect-src", () => {
    const csp = buildCsp("n");
    expect(csp).toContain("frame-src https://challenges.cloudflare.com");
    expect(csp).toMatch(/connect-src[^;]*https:\/\/challenges\.cloudflare\.com/);
  });

  it("omits unset optional origins without leaving empty tokens", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    const csp = buildCsp("n");
    // No double spaces or dangling 'null' from filtered-out origins.
    expect(csp).not.toContain("  ");
    expect(csp).not.toContain("null");
  });
});

// ─── Static (nonce-free) policy for pure-content public routes ─────────
describe("buildStaticCsp", () => {
  it("keeps every protective directive the strict policy has", () => {
    const strict = buildCsp("abc123");
    const staticCsp = buildStaticCsp();
    for (const directive of [
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
      "default-src 'self'",
    ]) {
      expect(strict).toContain(directive);
      expect(staticCsp).toContain(directive);
    }
  });

  it("carries no nonce — that is the whole point", () => {
    // A per-request nonce is what forces per-request rendering and a
    // middleware invocation. These routes exist to avoid both.
    expect(buildStaticCsp()).not.toContain("nonce-");
    expect(buildStaticCsp()).not.toContain("strict-dynamic");
  });

  it("is the ONLY place unsafe-inline scripts are allowed, and only here", () => {
    expect(buildStaticCsp()).toContain("script-src 'self' 'unsafe-inline'");
  });

  it("stays in sync with the middleware matcher", () => {
    // proxy.ts's matcher must exclude exactly the routes that get their
    // CSP from next.config instead. A route in one list but not the other
    // either ships with no policy at all, or keeps paying for the Auth
    // round trip this was meant to remove.
    for (const route of STATIC_CSP_ROUTES) {
      if (route === "/") {
        // "/" is excluded by the `$` alternative in the lookahead, not by
        // a literal segment. Asserted explicitly because the generic check
        // below is vacuous for it: "/".replace("/", "") is the empty
        // string, and toContain("") passes against anything.
        expect(proxyConfig.matcher[0]).toContain("|$|");
        continue;
      }
      expect(proxyConfig.matcher[0]).toContain(route.replace("/", ""));
    }
  });

  it("covers only routes that render no user-supplied content", () => {
    // A guard against someone adding /login or /contact here later: both
    // are public, but both take user input, so both must keep the strict
    // nonce policy.
    expect(STATIC_CSP_ROUTES).not.toContain("/login");
    expect(STATIC_CSP_ROUTES).not.toContain("/contact");
  });

  // "/" was on the forbidden list above until 2026-09-08, bundled in with
  // /login and /contact although the comment's reasoning ("both take user
  // input") never applied to it. It was added to STATIC_CSP_ROUTES for
  // C2 Finding 6 — it is the app's most-requested route and measured its
  // slowest, 12.3 s p95 at 500 VUs, entirely render cost against no data.
  //
  // Deleting that assertion removed a guard, so this replaces it with one
  // that checks the property the assertion was standing in for, rather
  // than the spelling of a route. The homepage qualifies only while it
  // renders nothing attacker-controlled; the weaker static policy allows
  // 'unsafe-inline', so the day someone adds a search box or an enquiry
  // form to the landing page, this must fail and "/" must come off the
  // list.
  it("the homepage renders no user-supplied content, as its static CSP requires", () => {
    const dir = join(process.cwd(), "src");
    const homepage = readFileSync(join(dir, "app/page.tsx"), "utf8");
    const components = [
      "Navbar", "Hero", "WhoWeAre", "Community", "Opportunities", "Events", "Apply", "Footer",
    ].map((name) => readFileSync(join(dir, `components/${name}.tsx`), "utf8"));

    // Comments are stripped first, or the test fails on prose: page.tsx's
    // own header explains that nothing there may read cookies(), and a
    // naive search finds that sentence. A guard that trips on its own
    // documentation gets deleted rather than fixed.
    const stripComments = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    for (const source of [homepage, ...components].map(stripComments)) {
      // Any input surface, or any read of the query string, would put
      // attacker-controlled bytes into a page served 'unsafe-inline'.
      expect(source).not.toMatch(/<form|<input|<textarea|useSearchParams|searchParams/);
      // A session or database read would also make it dynamic again,
      // silently undoing the fix.
      expect(source).not.toMatch(/createClient|getUser\(|cookies\(\)/);
    }
  });
});
