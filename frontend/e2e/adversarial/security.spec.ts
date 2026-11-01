import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { storageStatePath } from "../fixtures";

// ════════════════════════════════════════════════════════════════════
// Security · HTTP level, against the production build
//
//   - no secret is baked into anything the browser downloads
//   - no public source maps
//   - a Server Action replayed with a foreign Origin is refused, and the
//     same action replayed with NO session refuses to run (the guard is
//     in the action, not just in the page that renders its button)
//   - the GitHub OAuth start/callback pair cannot be steered off-site or
//     completed with a forged state
// ════════════════════════════════════════════════════════════════════

const STATIC_DIR = join(process.cwd(), ".next", "static");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Decode a JWT payload without verifying it; null if it isn't one. */
function jwtRole(tok: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(tok.split(".")[1]!, "base64url").toString("utf8"));
    return typeof payload.role === "string" ? payload.role : "";
  } catch {
    return null;
  }
}

test.describe("what the browser downloads", () => {
  test("no secret, DSN or service-role key is in the client bundle", () => {
    const files = walk(STATIC_DIR).filter((f) => /\.(js|css|html|json|txt)$/.test(f));
    expect(files.length, "bundle not found; was the app built?").toBeGreaterThan(10);

    // The actual secret values this process knows about. They are only
    // compared, never printed.
    const secrets = [
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      process.env.UPSTASH_REDIS_REST_TOKEN,
      process.env.RESEND_API_KEY,
      process.env.CRON_SECRET,
      process.env.TURNSTILE_SECRET_KEY,
    ].filter((v): v is string => !!v && v.length >= 12);

    const patterns: [string, RegExp][] = [
      ["OpenAI-style key", /sk-[A-Za-z0-9_-]{20,}/],
      ["Resend key", /\bre_[A-Za-z0-9]{20,}/],
      ["Postgres DSN", /postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/],
      ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
      ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
      ["Slack/Stripe-style secret", /\b(?:xox[bap]-|sk_live_|rk_live_)[A-Za-z0-9-]{10,}/],
    ];

    const found: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      const rel = f.slice(STATIC_DIR.length + 1);
      for (const s of secrets) if (text.includes(s)) found.push(`${rel}: contains a known server secret`);
      for (const [label, re] of patterns) if (re.test(text)) found.push(`${rel}: ${label}`);
      // Any JWT in the bundle must be the public anon key, never service_role.
      for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
        const role = jwtRole(m[0]);
        if (role === "service_role") found.push(`${rel}: a service_role JWT`);
      }
    }
    expect(found, found.join("\n")).toEqual([]);
  });

  test("source maps are not shipped or served", async ({ request }) => {
    const maps = walk(STATIC_DIR).filter((f) => f.endsWith(".map"));
    expect(maps.map((f) => f.slice(STATIC_DIR.length + 1))).toEqual([]);

    const js = walk(STATIC_DIR).find((f) => f.endsWith(".js"))!;
    const url = "/_next/static/" + js.slice(STATIC_DIR.length + 1).split("\\").join("/") + ".map";
    const r = await request.get(url, { maxRedirects: 0 });
    expect(r.status(), `${url} is served`).toBeGreaterThanOrEqual(400);
  });
});

