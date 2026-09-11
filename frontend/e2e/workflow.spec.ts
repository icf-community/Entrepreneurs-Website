import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { storageStatePath, USERS } from "./fixtures";

// The full listing lifecycle through the real UI, against the ephemeral
// Supabase: student submits -> it's pending in their submissions -> they edit
// it -> an admin approves it -> it goes live on the members' board -> the
// student deletes it. Exercises the submission server action + RPC, the
// owner/admin RLS split, the approve RPC, and the public-listing RPC.
//
// Runs for all three listing types. They were built by copy-paste in both
// TypeScript and SQL and have since drifted, so "it works for opportunities"
// says nothing about the other two — which is what this parameterisation is
// for, and what makes the registry work safe to attempt.
//
// Runs under the `member` (approved-student) project; admin steps use a
// separate browser context loaded with the admin storageState.

// Field renders the label as "<name> *" plus an optional hint, and a couple of
// checkbox captions mention other fields by name ("…attendees use the Luma link
// to RSVP"), so every label lookup here is a start-anchored regex.
const futureDate = () => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const futureDateTime = () => `${futureDate()}T18:00`;

type Kind = {
  name: string;
  newPath: string;
  listPath: string;
  adminPath: string;
  /** The field the test renames to prove the edit round-tripped. */
  titleField: RegExp;
  fill: (page: Page, title: string) => Promise<void>;
};

const KINDS: Kind[] = [
  {
    name: "opportunity",
    newPath: "/opportunities/new",
    listPath: "/opportunities",
    adminPath: "/admin/opportunities",
    titleField: /^Role title/,
    async fill(page, title) {
      await page.getByLabel(/^Role title/).fill(title);
      await page.getByLabel(/^Company/).fill("E2E Test Co");
      await page.getByLabel(/^Salary \/ compensation/).fill("£80k");
      await page.getByLabel(/^City \/ region/).fill("London"); // default location type is hybrid
      await page.getByLabel(/^Job description/).fill("Automated end-to-end coverage listing.");
      await page.locator('input[type="date"]').fill(futureDate());
      // Apply method defaults to "Contact me directly" (email) — no URL needed.
    },
  },
  {
    name: "event",
    newPath: "/events/new",
    listPath: "/events",
    adminPath: "/admin/events",
    titleField: /^Title/,
    async fill(page, title) {
      await page.getByLabel(/^Title/).fill(title);
      await page.getByLabel(/^Description/).fill("Automated end-to-end coverage event listing.");
      await page.getByLabel(/^Luma link/).fill("https://lu.ma/e2e-coverage");
      await page.locator('input[type="datetime-local"]').fill(futureDateTime());
      await page.getByLabel(/^Location/).fill("Imperial Business School");
      await page.getByLabel(/^Organiser name/).fill("E2E Organiser");
    },
  },
  {
    name: "vc_grant",
    newPath: "/vcs/new",
    listPath: "/vcs",
    adminPath: "/admin/vcs",
    titleField: /^Name/,
    async fill(page, title) {
      await page.getByLabel(/^Name/).fill(title);
      await page.getByLabel(/^Description/).fill("Automated end-to-end coverage funding listing.");
      await page.getByLabel(/^Link/).fill("https://example.com/e2e-coverage");
    },
  },
];

