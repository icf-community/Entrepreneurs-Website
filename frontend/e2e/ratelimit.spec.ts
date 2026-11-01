import http from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect } from "@playwright/test";
import { storageStatePath, type Role } from "./fixtures";

// Live rate-limit enforcement. Runs ONLY in the isolated `e2e-ratelimit` CI
// job, where Upstash is wired via an SRH sidecar so `rateLimitEnabled` is
// true. The anonymous contact-submit bucket is 10/hr per IP; from CI all
// requests share one loopback identity, so a flood from one client should
// trip the limiter and surface the "too frequently" message.
//
// This proves the integration genuinely throttles over real HTTP — it does
// NOT prove prod wiring (Vercel UPSTASH_* env) or Cloudflare's edge shield.

// The mutation probe. NOT "/": the proxy matcher excludes the homepage
// (src/proxy.ts, the "$" alternative), so a POST to "/" never reaches the
// limiter and a test using it passes whatever the limiter does. This path is
// unknown to the app, so the POST goes through the proxy (and so the limiter)
// and then gets a cheap prerendered 404. Anything but 429 means "not throttled".
const PROBE = "/rl-probe";

test("anonymous contact-submit bucket throttles a flood from one client", async ({ page }) => {
  await page.goto("/contact");

  const throttle = page.getByText(/too frequently/i);
  const success = page.getByText(/we[’']ve received your message/i);

  let sawSuccess = false;
  let sawThrottle = false;

  // The bucket allows 10/hr; 15 attempts is a comfortable margin to see the
  // transition from accepted to throttled.
  for (let i = 0; i < 15 && !sawThrottle; i++) {
    await page.locator("#email").fill(`flood${i}@example.com`);
    await page.locator("#subject").fill(`flood ${i}`);
    await page.locator("#message").fill("Rate-limit enforcement probe.");
    await page.getByRole("button", { name: "Send message" }).click();

    // Each submit resolves to exactly one of the two banners.
    await expect(throttle.or(success).first()).toBeVisible();
    if (await throttle.isVisible()) sawThrottle = true;
    else sawSuccess = true;
  }

  expect(sawSuccess, "expected at least one submit to be accepted before throttling").toBe(true);
  expect(sawThrottle, "expected the submit bucket to throttle within 15 rapid submits").toBe(true);
});

// Campus NAT. Imperial students on campus share one public IP, so keying the
// mutations bucket on IP made it a *campus* bucket — 60 mutations a minute for
// everyone in the building combined, and onboarding is a server action. This
// asserts the fix: signed-in traffic is keyed on the account, so several
// accounts bursting from one IP are not throttled by each other.
//
// From CI every request carries the same (loopback) IP, which is exactly the
// shape being tested. 3 accounts x 25 non-GET requests = 75 from one IP, well
// past the old 60/min per-IP ceiling and well under the new 60/min per-account
// one. Under the pre-fix code this test fails; that is the point of it.
//
// POST to PROBE is the cheapest probe that still runs the proxy; the limiter
// has its say before Next answers 404. Any status other than 429 means the
// request was not throttled. The last step is the control: the same path, one
// account, past its own 60/min, IS throttled, so the "not throttled" results
// above are not a probe that never reaches the limiter.
test("a mutation burst from one IP across several accounts is not throttled", async ({
  playwright,
  baseURL,
}) => {
  test.setTimeout(90_000);

  const roles: Role[] = ["student", "admin", "reauth"];
  const sessions = await Promise.all(
    roles.map((role) =>
      playwright.request.newContext({ baseURL, storageState: storageStatePath(role) }),
    ),
  );

  try {
    for (let i = 0; i < 25; i++) {
      const responses = await Promise.all(sessions.map((s) => s.post(PROBE)));
      responses.forEach((res, n) => {
        expect(
          res.status(),
          `round ${i + 1} as ${roles[n]}: throttled at ${i * roles.length + n + 1} ` +
            `mutations from one IP — the bucket is still keyed on the IP, not the account`,
        ).not.toBe(429);
      });
    }

    // Control: one account on its own bucket does hit its 60/min.
    let throttled = 0;
    for (let i = 0; i < 90 && throttled === 0; i++) {
      if ((await sessions[2]!.post(PROBE)).status() === 429) throttled = i + 1;
    }
    expect(throttled, `a single account made 90 mutations without a 429: the probe never reaches the limiter`).toBeGreaterThan(0);
  } finally {
    await Promise.all(sessions.map((s) => s.dispose()));
  }
});

// The other half of the same change: genuinely anonymous mutations still key on
// IP, because there is no better identity — but on their own bucket, at a
// ceiling that is a flood guard rather than a per-person limit. 75 anonymous
// non-GET requests would trip the old shared 60/min bucket; the anon bucket is
// 1200/min, so they must all get through.
test("anonymous mutations get the higher flood-guard ceiling, not the per-user one", async ({
  playwright,
  baseURL,
}) => {
  test.setTimeout(90_000);

  const anon = await playwright.request.newContext({ baseURL });
  try {
    for (let i = 0; i < 75; i++) {
      const res = await anon.post(PROBE);
      expect(
        res.status(),
        `anonymous request ${i + 1} was throttled — anonymous traffic is still ` +
          `sharing the 60/min per-user bucket`,
      ).not.toBe(429);
    }
  } finally {
    await anon.dispose();
  }
});

// Foundry AI web-layer bucket (the database enforces its own AI caps; see
// server/tests/integration/test_ai_limits.py). aiRead is 60/min per account on
// the status poller. The route checks the limiter after authentication and
// before touching the database, so a well-formed id that matches no turn gets
// 404 until the bucket empties, then 429 with Retry-After.
//
// Keyed on the account, so one member exhausting it must not throttle another
// member on the same IP (campus NAT). A spoofed X-Forwarded-For is covered by
// the last test in this file, through an emulated edge.
test("the AI status poller is limited per account, not per IP", async ({ playwright, baseURL }) => {
  test.setTimeout(90_000);
  const id = "00000000-0000-4000-8000-000000000000";
  const student = await playwright.request.newContext({ baseURL, storageState: storageStatePath("student") });
  const admin = await playwright.request.newContext({ baseURL, storageState: storageStatePath("admin") });
  try {
    const statuses: number[] = [];
    let retryAfter: string | undefined;
    for (let i = 0; i < 70; i++) {
      const res = await student.get(`/api/ai/turns/${id}`);
      statuses.push(res.status());
      if (res.status() === 429) retryAfter ??= res.headers()["retry-after"];
    }
    const firstLimited = statuses.indexOf(429);
    expect(firstLimited, `never limited in 70 polls: ${[...new Set(statuses)]}`).toBeGreaterThan(0);
    expect(firstLimited, "limited before the 60/min allowance was spent").toBeGreaterThanOrEqual(55);
    expect(statuses.slice(0, firstLimited).every((s) => s === 404), "pre-limit polls should be plain 404s").toBe(true);
    expect(statuses.slice(firstLimited).every((s) => s === 429), "once limited it must stay limited").toBe(true);
    expect(retryAfter).toBeTruthy();

    // Same IP, different account: untouched.
    expect((await admin.get(`/api/ai/turns/${id}`)).status()).toBe(404);
  } finally {
    await Promise.all([student.dispose(), admin.dispose()]);
  }
});

// ─── Spoofed X-Forwarded-For / cf-connecting-ip, through an emulated edge ───
//
// clientIp() keys IP buckets on the LAST x-forwarded-for hop, on the footing
// that the production front door (Vercel's edge) sets that hop itself and
// everything to its left is client-controlled. `next start` has no front door:
// it passes a client-supplied chain through untouched, so against it the last
// hop IS client-controlled (observed: a flood with a rotating forged last hop
// got a fresh bucket each time). That is a property of running without an edge,
// not of production, so this test stands one up: a small reverse proxy that does
// what Vercel does, in both documented shapes (it appends the real peer, or it
// overwrites the header with it), and then checks the rule:
//
//   1. A flood from one real peer that rotates a forged x-forwarded-for chain,
//      cf-connecting-ip and x-real-ip on every request is still throttled:
//      forging buys no fresh bucket.
//   2. Control: a different real peer is not throttled, so the bucket really
//      is keyed on the edge-set hop (and a neighbour is not collateral).
//   3. The flooding peer stays throttled under yet another forged identity.
//
// This proves the app's trust rule against an edge-shaped front door. It cannot
// prove that Vercel and Cloudflare behave this way in production; that stays a
// check for the production session.
function startEdge(
  targetBase: string,
  peer: string,
  mode: "append" | "overwrite",
): Promise<{ url: string; close: () => Promise<void> }> {
  const target = new URL(targetBase);
  const server = http.createServer((req, res) => {
    const headers: http.OutgoingHttpHeaders = { ...req.headers, host: target.host };
    headers["x-forwarded-for"] =
      mode === "append" ? [req.headers["x-forwarded-for"], peer].filter(Boolean).join(", ") : peer;
    headers["x-real-ip"] = peer;
    const upstream = http.request(
      { host: target.hostname, port: target.port, path: req.url, method: req.method, headers },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.statusCode = 502;
      res.end();
    });
    req.pipe(upstream);
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      }),
    ),
  );
}

