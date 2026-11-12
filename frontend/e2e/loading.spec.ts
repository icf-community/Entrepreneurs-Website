import { test, expect, type Page } from "@playwright/test";

// Launch programme C1/C2: on a slow connection a click visibly does
// something straight away. Loads the starting page at full speed, then
// throttles the network through CDP (Chromium), clicks a sidebar link, and
// asserts that feedback (the navigation bar or the destination's skeleton)
// appears well before the page itself. Runs under the `member` project.

async function throttle(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  // Roughly "slow 3G": 400 ms of latency each way, ~50 KB/s down.
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 400,
    downloadThroughput: 50 * 1024,
    uploadThroughput: 20 * 1024,
  });
}

test.describe("on a slow network", () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== "chromium", "CDP network throttling is Chromium-only");
  });

  for (const [label, from, heading] of [
    ["Connections", "/members", /people you can reach/i],
    ["Members", "/home", /directory/i],
    ["Settings", "/members", /account & profile/i],
  ] as const) {
    test(`clicking ${label} shows feedback before the page arrives`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.goto(from);
      const link = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label });
      await link.waitFor();
      await throttle(page);

      const start = Date.now();
      await link.click();
      // Either the pending bar (C2) or a skeleton region (C1), whichever
      // the router shows first.
      await expect(page.locator(".nav-pending-bar, [aria-busy='true']").first()).toBeVisible({ timeout: 2_000 });
      expect(Date.now() - start).toBeLessThan(2_000);

      await expect(page.getByRole("heading", { level: 1, name: heading }).first()).toBeVisible({ timeout: 60_000 });
    });
  }
});
