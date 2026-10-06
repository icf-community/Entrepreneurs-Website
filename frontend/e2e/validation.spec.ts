import { test, expect } from "@playwright/test";

// Phase 5: forms validate with the same Zod schema the server action uses,
// so every failing field is reported at once, beside itself, rather than one
// at a time in a banner at the top.

test("all failing fields report at once, beside themselves, focus on the first", async ({ page }) => {
  await page.goto("/opportunities/new");
  // Three bad fields: title too short, description too short, deadline in the past.
  await page.getByLabel("Role title").fill("a");
  await page.getByLabel("Job description").fill("too short");
  await page.locator('input[type="date"]').fill("2020-01-01");
  await page.getByLabel("Company").fill("E2E Co");
  await page.getByLabel("Salary / compensation").fill("£80k");
  await page.getByLabel("City / region").fill("London");
  await page.getByRole("radio", { name: "Both" }).check();
  await page.getByRole("button", { name: "Submit for review" }).click();

  // Still on the form — nothing was submitted.
  await expect(page).toHaveURL(/\/opportunities\/new/);

  // Scoped to the form: Next.js renders its own role="alert" route announcer.
  const alerts = page.locator("form").getByRole("alert");
  await expect(alerts).toHaveCount(3);
  await expect(alerts.nth(0)).toHaveText(/Role title is required/);
  await expect(alerts.nth(1)).toHaveText(/at least 20 characters/);
  await expect(alerts.nth(2)).toHaveText(/today or later/);

  // Focus landed on the first failing control.
  await expect(page.getByLabel("Role title")).toBeFocused();

  // Fixing everything clears them and the submission goes through.
  const goodTitle = `E2E Validation ${Date.now()}`;
  await page.getByLabel("Role title").fill(goodTitle);
  await page.getByLabel("Job description").fill("A description comfortably past twenty characters.");
  await page.locator('input[type="date"]').fill(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page).toHaveURL(/\/opportunities(\?submitted=1)?$/);

  // Clean up: the suite runs serially against a shared database, so a test
  // that submits has to remove what it submitted.
  await page.goto("/my-submissions");
  const row = () => page.getByTestId("submission-row").filter({ hasText: goodTitle });
  await row().getByRole("button", { name: "Delete" }).click();
  await row().getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByTestId("submission-row").filter({ hasText: goodTitle })).toHaveCount(0);
});
