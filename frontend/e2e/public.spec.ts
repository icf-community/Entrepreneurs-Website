import { test, expect } from "@playwright/test";

// ─── Public routes: render without auth (the "endpoints are alive" proof) ──
const PUBLIC_ROUTES = ["/", "/login", "/contact", "/privacy", "/terms"];

for (const path of PUBLIC_ROUTES) {
  test(`public route ${path} renders a 2xx/3xx page`, async ({ page }) => {
    const res = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(res, `no response for ${path}`).not.toBeNull();
    expect(res!.status(), `status for ${path}`).toBeLessThan(400);
    await expect(page.locator("body")).toBeVisible();
  });
}

test("login page exposes an auth entry point", async ({ page }) => {
  await page.goto("/login");
  // Don't over-couple to copy: any interactive control (role buttons, Google,
  // email field) proves the auth UI mounted.
  await expect(page.locator("button, input").first()).toBeVisible();
});

test("contact form renders its inputs when logged out", async ({ page }) => {
  await page.goto("/contact");
  await expect(page.locator("#email")).toBeVisible();
  await expect(page.locator("#subject")).toBeVisible();
  await expect(page.locator("#message")).toBeVisible();
});

test("public contact form submits anonymously and confirms success", async ({ page }) => {
  // Turnstile is unconfigured in CI, so the anonymous path submits straight
  // through to the server action, which enqueues to outbound_email via the
  // service client — a real write, all on the ephemeral stack.
  await page.goto("/contact");
  await page.locator("#email").fill("e2e-visitor@example.com");
  await page.locator("#subject").fill("E2E hello");
  await page.locator("#message").fill("Automated contact submission from the E2E suite.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(/we[’']ve received your message/i)).toBeVisible();
});

// ─── CSP: both policies are served, and the app hydrates clean under each ──
// This is the pre-deploy gate for enforce-mode CSP: if a directive were too
// strict, Next's inline hydration scripts would be refused and we'd see a
// "Content Security Policy" console violation here before it ever ships.
//
// There are TWO policies, and which one a route gets is a security decision,
// so both are asserted rather than whichever one happens to be easier to
// satisfy. lib/csp.ts's STATIC_CSP_ROUTES get the nonce-free policy so they
// can be statically rendered; everything else keeps 'nonce-…'
// 'strict-dynamic'. The pairing is not cosmetic — a static page cannot carry
// a per-request nonce, and under strict-dynamic a script without one is
// blocked even when it is our own bundle. So a route is either
// dynamic-with-strict-CSP or static-with-unsafe-inline, and the test that
// only checked "/" was silently checking the weaker half after "/" moved.
function watchForCspViolations(page: import("@playwright/test").Page): string[] {
  const violations: string[] = [];
  const isCspViolation = (text: string) =>
    /content security policy|refused to (execute|load|connect|apply|create)/i.test(text);
  page.on("console", (msg) => {
    if (msg.type() === "error" && isCspViolation(msg.text())) violations.push(msg.text());
  });
  page.on("pageerror", (err) => {
    if (isCspViolation(err.message)) violations.push(err.message);
  });
  return violations;
}

test("home page carries the static CSP and hydrates with zero violations", async ({ page }) => {
  const violations = watchForCspViolations(page);

  const res = await page.goto("/", { waitUntil: "networkidle" });
  const csp = res?.headers()["content-security-policy"];
  expect(csp, "CSP header present").toBeTruthy();
  // "/" is on STATIC_CSP_ROUTES, so it is prerendered and has no nonce.
  expect(csp!, "static route carries no nonce").not.toMatch(/'nonce-/);
  expect(csp!, "static route falls back to unsafe-inline").toContain("'unsafe-inline'");
  // Every non-script protection must be identical to the strict policy —
  // that is the whole basis on which the weaker script-src was accepted.
  expect(csp!).toContain("object-src 'none'");
  expect(csp!).toContain("base-uri 'self'");
  expect(csp!).toContain("form-action 'self'");
  expect(csp!).toContain("frame-ancestors 'none'");

  expect(violations, `CSP violations on /: ${violations.join(" | ")}`).toEqual([]);
});

test("a dynamic public route carries a nonce-based CSP and hydrates clean", async ({ page }) => {
  const violations = watchForCspViolations(page);

  // /login is deliberately NOT on STATIC_CSP_ROUTES: it takes user input and
  // is the highest-value phishing target in the app, so it keeps the strict
  // policy. That makes it the right route to prove the nonce path still works.
  const res = await page.goto("/login", { waitUntil: "networkidle" });
  const csp = res?.headers()["content-security-policy"];
  expect(csp, "CSP header present").toBeTruthy();
  expect(csp!, "CSP carries a per-request nonce").toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
  expect(csp!).toContain("'strict-dynamic'");

  expect(violations, `CSP violations on /login: ${violations.join(" | ")}`).toEqual([]);
});

// ─── Access control: gated routes bounce logged-out visitors to /login ─────
const GATED_ROUTES = [
  "/members",
  "/opportunities",
  "/events",
  "/vcs",
  "/my-submissions",
  "/my-bookmarks",
  "/settings",
];

for (const path of GATED_ROUTES) {
  test(`gated route ${path} redirects to /login when logged out`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  });
}

// /admin is deliberately different: the admin layout calls notFound() for
// non-admins, so its very existence is hidden behind a 404 rather than a
// login redirect. Assert that, and that no admin content leaks.
test("/admin is hidden behind a 404 when logged out (no content leak)", async ({ page }) => {
  const res = await page.goto("/admin");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("Foundry control panel")).toHaveCount(0);
});