for (const kind of KINDS) {
  test(`${kind.name} lifecycle: submit → edit → approve → live → revise → delete`, async ({ page, browser }) => {
    const title = `E2E ${kind.name} ${Date.now()}`;
    const editedTitle = `${title} (edited)`;
    const revisedTitle = `${title} (revised)`;

    // 1. Student submits.
    await page.goto(kind.newPath);
    await kind.fill(page, title);
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page).toHaveURL(new RegExp(`${kind.listPath}(\\?submitted=1)?$`));

    // 2. It shows as pending in their submissions.
    await page.goto("/my-submissions");
    const row = page.getByTestId("submission-row").filter({ hasText: title });
    await expect(row).toHaveCount(1);

    // 3. Student edits it (allowed only while pending) and renames it.
    await row.getByRole("link", { name: "Edit" }).click();
    await expect(page).toHaveURL(/\/[0-9a-f-]+\/edit/);
    await page.getByLabel(kind.titleField).first().fill(editedTitle);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/my-submissions/);
    await expect(page.getByTestId("submission-row").filter({ hasText: editedTitle })).toHaveCount(1);

    // 4. An admin approves it from the review queue.
    const adminCtx = await browser.newContext({ storageState: storageStatePath("admin") });
    const adminPage = await adminCtx.newPage();
    await adminPage.goto(kind.adminPath);
    const card = adminPage.locator("article").filter({ hasText: editedTitle });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Approve" }).click();
    // Once approved it drops out of the pending queue.
    await expect(adminPage.locator("article").filter({ hasText: editedTitle })).toHaveCount(0);
    await adminCtx.close();

    // 5. It's now live on the members' board for the student.
    await page.goto(kind.listPath);
    // Count first, then visibility. The list streams, and during that commit
    // the card can briefly exist twice — enough for a strict locator to fail
    // on a page that settles correctly a moment later. toHaveCount retries,
    // so this waits for the settled DOM instead of racing it.
    const liveCard = page.getByText(editedTitle);
    await expect(liveCard).toHaveCount(1);
    await expect(liveCard).toBeVisible();

    // 6. Post-approval revision (20260907000005). The property this proves,
    //    and the reason it is worth the extra minute of suite time: a change
    //    an organiser makes to a LIVE listing does not reach the public page
    //    until an admin approves it, and the old version stays up in the
    //    meantime. Both halves matter — one without the other is either a
    //    bait-and-switch hole or an event vanishing over a typo.
    await page.goto("/my-submissions");
    await page.getByTestId("submission-row").filter({ hasText: editedTitle })
      .getByRole("link", { name: "Propose a change" }).click();
    await expect(page).toHaveURL(/\/[0-9a-f-]+\/edit/);
    await page.getByLabel(kind.titleField).first().fill(revisedTitle);
    await page.getByRole("button", { name: "Submit changes for review" }).click();
    await expect(page.getByText("Your changes are with an admin")).toBeVisible();

    // The published board still shows the approved version, not the proposal.
    await page.goto(kind.listPath);
    await expect(page.getByText(editedTitle)).toHaveCount(1);
    await expect(page.getByText(revisedTitle)).toHaveCount(0);

    // 7. An admin reviews the diff and approves it.
    const editCtx = await browser.newContext({ storageState: storageStatePath("admin") });
    const editPage = await editCtx.newPage();
    await editPage.goto("/admin/edits");
    const proposal = editPage.locator("div").filter({ hasText: editedTitle }).last();
    await expect(proposal.getByText(revisedTitle)).toBeVisible();
    await editPage.getByRole("button", { name: "Approve changes" }).first().click();
    await expect(editPage.getByText(revisedTitle)).toHaveCount(0);
    await editCtx.close();

    // 8. Only now is the change public.
    await page.goto(kind.listPath);
    const revisedCard = page.getByText(revisedTitle);
    await expect(revisedCard).toHaveCount(1);
    await expect(revisedCard).toBeVisible();

    // 9. Student deletes it; it disappears from their submissions.
    //
    // Both locators are resolved fresh against the current DOM and scoped to
    // one row by test id. The earlier version scoped by "a div containing the
    // title AND a Delete button", which stopped matching its own row the
    // moment Delete was swapped for Confirm — it only ever passed because an
    // ancestor happened to hold a *different* row's Delete button, and CI's
    // retry hid that by leaving an orphaned approved listing behind.
    await page.goto("/my-submissions");
    const liveRow = () => page.getByTestId("submission-row").filter({ hasText: revisedTitle });
    await liveRow().getByRole("button", { name: "Delete" }).click();
    await liveRow().getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByTestId("submission-row").filter({ hasText: revisedTitle })).toHaveCount(0);
  });
}

// ════════════════════════════════════════════════════════════════════
// The two branches the happy path above doesn't reach: an admin
// DECLINING a proposed revision, and a revision that changes nothing.
// Seeds an already-approved event directly (same shape as admin.spec.ts's
// bulk-listing fixture) rather than re-walking submit→approve, since that
// round trip is already proven above.
// ════════════════════════════════════════════════════════════════════

const service = (): SupabaseClient =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

