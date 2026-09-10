import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { USERS, storageStatePath } from "./fixtures";

// ════════════════════════════════════════════════════════════════════
// Foundry · Post-approval intake (/intake)
//
// Replaces the old /onboarding/preview coverage now that the rebuilt
// intake is live and wired to submit_intake/defer_intake — see
// 20260901000006's header comment for the identity/intake split this
// route depends on.
//
// The seeded student is approved with intake_deferred_at already set
// (global-setup.ts), so every other spec's `/home` navigation is never
// bounced here. This file borrows that user and clears the deferral for
// its own duration, restoring it in afterAll — playwright.config.ts runs
// with workers: 1 / fullyParallel: false, so spec files never run
// concurrently, but they do run in sequence against the same seeded DB.
// ════════════════════════════════════════════════════════════════════

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test.describe("post-approval intake", () => {
  test.use({ storageState: storageStatePath("student") });

  let studentId: string;

  test.beforeAll(async () => {
    const db = adminClient();
    const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
    const found = list.users.find((u) => u.email?.toLowerCase() === USERS.student.email.toLowerCase());
    if (!found) throw new Error("seeded student not found");
    studentId = found.id;

    await db
      .from("profiles")
      .update({ intake_deferred_at: null, profile_version: 1 })
      .eq("id", studentId);
  });

  test.afterAll(async () => {
    const db = adminClient();
    await db
      .from("profiles")
      .update({ intake_deferred_at: new Date().toISOString(), profile_version: 1 })
      .eq("id", studentId);
  });

  test("an approved member who has never seen it is bounced from /home to /intake", async ({ page }) => {
    await page.goto("/home");
    await expect(page).toHaveURL(/\/intake$/);
    await expect(page.getByRole("heading", { name: "Put a face to it" })).toBeVisible();
  });

  test("Continue with nothing filled in still advances — every field here is optional", async ({ page }) => {
    await page.goto("/intake");
    await page.getByRole("button", { name: /Continue/ }).click();
    await expect(page.getByText(/Good to have you,/)).toBeVisible();
  });

  // StepRail.tsx (a029642) deliberately made every non-current step
  // pressable, forward or back — almost everything past screen 01 is
  // optional, and the server enforces the few compulsory fields at
  // Finish/Skip regardless of click order. This asserts that contract
  // rather than a "visited only" gate the rail no longer has.
  test("the rail lets you jump ahead to any screen, not just a visited one", async ({ page }) => {
    await page.goto("/intake");

    const rail = page.getByRole("navigation", { name: "Intake progress" });
    await rail.getByRole("button", { name: /Skills/ }).click();
    await expect(page.getByRole("heading", { name: "What are you actually good at?" })).toBeVisible();
  });

  // A student's CV and LinkedIn are compulsory (20260901000013) — "Skip for
  // now" must not be a way around that, so it's hidden until both are
  // already saved on the profile row, not just until the member types them.
  test("Skip for now is hidden until the compulsory CV and LinkedIn are on file", async ({ page }) => {
    await page.goto("/intake");
    await expect(page.getByRole("button", { name: "Skip for now" })).toHaveCount(0);
  });

  test("Skip for now defers intake once CV/LinkedIn are on file, and lands on /home without bouncing back", async ({ page }) => {
    // Seeded directly rather than walked through the real upload UI — this
    // test is about defer_intake's gate, not the CV/LinkedIn screens
    // themselves, which have their own coverage.
    const db = adminClient();
    await db.from("profiles").update({ cv_path: "seed/cv.pdf", linkedin_url: "https://linkedin.com/in/seed" }).eq("id", studentId);

    await page.goto("/intake");
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page).toHaveURL(/\/home$/);

    // The deferral must persist, not just last for the one navigation.
    await page.goto("/home");
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByText(/finishes your profile/i)).toBeVisible();

    // Put it back to "never seen, nothing on file" for the remaining tests.
    await db.from("profiles").update({ intake_deferred_at: null, cv_path: null, linkedin_url: null }).eq("id", studentId);
  });

  test("an admin previewing /intake is never bounced there from /home", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("admin") });
    const page = await context.newPage();
    await page.goto("/home");
    await expect(page).toHaveURL(/\/home$/);
    await context.close();
  });
});
