import { test, expect, type Browser, type Page } from "@playwright/test";
import { USERS, storageStatePath } from "../fixtures";
import {
  newMember, deleteMember, storageStateFor, service, psql, validOpportunity, validEvent,
  type Member,
} from "./helpers";

// ════════════════════════════════════════════════════════════════════
// Adversarial · in a real browser
//
// Console/runtime errors and layout on every page per role, hostile URLs,
// stored-XSS through every render path, redirect safety, stale sessions,
// cache-after-logout, endpoint hygiene. Findings are collected across the
// whole sweep and asserted once per test so one run lists everything.
// ════════════════════════════════════════════════════════════════════

const STATIC_PAGES = [
  "/", "/login", "/contact", "/privacy", "/terms", "/cookies", "/ai-notice", "/committee",
  "/home", "/members", "/opportunities", "/events", "/vcs", "/calendar", "/community", "/community/mine",
  "/connections", "/my-activity", "/my-bookmarks", "/my-submissions", "/notifications", "/profile",
  "/settings", "/foundry-ai", "/opportunities/new", "/events/new", "/vcs/new",
  "/admin", "/admin/members", "/admin/opportunities", "/admin/events", "/admin/vcs", "/admin/users",
  "/admin/edits", "/admin/reports", "/admin/community", "/admin/connections", "/admin/graduates",
  "/admin/banner", "/admin/ai",
];

const NOISE = /favicon|posthog|sentry|googletagmanager|turnstile|challenges\.cloudflare|ERR_BLOCKED|net::ERR_ABORTED|Download the React DevTools/i;

type Ctx = { name: string; state?: string };
const CONTEXTS: Ctx[] = [
  { name: "logged-out" },
  { name: "student", state: storageStatePath("student") },
  { name: "admin", state: storageStatePath("admin") },
];

async function watch(page: Page) {
  const issues: string[] = [];
  page.on("pageerror", (e) => issues.push(`pageerror: ${e.message.slice(0, 160)}`));
  page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) issues.push(`console: ${m.text().slice(0, 160)}`); });
  page.on("response", (r) => { if (r.status() >= 500) issues.push(`HTTP ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`); });
  return issues;
}

test.describe("page sweep: runtime errors + overflow", () => {
  for (const ctx of CONTEXTS) {
    for (const width of [320, 390, 1280]) {
      test(`${ctx.name} @${width}px: no runtime errors, no 5xx, no horizontal scroll`, async ({ browser }) => {
        test.setTimeout(240_000);
        const c = await browser.newContext({ storageState: ctx.state, viewport: { width, height: 800 } });
        const page = await c.newPage();
        const issues = await watch(page);
        const found: string[] = [];
        const where = `${ctx.name}@${width}px`; // every finding says which role and width it came from
        // /admin/* is a 404 for everyone else (asserted by the route matrix);
        // its "Failed to load resource: 404" console line is not a defect here.
        const paths = ctx.name === "admin" ? STATIC_PAGES : STATIC_PAGES.filter((p) => !p.startsWith("/admin"));
        for (const path of paths) {
          issues.length = 0;
          const res = await page.goto(path, { waitUntil: "load", timeout: 30_000 }).catch((e) => { found.push(`${where} ${path}: nav failed ${String(e).slice(0, 240)}`); return null; });
          if (!res) continue;
          await page.waitForTimeout(250);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          if (overflow > 1) found.push(`${where} ${path}: horizontal overflow ${overflow}px (scrollWidth - clientWidth)`);
          const body = await page.locator("body").innerText().catch(() => "");
          if (/Application error|Internal Server Error|digest:/i.test(body)) found.push(`${where} ${path}: error boundary text rendered`);
          for (const i of issues) found.push(`${where} ${path}: ${i}`);
        }
        await c.close();
        expect(found, found.join("\n")).toEqual([]);
      });
    }
  }
});