test.describe("listing revision review · decline and no-op", () => {
  let posterId = "";
  let adminId = "";

  test.beforeAll(async () => {
    const admin = service();
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const poster = data.users.find((u) => u.email?.toLowerCase() === USERS.student.email.toLowerCase());
    if (!poster) throw new Error("seeded e2e-student not found");
    posterId = poster.id;
    const adminUser = data.users.find((u) => u.email?.toLowerCase() === USERS.admin.email.toLowerCase());
    if (!adminUser) throw new Error("seeded e2e-admin not found");
    adminId = adminUser.id;
  });

  async function seedApprovedEvent(title: string): Promise<string> {
    const admin = service();
    const { data, error } = await admin
      .from("events")
      .insert({
        status: "approved",
        posted_by: posterId,
        // events_approval_metadata requires both set whenever status is
        // 'approved' — this bypasses the real approve_event RPC, so
        // nothing else populates them.
        approved_at: new Date().toISOString(),
        approved_by: adminId,
        title,
        description: "Seeded directly for the revision-review decline/no-op test.",
        luma_link: "https://lu.ma/e2e-revision-review",
        // Floored to the minute: the edit form's datetime-local input has
        // only minute precision, so a seed with seconds/ms would show as
        // "changed" on a true no-op save purely from that round trip.
        event_at: new Date(Math.floor((Date.now() + 45 * 86_400_000) / 60_000) * 60_000).toISOString(),
        location: "South Kensington Campus",
        organiser_name: "E2E Organiser",
        contact_email: USERS.student.email,
      })
      .select("id")
      .single();
    if (error) throw new Error(`seed approved event failed: ${error.message}`);
    return data!.id as string;
  }

  async function cleanup(eventId: string) {
    const admin = service();
    await admin.from("listing_edits").delete().eq("listing_id", eventId);
    await admin.from("events").delete().eq("id", eventId);
  }

  test("declining a revision requires a reason, and leaves the live listing untouched", async ({ page, browser }) => {
    test.setTimeout(60_000);
    const title = `E2E Decline ${Date.now()}`;
    const eventId = await seedApprovedEvent(title);

    try {
      await page.goto(`/events/${eventId}/edit`);
      await page.getByLabel(/^Location/).fill("A venue that will be declined");
      await page.getByRole("button", { name: "Submit changes for review" }).click();
      await expect(page.getByText("Your changes are with an admin")).toBeVisible();

      const adminCtx = await browser.newContext({ storageState: storageStatePath("admin") });
      const adminPage = await adminCtx.newPage();
      await adminPage.goto("/admin/edits");
      // Exactly one revision is ever pending in this describe block (each
      // test seeds, then cleans up, its own single event), so page-level
      // locators are unambiguous without scoping through the card's div.
      await expect(adminPage.getByText(title)).toBeVisible();
      await expect(adminPage.getByText("Time / place changed")).toBeVisible();

      // Empty reason: declineEdit's server-side guard rejects it — there is
      // no client-side `required`, so the round trip itself is the check.
      await adminPage.getByRole("button", { name: "Decline", exact: true }).click();
      await expect(adminPage.getByRole("button", { name: "Decline changes" })).toBeVisible();
      await adminPage.getByRole("button", { name: "Decline changes" }).click();
      await expect(adminPage.getByText("A reason is required so the organiser knows what to change.")).toBeVisible();

      const reason = "Please check with campus security about that venue first.";
      await adminPage.getByLabel(/Why\?/).fill(reason);
      await adminPage.getByRole("button", { name: "Decline changes" }).click();
      await expect(adminPage.getByText(title)).toHaveCount(0);
      await adminCtx.close();

      const admin = service();
      const { data: liveEvent } = await admin.from("events").select("location").eq("id", eventId).single();
      expect(liveEvent?.location).toBe("South Kensington Campus");

      const { data: editRow } = await admin
        .from("listing_edits")
        .select("status, reject_reason")
        .eq("listing_id", eventId)
        .single();
      expect(editRow?.status).toBe("rejected");
      expect(editRow?.reject_reason).toBe(reason);

      await expect(page.getByText("changes pending review", { exact: false })).toHaveCount(0);
    } finally {
      await cleanup(eventId);
    }
  });

  test("a revision that changes nothing is flagged as a no-op in the admin queue", async ({ page, browser }) => {
    test.setTimeout(60_000);
    const title = `E2E NoOp ${Date.now()}`;
    const eventId = await seedApprovedEvent(title);

    try {
      // Save without touching any field.
      await page.goto(`/events/${eventId}/edit`);
      await page.getByRole("button", { name: "Submit changes for review" }).click();
      await expect(page.getByText("Your changes are with an admin")).toBeVisible();

      const adminCtx = await browser.newContext({ storageState: storageStatePath("admin") });
      const adminPage = await adminCtx.newPage();
      await adminPage.goto("/admin/edits");
      await expect(adminPage.getByText(title)).toBeVisible();
      await expect(
        adminPage.getByText("Nothing differs from the published version. Approving is harmless; declining is tidier."),
      ).toBeVisible();
      await adminCtx.close();
    } finally {
      await cleanup(eventId);
    }
  });
});
