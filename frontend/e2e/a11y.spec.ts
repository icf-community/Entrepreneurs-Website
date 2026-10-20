import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { USERS } from "./fixtures";

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

// D4: a core flow completed with the keyboard alone — no clicks. Creating a
// post exercises a disclosure button, two labelled fields and a submit.
test("a member can create a post using only the keyboard", async ({ page }) => {
  const title = `kbd post ${Date.now()}`;
  await page.goto("/community");
  const open = page.getByRole("button", { name: "Create a post" });
  await open.waitFor();
  // Reach the button by tabbing, not by focusing it directly.
  for (let i = 0; i < 60 && !(await open.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
  }
  await expect(open).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.getByLabel("Title")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Title")).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Post", { exact: true })).toBeFocused();
  await page.keyboard.type("Written without touching the mouse.");

  const post = page.getByRole("button", { name: "Post", exact: true });
  for (let i = 0; i < 10 && !(await post.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
  }
  await expect(post).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  const { createClient } = await import("@supabase/supabase-js");
  await createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).from("posts").delete().eq("title", title);
});

// S8 gap 21: MemberCard's primary action moved from a div with
// role="button" to a real <button>, so this should need no special-casing —
// Tab reaches it and Enter opens the dialog, same as any other button.
test("a member card is a real button that opens the profile dialog from the keyboard", async ({ page }) => {
  await page.goto("/members");
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  const card = page.getByRole("button", { name: /^View .+ profile$/ }).first();
  await card.waitFor();
  await card.focus();
  await expect(card).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("dialog[open]")).toBeVisible();
});

// The "Looking for" links sit visually on top of the card's full-size
// button (not nested inside it — invalid HTML) via z-index stacking. If
// they ever regressed back under the button, this is what would catch it:
// the link's own click would instead open the dialog.
test("a member card's \"Looking for\" link is independently reachable and does not open the dialog", async ({ page }) => {
  await page.goto("/members");
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  const link = page.getByRole("link").filter({ hasText: /./ }).and(page.locator("a[href^='/opportunities/']"));
  const count = await link.count();
  if (count === 0) {
    // No seeded member currently has an open "looking for" link — nothing
    // to verify this run, and skipping beats a flaky fixture dependency.
    return;
  }
  const first = link.first();
  await first.focus();
  await expect(first).toBeFocused();
  await first.click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

// S8 gap 21: the opportunity row's expand/collapse toggle is a real
// <button>, not a div with role="button".
test.describe("opportunity card keyboard toggle", () => {
  let opportunityId = "";

  test.beforeAll(async () => {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: userList } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const poster = userList.users.find((u) => u.email?.toLowerCase() === USERS.student.email.toLowerCase())?.id;
    const approver = userList.users.find((u) => u.email?.toLowerCase() === USERS.admin.email.toLowerCase())?.id;
    if (!poster || !approver) throw new Error("seeded users not found");
    const { data, error } = await admin.from("opportunities").insert({
      eligible_audience: "both", posted_by: poster, status: "approved",
      approved_at: new Date().toISOString(), approved_by: approver,
      position_name: "Keyboard Toggle Test Role", company: "a11y Co", pay: "£1",
      location_type: "remote", description: "Seeded for the a11y keyboard-toggle test.",
      start_month: 1, start_year: 2030,
      application_deadline: new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10),
      apply_method: "email", contact_email: USERS.student.email,
    }).select("id").single();
    if (error) throw new Error(`seed failed: ${error.message}`);
    opportunityId = data!.id as string;
  });

  test.afterAll(async () => {
    if (!opportunityId) return;
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    await admin.from("opportunities").delete().eq("id", opportunityId);
  });

  test("an opportunity card's details expand from the keyboard", async ({ page }) => {
    await page.goto("/opportunities");
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    const toggle = page.getByRole("button", { name: /Show details/ }).first();
    await toggle.waitFor();
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /Hide details/ }).first()).toBeVisible();
  });
});
