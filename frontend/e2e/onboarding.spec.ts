import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { USERS, storageStatePath } from "./fixtures";

// ════════════════════════════════════════════════════════════════════
// Foundry · Onboarding (/onboarding): step 1 "Continue" must only advance
//
// Continue and the final submit button used to be one <Button> at the same
// position, so React reused the DOM node and flipped its type to "submit"
// during the click that advanced the step. The browser then ran the click's
// default action on a submit button: a student's first Continue completed
// onboarding, and a non-student got a native "required" bubble on the next
// step's LinkedIn field. Each button now has its own key.
//
// The seeded student is borrowed and put back to pending_onboarding for the
// duration (the same approach as intake.spec.ts; playwright.config.ts runs
// one worker, so spec files never overlap), then restored exactly.
// ════════════════════════════════════════════════════════════════════

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const COLUMNS = "role, status, course, grad_year, linkedin_url, github_url, portfolio_url";

test.describe("onboarding", () => {
  test.use({ storageState: storageStatePath("student") });

  let studentId: string;
  let original: Record<string, unknown>;

  test.beforeAll(async () => {
    const db = adminClient();
    const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
    const found = list.users.find((u) => u.email?.toLowerCase() === USERS.student.email.toLowerCase());
    if (!found) throw new Error("seeded student not found");
    studentId = found.id;
    const { data, error } = await db.from("profiles").select(COLUMNS).eq("id", studentId).single();
    if (error || !data) throw new Error(`read student profile: ${error?.message}`);
    original = data;
  });

  test.afterAll(async () => {
    const { error } = await adminClient().from("profiles").update(original).eq("id", studentId);
    if (error) throw new Error(`restore student profile: ${error.message}`);
  });

  async function resetToOnboarding(role: "student" | "alum") {
    const { error } = await adminClient()
      .from("profiles")
      .update({ role, status: "pending_onboarding", course: null, grad_year: null, linkedin_url: null, github_url: null, portfolio_url: null })
      .eq("id", studentId);
    if (error) throw new Error(`reset to pending_onboarding: ${error.message}`);
  }

  async function profile() {
    const { data } = await adminClient().from("profiles").select("status, course").eq("id", studentId).single();
    return data!;
  }

  test("a student's Continue advances to step 2 and does not submit", async ({ page }) => {
    await resetToOnboarding("student");

    await page.goto("/onboarding");
    // Hydrated first: a click before React attaches its handlers does nothing.
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/Step 1 of 2/).first()).toBeVisible();

    await page.getByLabel(/Course you.re studying/).fill("MEng Computing");
    await page.getByLabel("Expected graduation year").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByText(/Step 2 of 2/).first()).toBeVisible();
    // Give a stray submit time to run its RPC and navigate away.
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/onboarding$/);
    expect((await profile()).status).toBe("pending_onboarding");

    // The final button is still the one that submits.
    await page.getByRole("button", { name: "Finish onboarding" }).click();
    await expect(page).toHaveURL(/\/(intake|home)$/);
    expect((await profile()).status).toBe("approved");
  });

  test("a non-student's Continue advances without a validation bubble on the next step", async ({ page }) => {
    await resetToOnboarding("alum");

    await page.goto("/onboarding");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/Step 1 of 2/).first()).toBeVisible();

    await page.getByLabel(/Course studied/).fill("MEng Computing");
    await page.getByLabel("Graduation year").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByText(/Step 2 of 2/).first()).toBeVisible();
    // A browser validation bubble focuses the first invalid field. LinkedIn is
    // required here and empty, so it would be focused if Continue had submitted.
    await expect(page.locator("#linkedin")).not.toBeFocused();
    expect((await profile()).status).toBe("pending_onboarding");

    await page.getByLabel(/LinkedIn URL/).fill("https://www.linkedin.com/in/e2e-onboarding");
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect.poll(async () => (await profile()).status).toBe("pending_review");
  });
});