test.describe("server actions", () => {
  // Capture a real, read-only admin action (the graduates preview) from the
  // UI so its action id and body are genuine, then replay it hostilely.
  async function capture(browser: import("@playwright/test").Browser) {
    const ctx = await browser.newContext({ storageState: storageStatePath("admin") });
    const page = await ctx.newPage();
    const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.headers()["next-action"]) {
        seen.push({ url: req.url(), headers: req.headers(), body: req.postData() ?? "" });
      }
    });
    await page.goto("/admin/graduates");
    await page.getByLabel("Cutoff graduation year").fill("1950");
    await page.getByRole("button", { name: "Preview who will be asked" }).click();
    await expect.poll(() => seen.length, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.getByText(/will be asked|No students|nobody/i).first().waitFor({ timeout: 15_000 }).catch(() => {});
    return { ctx, req: seen[0]! };
  }

  const FORWARD = ["next-action", "content-type", "next-router-state-tree", "accept"];
  const pick = (h: Record<string, string>, extra: Record<string, string> = {}) => ({
    ...Object.fromEntries(FORWARD.filter((k) => h[k]).map((k) => [k, h[k]!])),
    ...extra,
  });

  test("a foreign Origin is refused; the same call from the app's own origin runs", async ({ browser, baseURL }) => {
    const { ctx, req } = await capture(browser);
    try {
      const own = await ctx.request.post(req.url, {
        headers: pick(req.headers, { origin: new URL(baseURL!).origin }),
        data: req.body,
      });
      expect(own.status(), "control: the genuine call should work").toBeLessThan(400);
      expect(await own.text(), "control: the genuine call should return the admin result").toMatch(/"ok":true/);

      for (const origin of ["https://evil.example", "http://localhost:1", "null"]) {
        const r = await ctx.request.post(req.url, { headers: pick(req.headers, { origin }), data: req.body });
        const text = await r.text();
        expect(
          r.status() >= 400 || /Invalid Server Actions request/i.test(text),
          `Origin ${origin} was accepted (status ${r.status()})`,
        ).toBe(true);
        expect(text, `Origin ${origin} reached the action`).not.toMatch(/"ok":true/);
      }
    } finally {
      await ctx.close();
    }
  });

  test("the same action with no session does not run", async ({ browser, baseURL, playwright }) => {
    const { ctx, req } = await capture(browser);
    try {
      const bare = await playwright.request.newContext({ baseURL });
      const r = await bare.post(req.url, {
        headers: pick(req.headers, { origin: new URL(baseURL!).origin }),
        data: req.body,
      });
      const text = await r.text();
      // Either the proxy bounces to /login, the action returns its auth error,
      // or the framework rejects it — but it must not return the admin payload.
      expect(text, "an unauthenticated replay returned the admin result").not.toMatch(/"ok":true/);
      expect(r.status()).toBeLessThan(500);
      await bare.dispose();
    } finally {
      await ctx.close();
    }
  });
});

test.describe("GitHub OAuth", () => {
  test("start only ever redirects to github.com, whatever returnTo says", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath("student") });
    try {
      for (const returnTo of ["profile", "intake", "//evil.example", "https://evil.example", "../../etc", "x".repeat(3000)]) {
        const r = await ctx.request.get(`/auth/github-connect/start?returnTo=${encodeURIComponent(returnTo)}`, { maxRedirects: 0 });
        expect(r.status()).toBeLessThan(500);
        const loc = r.headers().location;
        if (!loc) continue;
        const host = new URL(loc, "http://app.local").host;
        // GitHub, or the app itself (its configured site URL, which is
        // localhost rather than 127.0.0.1 here). Locally no GitHub client id is
        // set, so the error redirect is what is reachable; the github.com leg is
        // a residual risk in the register.
        expect(["github.com", "app.local", "localhost:3000", "127.0.0.1:3000"], `returnTo=${returnTo.slice(0, 20)} -> ${loc.slice(0, 80)}`).toContain(host);
      }
    } finally {
      await ctx.close();
    }
  });

  test("a callback with a forged or missing state is refused and connects nothing", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath("student") });
    try {
      for (const q of ["code=abc&state=forged", "code=abc", "state=forged", "code=abc&state=" + "A".repeat(2000)]) {
        const r = await ctx.request.get(`/auth/github-connect/callback?${q}`, { maxRedirects: 0 });
        expect(r.status(), q.slice(0, 40)).toBeLessThan(500);
        const loc = r.headers().location ?? "";
        expect(loc, `${q.slice(0, 40)} did not report an error`).toMatch(/github=error|\/login|\/profile|\/intake/);
        expect(loc).not.toMatch(/github=connected|github=success/);
      }
    } finally {
      await ctx.close();
    }
  });
});