for (const mode of ["append", "overwrite"] as const) {
  test(`forging x-forwarded-for / cf-connecting-ip buys no fresh bucket; the edge-set peer is the key (edge ${mode}s)`, async ({
    playwright,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    // A fresh pair of documentation-range addresses per run, so a re-run inside
    // the limiter's window does not inherit an exhausted second peer.
    const run = Math.floor(Math.random() * 200) + 20;
    const [p1, p2] = [`203.0.113.${run}`, `198.51.100.${run}`];
    const [edge1, edge2] = [await startEdge(baseURL!, p1, mode), await startEdge(baseURL!, p2, mode)];
    const c1 = await playwright.request.newContext({ baseURL: edge1.url });
    const c2 = await playwright.request.newContext({ baseURL: edge2.url });
    const forged = (i: number) => ({
      "x-forwarded-for": `10.${i % 250}.${(i * 7) % 250}.${(i * 13) % 250}, 192.0.2.${i % 250}`,
      "cf-connecting-ip": `100.64.${i % 250}.${(i * 3) % 250}`,
      "x-real-ip": `100.65.${i % 250}.1`,
    });
    try {
      // 1. The anon mutation bucket is 1200/min (a sliding window, LIMIT in lib/ratelimit.ts).
      let throttledAt = -1;
      for (let i = 0; i < 1800 && throttledAt < 0; i++) {
        if ((await c1.post(PROBE, { headers: forged(i) })).status() === 429) throttledAt = i;
      }
      expect(throttledAt, "1800 forged-identity requests from one real peer never hit the limiter (ceiling is 1200/min)").toBeGreaterThanOrEqual(0);

      // 2. Control: a different real peer is untouched.
      for (let i = 0; i < 5; i++) {
        const res = await c2.post(PROBE, { headers: forged(2000 + i) });
        expect(res.status(), "a different real peer was throttled by the first peer's flood").not.toBe(429);
      }

      // 3. The flooding peer stays throttled under yet another forged identity.
      expect((await c1.post(PROBE, { headers: forged(5000) })).status(), "a fresh forged identity escaped the throttle").toBe(429);
    } finally {
      await Promise.all([c1.dispose(), c2.dispose()]);
      await Promise.all([edge1.close(), edge2.close()]);
    }
  });
}
