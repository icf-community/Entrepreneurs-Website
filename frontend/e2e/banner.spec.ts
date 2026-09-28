import { test, expect } from "@playwright/test";

// F-x4: an admin publishes one message from /admin/banner and every page,
// including the sign-in page, shows it; clearing removes it. Runs under the
// `admin` project. Serial: the banner is one shared row.
//
// /api/banner is browser-cached for 15 s, so each "does it show now" check
// uses a fresh browser context rather than waiting that out.

test.describe.configure({ mode: "serial" });

test("an admin publishes a banner; it shows signed in and on /login, as plain text", async ({ page, browser }) => {
  const hostile = `Sign-in is slow <img src=x onerror="window.__xss=1"> ${Date.now()}`;

  await page.goto("/admin/banner");
  await page.getByLabel("Message").fill(hostile);
  await page.getByLabel("Severity").selectOption("warning");
  await page.getByLabel(/Link for more detail/).fill("javascript:alert(1)");
  await expect(page.getByText("Use a full https:// address.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish banner" })).toBeDisabled();
  await page.getByLabel(/Link for more detail/).fill("https://example.com/status");
  await page.getByRole("button", { name: "Publish banner" }).click();
  await expect(page.getByText("Banner published.", { exact: false })).toBeVisible();
  await expect(page.getByText(/^Live now/)).toBeVisible();

  // Signed in, on an AppShell page.
  await page.goto("/home");
  const banner = page.getByRole("status").filter({ hasText: "Sign-in is slow" });
  await expect(banner).toBeVisible();
  // Rendered as text: the markup is visible literally, and nothing ran.
  await expect(banner).toContainText("<img src=x");
  await expect(banner.locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

  // Logged out, on the sign-in page.
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const login = await anon.newPage();
  await login.goto("/login");
  await expect(login.getByRole("status").filter({ hasText: "Sign-in is slow" })).toBeVisible();
  await anon.close();
});

test("a dismissed warning stays dismissed until the message changes", async ({ page }) => {
  await page.goto("/home");
  const banner = page.getByRole("status").filter({ hasText: "Sign-in is slow" });
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Dismiss this notice" }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Sign-in is slow" })).toHaveCount(0);
});

test("clearing the banner removes it everywhere", async ({ page, browser }) => {
  await page.goto("/admin/banner");
  await page.getByRole("button", { name: "Clear banner" }).click();
  await expect(page.getByText("No banner is showing.")).toBeVisible();

  const fresh = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const login = await fresh.newPage();
  // Let the banner fetch settle before asserting absence.
  const fetched = login.waitForResponse((r) => r.url().endsWith("/api/banner"));
  await login.goto("/login");
  await fetched;
  await expect(login.getByRole("status").filter({ hasText: "Sign-in is slow" })).toHaveCount(0);
  await fresh.close();
});
