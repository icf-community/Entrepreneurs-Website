import { test, expect } from "@playwright/test";

// Every form control must expose an accessible name — via aria-label,
// aria-labelledby, a label[for], or a wrapping <label>.
//
// This used to fail on nine controls on /opportunities/new alone: the Field
// wrapper rendered a <label> that pointed at nothing, and the filter search
// boxes and date ranges had only a placeholder, which is not a name.
//
// Runs under the `member` project — most of these routes are gated.

const PAGES = ["/members", "/opportunities", "/events", "/vcs",
               "/opportunities/new", "/events/new", "/vcs/new", "/profile", "/settings", "/contact",
               // All three tabs and both views. The graph is the one
               // surface here that is a picture, so it is the one most
               // likely to ship an unnamed control.
               "/connections", "/connections?tab=pending", "/connections?tab=sent",
               "/connections?view=graph"];

for (const path of PAGES) {
  test(`every form control on ${path} has an accessible name`, async ({ page }) => {
    await page.goto(path);
    // Open any collapsed filter panels so their controls are in the DOM.
    for (const b of await page.getByRole("button", { name: /filter/i }).all()) {
      await b.click().catch(() => {});
    }
    const unnamed = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("input, textarea, select")) {
        if ((el as HTMLInputElement).type === "hidden") continue;
        const aria = el.getAttribute("aria-label")?.trim();
        const labelled = el.getAttribute("aria-labelledby");
        const byFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        const wrapping = el.closest("label");
        if (!aria && !labelled && !byFor && !wrapping) {
          out.push(`${el.tagName}[type=${(el as HTMLInputElement).type}] ph="${(el as HTMLInputElement).placeholder ?? ""}"`);
        }
      }
      return out;
    });
    expect(unnamed, `unnamed controls on ${path}`).toEqual([]);
  });
}

test("the skip link is first in the tab order and moves focus into <main>", async ({ page }) => {
  await page.goto("/members");
  // goto resolves while the route's loading.tsx fallback is still on screen
  // (see the note in community/loading.tsx). Tab then lands on the skeleton's
  // skip link, and focus is lost when the real page streams in and replaces
  // it. Wait for the fallback to clear — Skeleton marks itself aria-busy —
  // so the keyboard is driven against the settled page.
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.keyboard.press("Tab");
  const link = page.getByRole("link", { name: "Skip to content" });
  await expect(link).toBeFocused();
  // Hidden until focused, so it doesn't occupy space for sighted users.
  await expect(link).toBeVisible();
  // `not-sr-only` sets position:static and `fixed` sets position:fixed; which
  // one wins is Tailwind's utility ordering, not our source order. Assert the
  // outcome so a reorder can't quietly leave the link laid out inline.
  expect(await link.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
  await page.keyboard.press("Enter");
  // Polled, not read once: the fragment navigation and React's commit are
  // separate ticks, and reading between them caught focus back on <body>.
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName))
    .toBe("MAIN");
});
