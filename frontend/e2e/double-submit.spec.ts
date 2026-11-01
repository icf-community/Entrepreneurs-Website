import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { USERS } from "./fixtures";

// Double submits under a slow server (programme S0, docs/audits/D9).
//
// Every server action response is held for 1.5 s, as a slow mobile
// connection would, and each control is hit twice. The outcome that
// matters is the one in the database: exactly one listing, one bookmark,
// one like. Controls whose second call the database itself makes safe
// (idempotent RPCs, row locks, unique indexes) are listed with that reason
// in src/lib/actions/doubleSubmit.test.ts; this spec covers the rest.

const service = (): SupabaseClient =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

/** Hold every server action (a POST with a Next-Action header) for `ms`. */
async function slowServerActions(page: Page, ms = 1500): Promise<void> {
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (req.method() === "POST" && req.headers()["next-action"]) {
      await new Promise((r) => setTimeout(r, ms));
    }
    await route.continue();
  });
}

const futureDate = () => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

async function studentId(admin: SupabaseClient): Promise<string> {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  return data.users.find((u) => u.email === USERS.student.email)!.id;
}

const LISTINGS = [
  {
    name: "opportunity", path: "/opportunities/new", table: "opportunities", titleColumn: "position_name",
    async fill(page: Page, title: string) {
      await page.getByLabel(/^Role title/).fill(title);
      await page.getByLabel(/^Company/).fill("E2E Double Co");
      await page.getByLabel(/^Salary \/ compensation/).fill("£80k");
      await page.getByLabel(/^City \/ region/).fill("London");
      await page.getByLabel(/^Job description/).fill("A listing submitted twice in a row on a slow connection.");
      await page.locator('input[type="date"]').fill(futureDate());
      await page.getByRole("radio", { name: "Both" }).check();
    },
  },
  {
    name: "event", path: "/events/new", table: "events", titleColumn: "title",
    async fill(page: Page, title: string) {
      await page.getByLabel(/^Title/).fill(title);
      await page.getByLabel(/^Description/).fill("An event submitted twice in a row on a slow connection.");
      await page.getByLabel(/^Luma link/).fill("https://lu.ma/e2e-double");
      await page.locator('input[type="datetime-local"]').fill(`${futureDate()}T18:00`);
      await page.getByLabel(/^Location/).fill("Imperial Business School");
      await page.getByLabel(/^Organiser name/).fill("E2E Organiser");
    },
  },
  {
    name: "vc_grant", path: "/vcs/new", table: "vcs_grants", titleColumn: "name",
    async fill(page: Page, title: string) {
      await page.getByLabel(/^Name/).fill(title);
      await page.getByLabel(/^Description/).fill("A fund submitted twice in a row on a slow connection.");
      await page.getByLabel(/^Link/).fill("https://example.com/e2e-double");
    },
  },
] as const;

for (const kind of LISTINGS) {
  test(`double submit: a ${kind.name} submitted twice on a slow connection is created once`, async ({ page }) => {
    const admin = service();
    const title = `E2E double ${kind.name} ${Date.now()}`;
    await page.goto(kind.path);
    await kind.fill(page, title);
    await slowServerActions(page);
    const submit = page.getByRole("button", { name: "Submit for review" });
    await submit.dblclick();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${kind.path.replace("/new", "")}(\\?submitted=1)?$`), { timeout: 20_000 });
    const { data } = await admin.from(kind.table).select("id").eq(kind.titleColumn, title);
    expect(data, "one submission, not one per click").toHaveLength(1);
    await admin.from(kind.table).delete().eq(kind.titleColumn, title);
  });
}

test("double submit: a bookmark tapped twice on a slow connection ends bookmarked once", async ({ page }) => {
  const admin = service();
  const me = await studentId(admin);
  const { data: opp } = await admin.from("opportunities")
    .insert({
      posted_by: me, status: "approved", position_name: `E2E bookmark ${Date.now()}`, company: "Acme", pay: "Paid",
      location_type: "remote", description: "A role to bookmark twice on a slow connection.", start_month: 6,
      start_year: 2027, application_deadline: futureDate(), contact_email: "jobs@acme.test", apply_method: "email",
      approved_at: new Date().toISOString(), approved_by: me, eligible_audience: "both", creation_source: "member",
    })
    .select("id").single();
  try {
    await page.goto(`/opportunities/${opp!.id}`);
    // Hydrated first: a click before React attaches its handlers does nothing.
    await page.waitForLoadState("networkidle");
    await slowServerActions(page);
    const posts: string[] = [];
    page.on("request", (r) => { if (r.method() === "POST" && r.headers()["next-action"]) posts.push(r.url()); });
    page.on("response", async (r) => {
      if (r.request().method() === "POST" && r.request().headers()["next-action"]) {
        // Diagnostic only — a slowed response's body can legitimately be
        // gone by the time this fires (CDP "No data found for resource"),
        // which an unhandled rejection here would otherwise turn into a
        // test failure unrelated to the double-submit assertion below.
        const body = await r.text().catch((e) => `<unreadable: ${e.message}>`);
        console.log("action response", r.status(), body.slice(0, 300));
      }
    });
    const save = page.getByRole("button", { name: "Bookmark this opportunity" });
    await save.dblclick();
    await page.waitForTimeout(2500);
    console.log(`bookmark server actions sent: ${posts.length}`);
    await expect.poll(async () => {
      const { data } = await admin.from("opportunity_bookmarks").select("user_id").eq("opportunity_id", opp!.id);
      return data?.length;
    }, { timeout: 10_000 }).toBe(1);
  } finally {
    await admin.from("opportunities").delete().eq("id", opp!.id);
  }
});
