import { test, expect, type Page } from "@playwright/test";

async function bio(page: Page, text: string) {
  await page.bringToFront();
  const input = page.getByLabel(/^What are you working on, or into\?/);
  await expect(async () => {
    await input.clear();
    await input.fill("x");
    await expect(page.getByLabel(/^What are you working on, or into\? 1\/500/)).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await input.fill(text);
}

test("two profile tabs preserve the first save and let the stale tab reload", async ({ page, context }) => {
  const other = await context.newPage();
  try {
    await page.goto("/profile");
    await other.goto("/profile");
    await bio(page, "First tab saved this profile");
    await bio(other, "Stale tab must not overwrite it");
    await page.bringToFront();
    const firstResponse = page.waitForResponse(r => r.url().includes("/rpc/update_profile") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Save changes" }).click();
    expect((await firstResponse).ok()).toBe(true);
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    await other.bringToFront();
    const rejected = other.waitForResponse(r => r.url().includes("/rpc/update_profile") && r.request().method() === "POST");
    await other.getByRole("button", { name: "Save changes" }).click();
    const response = await rejected;
    expect(await response.json()).toMatchObject({ code: "PT409" });
    await expect(other.getByText("This changed in another tab — reload before saving.", { exact: true })).toBeVisible();
    await expect(other.getByLabel(/^What are you working on, or into\?/)).toHaveValue("Stale tab must not overwrite it");
    await other.reload();
    await expect(other.getByLabel(/^What are you working on, or into\?/)).toHaveValue("First tab saved this profile");
    // A successful save updates the local revision: no reload is needed to save again.
    await bio(page, "Second save from the winning tab");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    await other.reload();
    await expect(other.getByLabel(/^What are you working on, or into\?/)).toHaveValue("Second save from the winning tab");
  } finally { await other.close(); }
});