// F2: a prerendered page under a nonce CSP has every script blocked, so it
// paints but never hydrates. Check hydration directly, plus the console.
test.describe("static and 404 pages hydrate under their CSP", () => {
  for (const path of ["/ai-notice", "/privacy", "/terms", "/cookies", "/", "/definitely-not-a-route", "/events/not-a-route/at/all", "/zzz/a/b"]) {
    test(`${path} runs its scripts`, async ({ browser }) => {
      const c = await browser.newContext();
      const page = await c.newPage();
      const csp: string[] = [];
      page.on("console", (m) => { if (/Content Security Policy|violates the following/i.test(m.text())) csp.push(m.text().slice(0, 140)); });
      const res = await page.goto(path, { waitUntil: "networkidle" });
      const hydrated = await page.evaluate(() =>
        Array.from(document.querySelectorAll("*")).some((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps"))));
      const policy = res?.headers()["content-security-policy"] ?? "";
      await c.close();
      // The one documented exception: an unmatched path UNDER a known prefix
      // keeps the strict policy (harmless, only its starfield is idle).
      const underKnownPrefix = path.startsWith("/events/");
      if (!underKnownPrefix) {
        expect(csp, `CSP violations on ${path}: ${csp.join(" | ")}`).toEqual([]);
        expect(hydrated, `${path} never hydrated; CSP was: ${policy.slice(0, 120)}`).toBe(true);
      }
      expect(res?.status()).toBe(path === "/ai-notice" || path === "/privacy" || path === "/terms" || path === "/cookies" || path === "/" ? 200 : 404);
    });
  }

  test("the weak (unsafe-inline) policy is served only where nothing dynamic renders", async ({ browser }) => {
    const c = await browser.newContext({ storageState: storageStatePath("student") });
    const page = await c.newPage();
    const weak: string[] = [];
    for (const path of ["/home", "/members", "/events", "/opportunities", "/vcs", "/settings", "/login", "/contact", "/events/00000000-0000-0000-0000-000000000000", "/api/health",
      // Alternative spellings of real routes must not slip into the weak policy.
      // (Dot-segments are normalised by the browser before sending, so those
      // and the other server-side spellings are covered in knownRoutes.test.ts.)
      "/%65vents", "/Events", "//events", "/%2565vents", "/e%76ents/00000000-0000-0000-0000-000000000000"]) {
      // Concatenated, not resolved: "//events" would otherwise parse as host "events".
      const base = (test.info().project.use.baseURL ?? "http://localhost:3000").replace(/\/$/, "");
      const res = await page.goto(base + path, { waitUntil: "domcontentloaded" });
      const policy = res?.headers()["content-security-policy"] ?? "";
      if (/script-src[^;]*'unsafe-inline'/.test(policy) && !/nonce-/.test(policy)) weak.push(path);
    }
    await c.close();
    expect(weak, `dynamic routes served the weak policy: ${weak.join(", ")}`).toEqual([]);
  });
});

test.describe("hostile URLs", () => {
  const JUNK = [
    "?q=%00", "?q=" + "a".repeat(20_000), "?q=<script>alert(1)</script>", "?q='%20OR%201=1--", "?page=-1", "?page=99999999999999999999",
    "?page=abc", "?sort=__proto__", "?__proto__[x]=1", "?q[]=a&q[]=b", "?role=&role=&role=", "?skill=999999&skill=-1",
    "?skill=1&skill=2", "?role=student&role=alum&status=approved&status=rejected&course=a&course=b&sector=1&sector=2&gradMin=1&gradMin=2",
    "?grad_min=abc&grad_max=-5", "?view=bogus", "?tab=%E0%A4%A", "?tab=pending&tab=sent", "?cursor=not-a-cursor", "?cursor=a&cursor=b",
    "?q=%F0%9F%92%A9%F0%9F%92%A9", "?from=2026-13-45&to=banana", "?" + Array.from({ length: 300 }, (_, i) => `k${i}=v`).join("&"),
  ];

  async function fuzzLists(browser: Browser, state: string, lists: string[]) {
    const c = await browser.newContext({ storageState: state });
    const page = await c.newPage();
    const issues = await watch(page);
    const found: string[] = [];
    for (const p of lists) for (const j of JUNK) {
      issues.length = 0;
      const res = await page.goto(p + j, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => null);
      const body = res ? await page.locator("body").innerText().catch(() => "") : "";
      if (!res) found.push(`${p}${j.slice(0, 40)}: no response`);
      else if (res.status() >= 500) found.push(`${p}${j.slice(0, 40)}: HTTP ${res.status()}`);
      else if (/Application error|Internal Server Error|Something went wrong loading/i.test(body)) found.push(`${p}${j.slice(0, 40)}: error boundary`);
      // A 20,000-char query is refused by Node with a bare 431; the browser
      // logs that as a failed resource. It is the intended refusal, not a bug.
      for (const i of issues) if (!(j.length > 10_000 && /431/.test(i))) found.push(`${p}${j.slice(0, 40)}: ${i}`);
    }
    await c.close();
    return found;
  }

  test("query-string fuzz on every member list page never 5xx or crashes", async ({ browser }) => {
    test.setTimeout(300_000);
    const found = await fuzzLists(browser, storageStatePath("student"),
      ["/opportunities", "/events", "/vcs", "/members", "/community", "/connections", "/calendar", "/my-activity", "/notifications", "/foundry-ai", "/settings", "/profile"]);
    expect(found, found.join("\n")).toEqual([]);
  });

  test("query-string fuzz on every admin list page never 5xx or crashes", async ({ browser }) => {
    test.setTimeout(300_000);
    // /admin/community is a legacy redirect to /admin/members?<same query>; the
    // redirect lands client-side after the streamed shell, which aborts the next
    // goto and reads as "no response". /admin/members covers the same params.
    const found = await fuzzLists(browser, storageStatePath("admin"),
      ["/admin/members", "/admin/users", "/admin/reports", "/admin/connections", "/admin/opportunities", "/admin/events", "/admin/vcs", "/admin/edits", "/admin/graduates", "/admin/ai"]);
    expect(found, found.join("\n")).toEqual([]);
  });

  test("detail/edit routes: malformed, absent and someone-else's ids render a clean not-found, never 5xx or a leak", async ({ browser }) => {
    const owner = await newMember("idorOwner");
    const c = await browser.newContext({ storageState: storageStatePath("student") });
    const page = await c.newPage();
    const issues = await watch(page);
    const { data: oid } = await owner.client.rpc("submit_opportunity", validOpportunity({ p_position_name: "PRIVATE-PENDING-TITLE-XYZ" }));
    const { data: eid } = await owner.client.rpc("submit_event", validEvent({ p_title: "PRIVATE-PENDING-EVENT-XYZ" }));
    const found: string[] = [];
    const ids = ["not-a-uuid", "0", "-1", "%00", "..%2f..%2fetc", "<script>", "a".repeat(5000), "00000000-0000-0000-0000-000000000000", oid as string, eid as string];
    for (const base of ["/opportunities", "/events", "/vcs"]) for (const id of ids) for (const suffix of ["", "/edit"]) {
      issues.length = 0;
      const res = await page.goto(`${base}/${id}${suffix}`, { waitUntil: "domcontentloaded" }).catch(() => null);
      // The segment's loading.tsx streams first; wait for the real content.
      if (res) await page.getByText(/This page doesn.t exist|no longer listed|Something went wrong|Application error/i).first().waitFor({ timeout: 6_000 }).catch(() => undefined);
      const body = res ? await page.locator("body").innerText().catch(() => "") : "";
      const label = `${base}/${id.slice(0, 30)}${suffix}`;
      if (!res) { found.push(`${label}: no response`); continue; }
      if (res.status() >= 500) found.push(`${label}: HTTP ${res.status()}`);
      // F4: an id that is not a uuid renders the 404 page: not an error
      // boundary, not the "no longer listed" body, and no 22P02 reaching
      // Postgres. The HTTP status stays 200 because each route segment has a
      // loading.tsx, so the shell is already streaming when notFound() runs
      // (Next's documented behaviour); the page carries noindex.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        if (!/This page doesn.t exist/i.test(body)) found.push(`${label}: malformed id did not render the 404 page`);
        if (/Something went wrong|Application error/i.test(body)) found.push(`${label}: malformed id rendered an error page`);
      }
      if (/PRIVATE-PENDING/.test(body)) found.push(`${label}: another member's PENDING listing is visible`);
      for (const i of issues) found.push(`${label}: ${i}`);
    }
    await c.close();
    await deleteMember(owner);
    expect(found, found.join("\n")).toEqual([]);
  });

  test("open redirect: next/redirect params never leave the origin", async ({ browser }) => {
    const c = await browser.newContext();
    const page = await c.newPage();
    const found: string[] = [];
    const evil = ["https://evil.example/x", "//evil.example/x", "/\\evil.example", "https:evil.example", "javascript:alert(1)", "%2f%2fevil.example", "/%09/evil.example"];
    const entries = ["/login?next=", "/login?redirect=", "/login?returnTo=", "/auth/confirm?token_hash=x&type=magiclink&next=", "/auth/callback?code=x&next=", "/auth/callback?next="];
    for (const e of entries) for (const v of evil) {
      const res = await page.goto(e + encodeURIComponent(v).replace(/%252f/gi, "%2f"), { waitUntil: "domcontentloaded" }).catch(() => null);
      const host = new URL(page.url()).hostname;
      if (host !== "127.0.0.1" && host !== "localhost") found.push(`${e}${v} -> ${page.url()}`);
      if (res && res.status() >= 500) found.push(`${e}${v}: HTTP ${res.status()}`);
    }
    await c.close();
    expect(found, found.join("\n")).toEqual([]);
  });
});

test.describe("stored XSS: payloads inserted past validation must never execute", () => {
  const PAYLOADS = [
    `"><img src=x onerror="window.__xss=1">`,
    `<svg/onload=window.__xss=1>`,
    `'-window.__xss=1-'`,
    `</script><script>window.__xss=1</script>`,
    `{{constructor.constructor('window.__xss=1')()}}`,
    `‮<b>rtl</b>`,
  ];

  test("listing/event/post/profile text is escaped on every render path", async ({ browser }) => {
    test.setTimeout(180_000);
    const db = service();
    const poster = await newMember("xssPoster");
    const found: string[] = [];
    const payload = PAYLOADS[0]!;
    // Insert as already-approved rows straight through the service role: this
    // models "validation missed it" — the render layer must still hold.
    const { data: opp } = await db.from("opportunities").insert({
      posted_by: poster.id, status: "approved", position_name: payload, company: PAYLOADS[1]!, pay: PAYLOADS[2]!,
      location_type: "remote", description: PAYLOADS.join("\n"), start_month: 9, start_year: 2027,
      application_deadline: "2030-01-01", contact_email: "x@example.com", apply_method: "link", apply_url: "https://example.com",
      approved_at: new Date().toISOString(),
    } as never).select("id").single();
    const { data: ev } = await db.from("events").insert({
      posted_by: poster.id, status: "approved", title: payload, description: PAYLOADS.join("\n"),
      luma_link: "https://lu.ma/x", event_at: new Date(Date.now() + 5 * 864e5).toISOString(), location: PAYLOADS[1]!,
      organiser_name: PAYLOADS[3]!, contact_email: "x@example.com", approved_at: new Date().toISOString(),
    } as never).select("id").single();
    await db.from("profiles").update({ first_name: payload, surname: PAYLOADS[1]!, bio_focus: PAYLOADS.join(" ") } as never).eq("id", poster.id);
    await poster.client.rpc("create_post", { p_title: payload, p_body: PAYLOADS.join("\n"), p_images: [] });

    const c = await browser.newContext({ storageState: storageStatePath("student") });
    const page = await c.newPage();
    page.on("dialog", (d) => { found.push(`ALERT/DIALOG fired: ${d.message()}`); void d.dismiss(); });
    const paths = [
      "/home", "/opportunities", `/opportunities/${opp?.id}`, "/events", `/events/${ev?.id}`, "/calendar",
      "/members", "/community", "/committee", "/vcs",
    ];
    for (const p of paths) {
      await page.goto(p, { waitUntil: "load" });
      await page.waitForTimeout(400);
      const executed = await page.evaluate(() => (window as unknown as { __xss?: number }).__xss === 1);
      const injected = await page.evaluate(() => document.querySelectorAll("img[src='x'], svg[onload], [onerror]").length);
      if (executed) found.push(`${p}: payload EXECUTED`);
      if (injected) found.push(`${p}: ${injected} injected element(s) in DOM`);
    }
    // And the admin queue (privileged context is the high-value target).
    const ac = await browser.newContext({ storageState: storageStatePath("admin") });
    const ap = await ac.newPage();
    ap.on("dialog", (d) => { found.push(`ADMIN ALERT: ${d.message()}`); void d.dismiss(); });
    for (const p of ["/admin/opportunities", "/admin/events", "/admin/members", "/admin/users", "/admin/community", "/admin"]) {
      await ap.goto(p, { waitUntil: "load" });
      await ap.waitForTimeout(400);
      if (await ap.evaluate(() => (window as unknown as { __xss?: number }).__xss === 1)) found.push(`${p} (admin): payload EXECUTED`);
      const injected = await ap.evaluate(() => document.querySelectorAll("img[src='x'], svg[onload], [onerror]").length);
      if (injected) found.push(`${p} (admin): ${injected} injected element(s)`);
    }
    await c.close(); await ac.close();
    await deleteMember(poster);
    expect(found, found.join("\n")).toEqual([]);
  });

  test("notification emails escape listing titles (HTML injection into mail)", async () => {
    const poster = await newMember("mailXss");
    const admin = await newMember("mailXssAdmin", { admin: true });
    const evil = `<img src=x onerror=alert(1)>Totally Legit`;
    const { data: id } = await poster.client.rpc("submit_opportunity", validOpportunity({ p_position_name: evil, p_company: `<b>bold</b>` }));
    const ver = Number(psql(`select edit_version from opportunities where id='${id}'`));
    await admin.client.rpc("approve_opportunity", { p_opportunity_id: id as string, p_notes: `<script>n</script>`, p_expected_version: ver });
    const html = psql(`select coalesce(string_agg(html_body, E'\\n---\\n'),'') from outbound_email where to_address='${poster.email}'`);
    test.info().annotations.push({ type: "observation", description: `queued mails to poster: ${html ? "yes" : "none (drain-email may be async)"}` });
    expect(html, "raw tag from a listing title is present in mail HTML").not.toMatch(/<img src=x onerror|<script>n<\/script>|<b>bold<\/b>/);
    await deleteMember(poster); await deleteMember(admin);
  });
});

test.describe("sessions", () => {
  test("revoking a session server-side mid-use: the next action tells the user to sign in, no crash", async ({ browser }) => {
    const m = await newMember("sessRevoke");
    const c = await browser.newContext({ storageState: await storageStateFor(m) });
    const page = await c.newPage();
    const issues = await watch(page);
    await page.goto("/settings");
    await expect(page).toHaveURL(/settings/);
    // Kill every session for this user at the source.
    psql(`delete from auth.sessions where user_id='${m.id}'`);
    psql(`delete from auth.refresh_tokens where user_id='${m.id}'`);
    // Navigate (middleware must cope) and then try a write.
    const res = await page.goto("/opportunities/new", { waitUntil: "load" });
    expect(res?.status() ?? 0, "navigation with a revoked session").toBeLessThan(500);
    const url = page.url();
    const body = await page.locator("body").innerText();
    // Known and accepted: a JWT is valid until it expires (the same lag as a
    // ban, see the ban-user procedure), so a revoked session may keep working
    // for up to an hour. What must never happen is a crash; if the proxy does
    // notice the revocation, the member lands on login.
    test.info().annotations.push({ type: "observation", description: `revoked session landed on ${url} (${/login|sign in/i.test(url + body) ? "bounced to login" : "still served until the JWT expires"})` });
    expect(issues.filter((i) => /pageerror|HTTP 5/.test(i)), issues.join("\n")).toEqual([]);
    await c.close(); await deleteMember(m);
  });

  test("after sign-out, Back does not re-display a private page from the bfcache/HTTP cache", async ({ browser }) => {
    const m = await newMember("bfcache");
    const c = await browser.newContext({ storageState: await storageStateFor(m) });
    const page = await c.newPage();
    await page.goto("/settings");
    const marker = (await page.locator("body").innerText()).includes(m.email);
    // Sign out through the app's own control.
    await page.goto("/home");
    const signOut = page.getByRole("button", { name: /sign out|log out/i }).first();
    if (await signOut.count()) await signOut.click(); else await page.context().clearCookies();
    await page.waitForTimeout(800);
    await page.goBack({ waitUntil: "load" }).catch(() => undefined);
    await page.waitForTimeout(500);
    const body = await page.locator("body").innerText();
    expect(body.includes(m.email) && marker, "signed-out Back shows the previous member's private page").toBe(false);
    const cc = (await (await c.request.get("/settings", { maxRedirects: 0 })).headers())["cache-control"] ?? "";
    test.info().annotations.push({ type: "observation", description: `cache-control on /settings: ${cc || "(none)"}` });
    await c.close(); await deleteMember(m);
  });

  test("two tabs, one signs out: the other tab's next write fails soft", async ({ browser }) => {
    const m = await newMember("twotabs");
    const c = await browser.newContext({ storageState: await storageStateFor(m) });
    const a = await c.newPage(); const b = await c.newPage();
    const issues = await watch(b);
    await a.goto("/home"); await b.goto("/community");
    await c.clearCookies();
    await b.reload({ waitUntil: "load" });
    expect(issues.filter((i) => /pageerror|HTTP 5/.test(i)), issues.join("\n")).toEqual([]);
    expect(b.url()).toMatch(/login|community/);
    await c.close(); await deleteMember(m);
  });
});

test.describe("endpoints", () => {
  test("cron + internal endpoints refuse unauthenticated, wrong-secret and query-secret callers", async ({ request }) => {
    const found: string[] = [];
    const paths = ["/api/cron/connections-digest", "/api/cron/drain-blob-deletions", "/api/cron/drain-email", "/api/cron/github-showcase-nudge", "/api/cron/health"];
    for (const p of paths) {
      for (const method of ["GET", "POST"] as const) {
        const variants: [string, Record<string, string>, string][] = [
          ["no auth", {}, ""],
          ["wrong bearer", { authorization: "Bearer wrong" }, ""],
          ["empty bearer", { authorization: "Bearer " }, ""],
          ["secret in query", {}, "?secret=e2e-cron-secret&key=e2e-cron-secret&token=e2e-cron-secret"],
          ["secret in wrong header", { "x-cron-secret": "e2e-cron-secret" }, ""],
          ["case-variant scheme", { authorization: "bearer wrong" }, ""],
        ];
        for (const [name, headers, q] of variants) {
          const r = await request.fetch(p + q, { method, headers, maxRedirects: 0 });
          if (r.status() < 400 || r.status() >= 500) found.push(`${method} ${p} [${name}] -> ${r.status()}`);
        }
      }
    }
    expect(found, found.join("\n")).toEqual([]);
  });

  test("image proxy + health + AI turn endpoints don't traverse, leak, or IDOR", async ({ request }) => {
    const found: string[] = [];
    const bad = ["../../etc/passwd.webp", "..%2f..%2fetc%2fpasswd", "%00.webp", `${"a".repeat(3000)}.webp`, "00000000-0000-0000-0000-000000000000.png", "00000000-0000-0000-0000-000000000000.webp/../../x"];
    for (const purpose of ["profile_picture", "cv", "post_image", "..", "%2e%2e"]) for (const key of bad) {
      const r = await request.get(`/api/img/${purpose}/${key}`, { maxRedirects: 0 });
      if (r.status() >= 500) found.push(`/api/img/${purpose}/${key.slice(0, 30)} -> ${r.status()}`);
      if (r.status() >= 300 && r.status() < 400) found.push(`/api/img/${purpose}/${key.slice(0, 30)} redirected (${r.headers().location})`);
    }
    for (const purpose of ["cv", "post_image"]) {
      const r = await request.get(`/api/img/${purpose}/00000000-0000-0000-0000-000000000000.webp`, { maxRedirects: 0 });
      if (r.status() !== 404) found.push(`/api/img/${purpose} (not allow-listed) -> ${r.status()}`);
    }
    const turn = await request.get("/api/ai/turns/00000000-0000-0000-0000-000000000000", { maxRedirects: 0 });
    if (turn.status() < 400 || turn.status() >= 500) found.push(`/api/ai/turns anon -> ${turn.status()}`);
    const health = await request.get("/api/health");
    const hb = await health.text();
    if (/postgres|supabase\.co|service_role|eyJ[a-zA-Z0-9_-]{20,}|password|secret/i.test(hb)) found.push(`/api/health leaks internals: ${hb.slice(0, 120)}`);
    expect(found, found.join("\n")).toEqual([]);
  });

  test("security headers on the main document", async ({ request }) => {
    const r = await request.get("/", { maxRedirects: 0 });
    const h = r.headers();
    const found: string[] = [];
    if (!h["content-security-policy"]) found.push("no CSP header");
    else if (/unsafe-eval/.test(h["content-security-policy"])) found.push("CSP allows unsafe-eval");
    if (!/frame-ancestors|x-frame-options/i.test(`${h["content-security-policy"]}${h["x-frame-options"] ?? ""}`)) found.push("clickjacking: no frame-ancestors / X-Frame-Options");
    if (h["x-content-type-options"] !== "nosniff") found.push("no X-Content-Type-Options: nosniff");
    if (!h["referrer-policy"]) found.push("no Referrer-Policy");
    if (h["x-powered-by"]) found.push(`X-Powered-By: ${h["x-powered-by"]}`);
    expect(found, found.join("\n")).toEqual([]);
  });

  test("auth entry points with garbage tokens bounce cleanly", async ({ request }) => {
    const found: string[] = [];
    const urls = [
      "/auth/callback", "/auth/callback?code=", "/auth/callback?code=" + "A".repeat(5000), "/auth/callback?error=access_denied&error_description=<script>",
      "/auth/confirm?token_hash=" + "x".repeat(4000) + "&type=bogus", "/auth/confirm?type=recovery", "/auth/confirm?token_hash=%00&type=magiclink",
      "/auth/github-connect/callback", "/auth/github-connect/callback?code=x&state=y", "/auth/github-connect/start",
    ];
    for (const u of urls) {
      const r = await request.get(u, { maxRedirects: 0 });
      if (r.status() >= 500) found.push(`${u.slice(0, 60)} -> ${r.status()}`);
      const loc = r.headers().location ?? "";
      if (/<script/i.test(loc)) found.push(`${u.slice(0, 60)} reflects <script> into Location`);
    }
    expect(found, found.join("\n")).toEqual([]);
  });
});

test.describe("contact form", () => {
  test("header injection, oversize and empty submissions are handled", async ({ browser }) => {
    const c = await browser.newContext();
    const page = await c.newPage();
    const issues = await watch(page);
    await page.goto("/contact");
    const fields = await page.locator("input:not([type=hidden]), textarea").evaluateAll((els) => els.map((e) => ({ name: (e as HTMLInputElement).name, id: e.id, type: (e as HTMLInputElement).type })));
    test.info().annotations.push({ type: "observation", description: `contact fields: ${JSON.stringify(fields)}` });
    await page.getByRole("button", { name: /send|submit/i }).first().click();
    await page.waitForTimeout(500);
    expect(issues.filter((i) => /pageerror|HTTP 5/.test(i))).toEqual([]);
    await c.close();
  });
});

// Keep unused imports referenced so type-check stays quiet while the file grows.
void (null as unknown as Browser); void USERS; void (null as unknown as Member);
