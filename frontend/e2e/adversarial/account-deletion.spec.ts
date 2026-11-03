import { expect, test as base } from "@playwright/test";
import { assertLocal, deleteMember, newMember, psql, storageStateFor, type Member } from "./helpers";

// ════════════════════════════════════════════════════════════════════
// Settings → "Delete my account", through the browser. Deletion moved from a
// browser RPC to a server action (so the cached directory is dropped with the
// account), and nothing else drove this button. A throwaway member, never a
// seeded one.
// ════════════════════════════════════════════════════════════════════

let state: Awaited<ReturnType<typeof storageStateFor>>;
const test = base.extend({
  storageState: async ({}, provide) => {
    await provide(state as never);
  },
});

let m: Member;

test.beforeAll(async () => {
  test.setTimeout(60_000);
  assertLocal();
  m = await newMember("deleteme");
  state = await storageStateFor(m);
});

test.afterAll(async () => {
  if (m) await deleteMember(m);
});

const exists = () => psql(`select count(*) from auth.users where id = '${m.id}'`) === "1";

test("the confirm button stays disabled until the email is typed exactly, and nothing is deleted", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete my account" }).click();
  const confirm = page.getByRole("button", { name: "Permanently delete account" });
  await expect(confirm).toBeDisabled();
  await page.locator('input#confirm-email[type="text"]').fill("someone-else@imperial.ac.uk");
  await expect(confirm).toBeDisabled();
  expect(exists()).toBe(true);
});

test("a member deletes their account: the account is gone and they land on the home page signed out", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.locator('input#confirm-email[type="text"]').fill(m.email);
  await page.getByRole("button", { name: "Permanently delete account" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
  expect(exists()).toBe(false);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login/);
});
