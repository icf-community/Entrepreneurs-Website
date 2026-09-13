import { test, expect } from "@playwright/test";

// Regression cover for components/ui/Dialog, which replaced two hand-rolled
// <div role="dialog" aria-modal> overlays with the native <dialog> element.
// The old markup *claimed* modality to assistive tech without providing any
// of it, so what's asserted here is precisely what changed: focus enters the
// dialog, cannot reach the page behind it, and returns to whatever opened it.
//
// Runs under the `member` project — /members is member-gated.

/**
 * Open a directory card's dialog, tolerating the hydration window.
 *
 * The cards are server-rendered with role="button" and tabindex="0", so they
 * are present, focusable and clickable BEFORE React attaches their onClick.
 * A click inside that window is swallowed and the dialog never opens — the
 * assertion then fails on a page that works perfectly. This is the same race
 * untilUrl() exists for in urlfilters.spec.ts, and it is what made
 * "clicking the backdrop closes the dialog" fail intermittently.
 *
 * Replaying the click is safe because opening is idempotent, but it is
 * guarded on the dialog not already being open: clicking through an open
 * modal would hit the backdrop and close it again.
 */
async function openDialog(
  page: import("@playwright/test").Page,
  trigger: import("@playwright/test").Locator,
) {
  const dialog = page.locator("dialog");
  await expect(async () => {
    if ((await dialog.count()) === 0) await trigger.click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return dialog;
}

test("member dialog: focus enters, stays in the top layer, Escape restores focus", async ({ page }) => {
  await page.goto("/members");
  const trigger = page.locator('[role="button"][tabindex="0"]').first();
  await trigger.waitFor();
  const before = await trigger.evaluate((el) => el.outerHTML.slice(0, 200));
  const dlg = await openDialog(page, trigger);
  expect(await dlg.evaluate((d: HTMLDialogElement) => d.matches(":modal"))).toBe(true);
  expect(await page.evaluate(() => !!document.activeElement?.closest("dialog"))).toBe(true);

  // Chrome wraps a single-focusable dialog via the document itself, so BODY is
  // an expected stop. What must never happen is focus landing on page content
  // behind the dialog.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const where = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!a || a === document.body) return "body";
      return a.closest("dialog") ? "dialog" : `LEAKED:${a.tagName}.${a.className}`;
    });
    expect(where, `Tab #${i + 1}`).toMatch(/^(dialog|body)$/);
  }

  // The page behind is inert: a programmatic focus attempt is refused.
  expect(await trigger.evaluate((el: HTMLElement) => {
    el.focus();
    return document.activeElement === el;
  })).toBe(false);

  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 200) ?? "<none>")).toBe(before);
});

test("dialog close button (not Escape) also restores focus to the trigger", async ({ page }) => {
  await page.goto("/members");
  const trigger = page.locator('[role="button"][tabindex="0"]').first();
  await trigger.waitFor();
  const before = await trigger.evaluate((el) => el.outerHTML.slice(0, 200));
  await openDialog(page, trigger);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.locator("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 200) ?? "<none>")).toBe(before);
});

test("clicking the backdrop closes the dialog", async ({ page }) => {
  await page.goto("/members");
  const dlg = await openDialog(page, page.locator('[role="button"][tabindex="0"]').first());
  await page.mouse.click(5, 5);
  await expect(dlg).toHaveCount(0);
});

test("the dialog loads the full profile the list deliberately doesn't carry", async ({ page }) => {
  // The directory ships a truncated bio_focus and no profile links (see
  // migration 20260901000007's cutover to bio_focus/bio_hobbies); the dialog
  // fetches the rest when it opens. This asserts the second half of that
  // bargain actually happens.
  const long = `Bio ${Date.now()} ` + "z".repeat(400);
  await page.goto("/profile");
  const bio = page.getByLabel(/^What are you working on, or into\?/);
  await bio.waitFor();

  // Wait for REACT to own the field before typing the value under test.
  //
  // /profile is server-rendered, so the textarea is present and fillable
  // before React attaches its onChange. A fill inside that window moves the
  // DOM node and nothing else: `bioFocus` state keeps the previous bio, the
  // save below writes THAT, and the router.refresh() afterwards re-renders
  // the field back to it. The failure then reads as the *previous run's*
  // bio sitting in the box, which is exactly how this surfaced — and it is
  // the same hydration race openDialog() above exists for, except a fill is
  // not idempotent the way a click is, so it cannot simply be replayed.
  //
  // The label's "N/500" counter is rendered from the same state as the
  // textarea's value, so it is the one on-screen signal that separates
  // "React took it" from "the DOM took it". A short sentinel is used rather
  // than `long` because both bios are 418 characters: the counter can only
  // discriminate at a length the field is not already showing.
  //
  // clear() before each fill is load-bearing for the same reason it is in
  // urlfilters.spec.ts — React initialises its _valueTracker from whatever
  // is in the box when it attaches, so re-filling an identical string
  // fires no change event and no amount of retrying would move the state.
  await expect(async () => {
    await bio.clear();
    await bio.fill("x");
    await expect(page.getByLabel(/^What are you working on, or into\? 1\/500/)).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  await bio.fill(long);
  await expect(bio).toHaveValue(long);
  await page.getByRole("button", { name: "Save changes" }).click();
  // The save is a client-side RPC followed by a router.refresh(), so wait for
  // the value to have actually round-tripped rather than for a banner.
  await expect(page.getByLabel(/^What are you working on, or into\?/)).toHaveValue(long, { timeout: 15_000 });

  await page.goto("/members");
  const card = page.locator('[role="button"][tabindex="0"]').filter({ hasText: "Bio " }).first();
  const dialog = await openDialog(page, card);
  // The card only carries the first 160 characters; the dialog must end up
  // with all 400+.
  await expect(dialog.getByText(long, { exact: false })).toBeVisible({ timeout: 10_000 });
});
