import { expect, test, type Page } from "@playwright/test";
import { storageStatePath } from "../fixtures";
import { service } from "./helpers";

// ════════════════════════════════════════════════════════════════════
// Connection loss during a submit, for each listing form.
//
//   A. offline before the request leaves: the member is told, the form
//      keeps what they typed, and coming back online and pressing Submit
//      again creates exactly one listing.
//   B. the server processed it but the response never arrived (the
//      realistic mobile case): the member is told it failed, and when they
//      press Submit again the database still holds exactly one listing
//      (finding D-1: the submit_* RPCs return the identical pending row).
// ════════════════════════════════════════════════════════════════════

test.use({ storageState: storageStatePath("student") });

const futureDate = () => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

const FORMS = [
  {
    name: "opportunity", path: "/opportunities/new", table: "opportunities", titleColumn: "position_name",
    async fill(page: Page, title: string) {
      await page.getByLabel(/^Role title/).fill(title);
      await page.getByLabel(/^Company/).fill("Offline Co");
      await page.getByLabel(/^Salary \/ compensation/).fill("£80k");
      await page.getByLabel(/^City \/ region/).fill("London");
      await page.getByLabel(/^Job description/).fill("A listing submitted while the connection drops.");
      await page.locator('input[type="date"]').fill(futureDate());
      await page.getByRole("radio", { name: "Both" }).check();
    },
    field: (page: Page) => page.getByLabel(/^Role title/),
  },
  {
    name: "event", path: "/events/new", table: "events", titleColumn: "title",
    async fill(page: Page, title: string) {
      await page.getByLabel(/^Title/).fill(title);
      await page.getByLabel(/^Description/).fill("An event submitted while the connection drops.");
      await page.getByLabel(/^Luma link/).fill("https://lu.ma/offline");
      await page.locator('input[type="datetime-local"]').fill(`${futureDate()}T18:00`);
      await page.getByLabel(/^Location/).fill("Imperial Business School");
      await page.getByLabel(/^Organiser name/).fill("Offline Organiser");
    },
    field: (page: Page) => page.getByLabel(/^Title/),
  },
  {
    name: "vc_grant", path: "/vcs/new", table: "vcs_grants", titleColumn: "name",
    async fill(page: Page, title: string) {
      await page.getByLabel(/^Name/).fill(title);
      await page.getByLabel(/^Description/).fill("A fund submitted while the connection drops.");
      await page.getByLabel(/^Link/).fill("https://example.com/offline");
    },
    field: (page: Page) => page.getByLabel(/^Name/),
  },
] as const;

const rowsFor = async (table: string, col: string, title: string) => {
  const { data } = await service().from(table).select("id").eq(col, title);
  return data ?? [];
};

for (const form of FORMS) {
  test(`${form.name}: offline at submit tells the member, keeps the draft, and one retry creates one row`, async ({ page, context }) => {
    const title = `Offline ${form.name} ${Date.now()}`;
    await page.goto(form.path);
    await form.fill(page, title);

    await context.setOffline(true);
    await page.getByRole("button", { name: "Submit for review" }).click();

    // Told something, still on the form, still holding the draft.
    await expect(page.getByRole("alert").or(page.getByText(/couldn.t|could not|try again|went wrong|offline|network/i)).first()).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(new RegExp(`${form.path}$`));
    await expect(form.field(page)).toHaveValue(title);
    expect(await rowsFor(form.table, form.titleColumn, title), "an offline submit created a row").toHaveLength(0);

    await context.setOffline(false);
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page).toHaveURL(new RegExp(`${form.path.replace("/new", "")}(\\?submitted=1)?$`), { timeout: 20_000 });
    expect(await rowsFor(form.table, form.titleColumn, title), "one submission after the retry").toHaveLength(1);

    await service().from(form.table).delete().eq(form.titleColumn, title);
  });

  test(`${form.name}: the response is lost after the server committed, member sees an error and a retry still leaves one row`, async ({ page }) => {
    const title = `Lost reply ${form.name} ${Date.now()}`;
    await page.goto(form.path);
    await form.fill(page, title);

    let dropped = false;
    await page.route("**/*", async (route) => {
      const req = route.request();
      if (!dropped && req.method() === "POST" && req.headers()["next-action"]) {
        dropped = true;
        await route.fetch(); // the server runs the action to completion…
        await route.abort("connectionreset"); // …and the browser never sees the answer
        return;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect.poll(() => dropped).toBe(true);
    // The member is not left looking at a spinner forever.
    await expect(page.getByRole("button", { name: "Submit for review" })).toBeEnabled({ timeout: 20_000 });

    const afterFirst = (await rowsFor(form.table, form.titleColumn, title)).length;
    expect(afterFirst, "the server should have committed the first attempt").toBe(1);

    // They retry, as anyone would.
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page).toHaveURL(new RegExp(`${form.path.replace("/new", "")}(\\?submitted=1)?$`), { timeout: 20_000 });
    const total = (await rowsFor(form.table, form.titleColumn, title)).length;
    expect(total, "a retry after a lost reply must not duplicate the listing (D-1, migration 20261026000009)").toBe(1);

    await service().from(form.table).delete().eq(form.titleColumn, title);
  });
}
