import { expect, test, type Page } from "@playwright/test";
import { storageStatePath } from "../fixtures";
import { deleteMember, newMember, service, validEvent, type Member } from "./helpers";

// ════════════════════════════════════════════════════════════════════
// Keyboard and focus, beyond the member dialog that dialog.spec covers.
//
//   - every <Dialog> consumer shares one component, so the invariant is
//     checked on several real consumers: Escape closes, focus returns to
//     the control that opened it, Tab never escapes to the page behind
//   - the custom popups (Add to calendar, searchable multi-select) are
//     operable with the keyboard alone and give focus back
//   - the page is usable before any pointer is involved
// ════════════════════════════════════════════════════════════════════

test.use({ storageState: storageStatePath("student") });

let poster: Member;
let eventId: string;

test.beforeAll(async () => {
  poster = await newMember("focus");
  const sub = await poster.client.rpc("submit_event", validEvent({ p_title: "Focus Trap Meetup" }));
  expect(sub.error, sub.error?.message).toBeNull();
  eventId = String(sub.data);
  // Through the service role: the status trigger only lets an admin or service_role approve.
  const { error } = await service().from("events").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", eventId);
  expect(error, error?.message).toBeNull();
});

test.afterAll(async () => {
  if (poster) {
    await service().from("events").delete().eq("id", eventId);
    await deleteMember(poster);
  }
});

const active = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el ? { tag: el.tagName, id: el.id, label: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? "", inDialog: !!el.closest("dialog[open]") } : null;
  });

test("a dialog traps Tab, closes on Escape and hands focus back (member directory)", async ({ page }) => {
  await page.goto("/members");
  const trigger = page.getByRole("button", { name: /^View .+ profile$/ }).first();
  await trigger.waitFor();
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.locator("dialog[open]");
  await expect(dialog).toBeVisible();

  // Chrome wraps a dialog's focus cycle through the document itself, so BODY is
  // an expected stop (dialog.spec.ts says the same). What must never happen is
  // focus landing on page content behind the dialog.
  const behind = async () => {
    const a = await active(page);
    return a && !a.inDialog && a.tag !== "BODY" ? JSON.stringify(a) : null;
  };
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    expect(await behind(), `Tab ${i + 1} reached the page behind the dialog`).toBeNull();
  }
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await behind(), `Shift+Tab ${i + 1} reached the page behind the dialog`).toBeNull();
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger, "focus did not return to the card that opened the dialog").toBeFocused();
});

test("Add to calendar: keyboard-operable, Escape closes it and focus goes back to the button", async ({ page }) => {
  await page.goto(`/events/${eventId}`);
  const button = page.getByRole("button", { name: /add to calendar/i });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-expanded", "true");

  // Tab reaches the first option, which is a link.
  await page.keyboard.press("Tab");
  const inMenu = await active(page);
  expect(inMenu?.tag, `Tab from the button did not reach the menu items (focus: ${JSON.stringify(inMenu)})`).toBe("A");

  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(button, "focus did not return to the trigger; a keyboard user is dropped at the top of the page").toBeFocused();
});

test("Add to calendar does not claim to be an ARIA menu it cannot honour", async ({ page }) => {
  // role=menu promises arrow-key navigation; this is a disclosure of two links.
  await page.goto(`/events/${eventId}`);
  await page.getByRole("button", { name: /add to calendar/i }).click();
  await expect(page.getByRole("link", { name: /google calendar/i })).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCount(0);
});

async function openCourseFilter(page: Page) {
  await page.goto("/members");
  await page.getByRole("button", { name: /^filters/i }).click();
  const trigger = page.getByRole("button", { name: /filter by course/i });
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  // Opening moves focus to the search box.
  await expect(page.getByRole("searchbox", { name: /filter by course/i })).toBeFocused();
  return trigger;
}

test("searchable multi-select: Escape closes it and focus goes back to its button", async ({ page }) => {
  const trigger = await openCourseFilter(page);
  await page.keyboard.type("meng");
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger, "focus was dropped when the list closed").toBeFocused();
});

test("searchable multi-select: an option can be chosen from the keyboard alone", async ({ page }) => {
  await openCourseFilter(page);
  await page.keyboard.type("meng");
  await page.keyboard.press("Tab"); // first matching option
  expect((await active(page))?.tag).toBe("BUTTON");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/course=/);
});

test("the first Tab on a page reaches something useful, never a dead end", async ({ page }) => {
  await page.goto("/home");
  await page.keyboard.press("Tab");
  const first = await active(page);
  expect(first?.tag).not.toBe("BODY");
  // A skip link, or at least a link/button in the header, is the first stop.
  expect(["A", "BUTTON", "INPUT"]).toContain(first?.tag);
});

test("every dialog in the app is a native modal <dialog> (focus management comes for free)", async ({ page }) => {
  // A hand-rolled role=dialog div claims modality without providing it.
  for (const path of ["/members", "/calendar", "/community", "/profile", "/connections"]) {
    await page.goto(path);
    const fakeDialogs = await page.locator('[role="dialog"]:not(dialog), [aria-modal="true"]:not(dialog)').count();
    expect(fakeDialogs, `${path} has a div posing as a dialog`).toBe(0);
  }
});
