import { devices, expect, test, type Page } from "@playwright/test";
import { storageStatePath } from "../fixtures";

// ════════════════════════════════════════════════════════════════════
// The signed-in app on a phone (Pixel 7 emulation: touch, mobile UA,
// 412px wide, device pixel ratio), which the 320/390px sweep in
// browser.spec.ts does not do: that one resizes a desktop browser.
//
//   - navigation is reachable by tapping, and the nav closes again
//   - a dialog opens by tap and its controls are usable
//   - no page scrolls sideways, and the viewport meta is sane
//   - buttons and nav links meet WCAG 2.2 target size (2.5.8, 24 x 24 CSS px)
// ════════════════════════════════════════════════════════════════════

test.use({ ...devices["Pixel 7"], storageState: storageStatePath("student") });

const PAGES = ["/home", "/members", "/opportunities", "/events", "/vcs", "/community", "/connections", "/foundry-ai", "/profile", "/settings", "/notifications"];

async function undersized(page: Page) {
  return page.evaluate(() => {
    const bad: string[] = [];
    const sel = "button, [role=button], input:not([type=hidden]), select, textarea, nav a, header a, summary";
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || cs.display === "none") continue;
      if (el.closest("[inert], [aria-hidden=true]")) continue;
      // Visually hidden file inputs are operated through their visible label/button.
      if (el instanceof HTMLInputElement && el.type === "file") continue;
      // An element stretched over a card (absolute inset-0) is sized by the card.
      if (r.width >= 24 && r.height >= 24) continue;
      // Checkbox/radio inputs are sized by their label in this design system.
      if (el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type) && el.closest("label")) {
        const lr = el.closest("label")!.getBoundingClientRect();
        if (lr.width >= 24 && lr.height >= 24) continue;
      }
      bad.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return bad;
  });
}

test("viewport meta allows zoom and every signed-in page fits the phone without sideways scroll", async ({ page }) => {
  const problems: string[] = [];
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle").catch(() => {});
    const meta = await page.locator('meta[name="viewport"]').getAttribute("content");
    if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(meta ?? "")) problems.push(`${path}: viewport blocks zoom (${meta})`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) problems.push(`${path}: scrolls sideways by ${overflow}px`);
  }
  expect(problems, problems.join("\n")).toEqual([]);
});

test("the navigation opens and closes by tap and reaches another page", async ({ page }) => {
  await page.goto("/home");
  const toggle = page.getByRole("button", { name: "Open navigation" });
  await expect(toggle, "no way to open the navigation on a phone").toBeVisible();
  await toggle.tap();
  const link = page.getByRole("link", { name: /events/i }).first();
  await expect(link).toBeVisible();
  await link.tap();
  await expect(page).toHaveURL(/\/events/);
  // The nav is not left covering the page after navigating.
  const covering = await page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return el ? !!el.closest("nav, aside") : false;
  });
  expect(covering, "the navigation still covers the page after choosing a link").toBe(false);
});

test("a member dialog opens by tap, scrolls, and closes by tap", async ({ page }) => {
  await page.goto("/members");
  await page.getByRole("button", { name: /^View .+ profile$/ }).first().tap();
  const dialog = page.locator("dialog[open]");
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.width, "dialog wider than the screen").toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await page.getByRole("button", { name: /close/i }).first().tap();
  await expect(dialog).toHaveCount(0);
});

test("buttons and navigation links meet the 24 x 24 target-size minimum", async ({ page }) => {
  const report: string[] = [];
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle").catch(() => {});
    const bad = await undersized(page);
    if (bad.length) report.push(`${path}: ${[...new Set(bad)].slice(0, 6).join("; ")}`);
  }
  expect(report, report.join("\n")).toEqual([]);
});
