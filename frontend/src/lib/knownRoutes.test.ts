import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { isKnownRoute } from "./knownRoutes";
import { buildStaticCsp } from "./csp";

const updateSession = vi.fn(async () => new Response("strict", { headers: { "content-security-policy": "strict-nonce-policy" } }));
vi.mock("@/lib/supabase/proxy", () => ({ updateSession: (...a: unknown[]) => (updateSession as (...x: unknown[]) => unknown)(...a) }));

const APP = join(__dirname, "..", "app");

// ── The set must cover every route, or that route silently gets the WEAK policy ──
// An unknown first segment is served the nonce-free static CSP (script-src
// 'unsafe-inline') so the prerendered 404 can hydrate. That is only safe
// while the set really lists every route that renders anything dynamic: a
// route missing from it would be served with the weaker policy and no
// session refresh. So this test reads the app directory and fails the build
// the moment a route folder is added without being listed.
describe("KNOWN_ROUTE_SEGMENTS covers the app directory", () => {
  const entries = readdirSync(APP).filter((n) => statSync(join(APP, n)).isDirectory());

  it("has no route groups or parallel routes the first-segment rule would mis-read", () => {
    // (group) folders do not appear in the URL, @slot folders neither; the
    // first-segment check would be wrong for their children. Make whoever
    // adds one revisit knownRoutes.ts deliberately.
    expect(entries.filter((n) => /^[(@]/.test(n))).toEqual([]);
  });

  it.each(entries.filter((n) => !n.startsWith("_")))("lists /%s", (dir) => {
    expect(isKnownRoute(`/${dir}`), `/${dir} must be in KNOWN_ROUTE_SEGMENTS`).toBe(true);
  });

  it("lists the metadata routes generated from files in app/", () => {
    for (const p of ["/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/icon.png", "/apple-icon.png", "/favicon.ico"]) {
      expect(isKnownRoute(p), p).toBe(true);
    }
  });
});

describe("isKnownRoute", () => {
  it("treats the root and any depth under a known segment as known", () => {
    expect(isKnownRoute("/")).toBe(true);
    expect(isKnownRoute("/events/abc/def/ghi")).toBe(true);
    expect(isKnownRoute("/admin/anything")).toBe(true);
  });
  it("treats clean junk as unknown", () => {
    for (const p of ["/definitely-not-a-route", "/.env", "/wp-admin/setup.php", "//evil.example", "/ events", "/zzz/a/b"]) {
      expect(isKnownRoute(p), p).toBe(false);
    }
  });
  // The weak policy must never reach a real page through an alternative
  // spelling of its URL. Next decodes the path before routing, so the check
  // must see the same thing; anything that could be a known route, or that
  // cannot be read at all, fails CLOSED (strict policy).
  it.each([
    "/%65vents", "/e%76ents/x", "/%2565vents", "/%252565vents", "/events%2Fx", "/Events", "/ADMIN/ai", "//events", "///admin/ai",
    "/\\events", "/./events", "/events/../events", "/foo/../events", "/%2e/events", "/%2E%2E/events", "/%E0%A4%A", "/%", "/%00events",
    "/%u0065vents",
  ])("fails closed for the alternative spelling %s", (p) => {
    expect(isKnownRoute(p), p).toBe(true);
  });
  it("is not fooled by inherited object keys", () => {
    for (const p of ["/constructor", "/__proto__", "/toString", "/hasOwnProperty"]) expect(isKnownRoute(p), p).toBe(false);
  });
});

// ── What the proxy does with them ──
describe("proxy: unknown first segment", () => {
  beforeEach(() => updateSession.mockClear());

  it("serves the nonce-free static policy and skips the session refresh (GET)", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(new NextRequest("http://localhost:3000/definitely-not-a-route"));
    expect(res.headers.get("content-security-policy")).toBe(buildStaticCsp());
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("still runs the full proxy (rate-limit backstop) for a mutation to an unknown path", async () => {
    const { proxy } = await import("@/proxy");
    await proxy(new NextRequest("http://localhost:3000/definitely-not-a-route", { method: "POST" }));
    expect(updateSession).toHaveBeenCalledTimes(1);
  });

  it.each(["/events/abc", "/admin/ai", "/login", "/api/ai/turns/x", "/members?skill=1"])("keeps the strict nonce policy for %s", async (path) => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(new NextRequest(`http://localhost:3000${path}`));
    expect(res.headers.get("content-security-policy")).toBe("strict-nonce-policy");
    expect(updateSession).toHaveBeenCalledTimes(1);
  });

  it("ignores a client-sent x-nonce / CSP request header (only the server sets them)", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(new NextRequest("http://localhost:3000/definitely-not-a-route", {
      headers: { "x-nonce": "attacker", "content-security-policy": "script-src *" },
    }));
    expect(res.headers.get("content-security-policy")).toBe(buildStaticCsp());
  });
});

// The weak policy must never meet user-controlled content. The 404 page is the
// only thing it serves for unknown paths, so pin that it reads no request data.
describe("not-found.tsx renders no user content", () => {
  it("reads no request data and injects no HTML", () => {
    const text = readFileSync(join(APP, "not-found.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(text).not.toMatch(/searchParams|useSearchParams|usePathname|cookies\(|headers\(|createClient|supabase|fetch\(|localStorage|dangerouslySetInnerHTML/);
  });
});
