import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { USERS } from "./fixtures";

// Launch programme B4/B5/B7/B8/B25: when a request fails, the member is
// told and can try again. Each test forces one failure with page.route and
// asserts the visible recovery path, not just that nothing crashed.
//
// Runs under the `member` project (approved student session).

/** Open the first directory card's dialog, tolerating the hydration window. */
async function openFirstMember(page: Page) {
  await page.goto("/members");
  const trigger = page.getByRole("button", { name: /^View .+ profile$/ }).first();
  await trigger.waitFor();
  const dialog = page.locator("dialog");
  await expect(async () => {
    if ((await dialog.count()) === 0) await trigger.click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return dialog;
}

test("the member dialog says when the full profile failed, and Try again recovers", async ({ page }) => {
  let fail = true;
  await page.route("**/rest/v1/profiles?**", (route) =>
    fail ? route.fulfill({ status: 500, body: "{}" }) : route.continue(),
  );
  const dialog = await openFirstMember(page);
  await expect(dialog.getByText("Couldn't load the full profile.")).toBeVisible();

  fail = false;
  await dialog.getByRole("button", { name: "Try again" }).first().click();
  await expect(dialog.getByText("Couldn't load the full profile.")).toHaveCount(0);
});

test("the Connect panel is one request, says when it failed, and Try again recovers", async ({ page }) => {
  let calls = 0;
  let fail = true;
  await page.route("**/rest/v1/rpc/connection_panel_state*", (route) => {
    calls++;
    return fail ? route.fulfill({ status: 500, body: "{}" }) : route.continue();
  });
  // B25: the four old reads must not come back.
  const legacy: string[] = [];
  page.on("request", (r) => {
    if (/rpc\/(connection_state_with|my_connection_quota|connections_enabled|connection_consent_version)/.test(r.url())) {
      legacy.push(r.url());
    }
  });

  const dialog = await openFirstMember(page);
  await expect(dialog.getByText("Couldn't check your connection status.")).toBeVisible();
  expect(calls).toBe(1);

  fail = false;
  // Wait for the retry's response, not just for the error text to go: the
  // loading state hides the text before the request has even been sent.
  const retried = page.waitForResponse((r) => r.url().includes("rpc/connection_panel_state") && r.ok());
  await dialog.getByRole("button", { name: "Try again" }).last().click();
  await retried;
  await expect(dialog.getByText("Couldn't check your connection status.")).toHaveCount(0);
  expect(calls).toBe(2);
  expect(legacy).toEqual([]);

  // useId: no duplicated ids anywhere on the page.
  const dupes = await page.evaluate(() => {
    const seen = new Map<string, number>();
    document.querySelectorAll("[id]").forEach((el) => seen.set(el.id, (seen.get(el.id) ?? 0) + 1));
    return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  });
  expect(dupes).toEqual([]);
});

test("blocked members say when they couldn't load, instead of disappearing", async ({ page }) => {
  let fail = true;
  await page.route("**/rest/v1/rpc/list_my_blocked_members*", (route) =>
    fail ? route.fulfill({ status: 500, body: "{}" }) : route.continue(),
  );
  await page.goto("/settings");
  await expect(page.getByText("Couldn't load the people you've blocked.")).toBeVisible();

  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Couldn't load the people you've blocked.")).toHaveCount(0);
});

test.describe("with a live opportunity", () => {
  const TITLE = "Resilience Bookmark Engineer";
  let opportunityId = "";

  const admin = () =>
    createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

  test.beforeAll(async () => {
    const db = admin();
    const { data: userList } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
    const idFor = (email: string) =>
      userList.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
    const student = idFor(USERS.student.email);
    const approver = idFor(USERS.admin.email);
    if (!student || !approver) throw new Error("seeded users not found");
    const { data, error } = await db
      .from("opportunities")
      .insert({
        eligible_audience: "both",
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: approver,
        posted_by: approver,
        position_name: TITLE,
        company: "Resilience Co",
        pay: "£1",
        location_type: "remote",
        description: "Seeded so the bookmark failure test has a card to click.",
        start_month: 1,
        start_year: 2030,
        application_deadline: new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10),
        apply_method: "email",
        contact_email: USERS.admin.email,
      })
      .select("id")
      .single();
    if (error) throw new Error(`seed opportunity: ${error.message}`);
    opportunityId = data!.id as string;
  });

  test.afterAll(async () => {
    if (!opportunityId) return;
    const db = admin();
    await db.from("opportunity_bookmarks").delete().eq("opportunity_id", opportunityId);
    await db.from("opportunities").delete().eq("id", opportunityId);
  });

test("a failed bookmark flips back and says so", async ({ page }) => {
  await page.goto(`/opportunities?q=${encodeURIComponent(TITLE)}`);
  const star = page.getByRole("button", { name: /Bookmark this opportunity|Remove bookmark/ }).first();
  await star.waitFor();
  const before = await star.getAttribute("aria-pressed");

  // Server actions are POSTs carrying a Next-Action header.
  await page.route("**/opportunities*", (route) =>
    route.request().method() === "POST" && route.request().headers()["next-action"]
      ? route.fulfill({ status: 500, body: "" })
      : route.continue(),
  );
  await star.click();
  await expect(page.getByRole("alert").getByText("Couldn't update your bookmark. Please try again.")).toBeVisible();
  await expect(star).toHaveAttribute("aria-pressed", before ?? "false");
});
});
