import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { USERS, storageStatePath } from "./fixtures";

// Graduates transition instead of being deleted (20261011000005): an admin
// asks the due cohort once; the student answers on /home and becomes a
// recent graduate, account and all intact. Runs in the admin project with
// the seeded `graduate` student, whose graduation year the test moves into
// the past so only they are due.

const service = (): SupabaseClient =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

test("an admin asks a graduating student, who confirms and stays a member", async ({ page, browser }) => {
  const admin = service();
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const gradId = users.users.find((u) => u.email === USERS.graduate.email)!.id;
  await admin.from("profiles")
    .update({ role: "student", grad_year: 1951, graduation_prompted_at: null, graduation_confirmed_at: null })
    .eq("id", gradId);

  await page.goto("/admin/graduates");
  await page.getByLabel("Cutoff graduation year").fill("1951");
  await page.getByRole("button", { name: "Preview who will be asked" }).click();
  await expect(page.getByRole("heading", { name: /student.* will be asked/ })).toBeVisible();
  await expect(page.getByText(`${USERS.graduate.firstName} ${USERS.graduate.surname}`)).toBeVisible();
  await page.getByRole("button", { name: "Ask them to confirm" }).click();
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/Asked [1-9]\d* students?; /)).toBeVisible();

  // Nobody was deleted, and the prompt email is queued.
  const { data: prof } = await admin.from("profiles").select("role, graduation_prompted_at").eq("id", gradId).single();
  expect(prof?.role).toBe("student");
  expect(prof?.graduation_prompted_at).not.toBeNull();
  const { data: mail } = await admin.from("outbound_email").select("subject").eq("to_address", USERS.graduate.email)
    .like("subject", "Have you graduated%");
  expect(mail?.length).toBeGreaterThan(0);

  const ctx = await browser.newContext({ storageState: storageStatePath("graduate") });
  const grad = await ctx.newPage();
  await grad.goto("/home");
  const prompt = grad.getByRole("region", { name: "Have you graduated?" });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Yes, I've graduated" }).click();
  await prompt.getByRole("button", { name: "Save" }).click();
  await expect(grad.getByText(/now listed as a recent graduate/)).toBeVisible();
  await expect(prompt).toHaveCount(0);
  await ctx.close();

  const { data: after } = await admin.from("profiles").select("role, graduation_confirmed_at").eq("id", gradId).single();
  expect(after?.role).toBe("recent_grad");
  expect(after?.graduation_confirmed_at).not.toBeNull();
  const { data: edu } = await admin.from("member_education").select("has_completed_degree").eq("member_id", gradId).single();
  expect(edu?.has_completed_degree).toBe(true);
});
