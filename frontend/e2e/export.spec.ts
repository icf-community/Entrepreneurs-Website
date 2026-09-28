import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { USERS } from "./fixtures";

// F-x2: Settings → "Download my data" saves a JSON file of the member's own
// data. rls_smoke.sql proves what the RPC leaves out (other members' notes,
// who blocked you, declines); this proves the button reaches it and the
// browser gets a file. Runs under the `member` project.

test("Download my data saves the member's own data as JSON", async ({ page }) => {
  await page.goto("/settings");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download my data" }).click();
  const download = await downloading;

  expect(download.suggestedFilename()).toMatch(/^foundry-my-data-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(data.format_version).toBe(1);
  expect(data.account.email).toBe(USERS.student.email);
  expect(data.profile).not.toHaveProperty("avatar_path");
  expect(Array.isArray(data.connections)).toBe(true);
});
