import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { storageStatePath } from "./fixtures";

// ════════════════════════════════════════════════════════════════════
// Foundry · Admin members: the row's Actions menu and its two dialogs
//
// The two actions on a member row (Add/Edit committee, Delete) sit behind one
// "Actions for <name>" menu, and each opens a native dialog. No spec drove
// either before, so the wiring from menu to dialog to server action was
// untested. The server actions themselves are unchanged and are checked here
// by their effect on the database, not by what the page says.
//
// Runs with the seeded admin storageState (the admin project's default).
// Members are throwaway accounts this file creates and removes.
// ════════════════════════════════════════════════════════════════════

function service(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const STAMP = Date.now();
const FIRST = "Menuprobe";

type Seeded = { id: string; email: string; surname: string; full: string };

async function seedMember(admin: SupabaseClient, tag: string): Promise<Seeded> {
  const surname = `${tag}${STAMP}`;
  const email = `e2e-admin-members-${tag.toLowerCase()}-${STAMP}@imperial.ac.uk`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { first_name: FIRST, surname, role: "student" },
  });
  if (error) throw new Error(`seed ${tag}: ${error.message}`);
  const id = data.user!.id;
  const { error: upErr } = await admin
    .from("profiles")
    .update({ status: "approved", course: "MEng Computing", grad_year: 2028, intake_deferred_at: new Date().toISOString() })
    .eq("id", id);
  if (upErr) throw new Error(`approve ${tag}: ${upErr.message}`);
  return { id, email, surname, full: `${FIRST} ${surname}` };
}

async function profileOf(admin: SupabaseClient, id: string) {
  const { data } = await admin.from("profiles").select("is_committee, committee_role").eq("id", id).maybeSingle();
  return data;
}

/** Narrow the table to one member (the search is debounced into the URL) and return that row's menu button. */
async function menuFor(page: Page, m: Seeded) {
  await page.goto("/admin/members");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Search members").fill(m.surname);
  const trigger = page.getByRole("button", { name: `Actions for ${m.full}` });
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  return trigger;
}

test.describe("admin members: Actions menu", () => {
  let admin: SupabaseClient;
  let committeeMember: Seeded;
  let deleteMember: Seeded;

  test.beforeAll(async () => {
    test.setTimeout(60_000);
    admin = service();
    committeeMember = await seedMember(admin, "Committee");
    deleteMember = await seedMember(admin, "Delete");
  });

  test.afterAll(async () => {
    await admin.from("outbound_email").delete().in("to_address", [committeeMember.email, deleteMember.email]);
    await admin.from("admin_actions").delete().in("target_id", [committeeMember.id, deleteMember.id]);
    await Promise.all([committeeMember.id, deleteMember.id].map((id) => admin.auth.admin.deleteUser(id).catch(() => {})));
  });

  test("the menu opens from the keyboard, Escape closes it, and focus comes back to its button", async ({ page }) => {
    const trigger = await menuFor(page, committeeMember);
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Add to committee" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem", { name: "Add to committee" })).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("Add to committee saves the role, then Edit committee can remove it", async ({ page }) => {
    const trigger = await menuFor(page, committeeMember);

    await trigger.click();
    await page.getByRole("menuitem", { name: "Add to committee" }).click();
    const dialog = page.getByRole("dialog", { name: `Add ${committeeMember.full}` });
    await expect(dialog).toBeVisible();

    // A role is required: Save stays off until there is one.
    const save = dialog.getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();
    await dialog.getByLabel("Role").fill("E2E President");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(dialog).toBeHidden();

    await expect.poll(() => profileOf(admin, committeeMember.id)).toMatchObject({ is_committee: true, committee_role: "E2E President" });

    // Now a committee member, the same item reads Edit committee and offers removal.
    await page.reload();
    await page.getByLabel("Search members").fill(committeeMember.surname);
    await page.getByRole("button", { name: `Actions for ${committeeMember.full}` }).click();
    await page.getByRole("menuitem", { name: "Edit committee" }).click();
    const edit = page.getByRole("dialog", { name: `Edit ${committeeMember.full}` });
    await expect(edit).toBeVisible();
    await edit.getByRole("button", { name: "Remove from committee" }).click();
    await expect(edit).toBeHidden();

    await expect.poll(() => profileOf(admin, committeeMember.id)).toMatchObject({ is_committee: false });
  });

  test("Delete needs a reason, Cancel deletes nothing, and confirming removes the member", async ({ page }) => {
    const trigger = await menuFor(page, deleteMember);

    // Cancel: nothing is deleted.
    await trigger.click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog", { name: `Delete ${deleteMember.full}?` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect((await admin.auth.admin.getUserById(deleteMember.id)).data.user).not.toBeNull();

    // Confirm: disabled until a reason is typed, then the account is gone.
    await trigger.click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole("button", { name: "Permanently delete + email" });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("Reason (sent to user)").fill("e2e delete-menu test");
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toBeHidden();

    await expect.poll(async () => (await admin.auth.admin.getUserById(deleteMember.id)).data.user, { timeout: 15_000 }).toBeNull();
    expect(await profileOf(admin, deleteMember.id)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════
// A page's second sentence can sit behind an "i": the words must stay in the
// page (a screen reader reads them with the button) and open on focus.
// ════════════════════════════════════════════════════════════════════

test.describe("intro sentences behind an info tip", () => {
  test.use({ storageState: storageStatePath("student") });

  for (const [path, label, words] of [
    ["/my-activity", "How this list works", /We take your word for it/],
    ["/my-submissions", "Editing and deleting", /./],
  ] as const) {
    test(`${path}: "${label}" keeps its words in the page and opens from the keyboard`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const button = page.getByRole("button", { name: label });
      await expect(button).toBeVisible();

      // The sentence is in the DOM even while the tip is closed, and the button is described by it.
      const tip = page.getByRole("tooltip", { includeHidden: true }).filter({ hasText: words }).first();
      await expect(tip).toHaveCount(1);
      expect((await tip.textContent())?.trim().length ?? 0).toBeGreaterThan(20);

      await button.focus();
      await expect(tip).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(tip).toBeHidden();
    });
  }
});
