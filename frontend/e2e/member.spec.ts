import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { USERS, storageStatePath } from "./fixtures";

// Runs with the seeded approved-student storageState. These assert that the
// minted session is genuinely accepted by the server gates — if the cookie
// were wrong, requireApprovedUser would bounce to /login.

test("approved student reaches the community directory (not bounced to /login)", async ({ page }) => {
  await page.goto("/members");
  await expect(page).toHaveURL(/\/members/);
});

test("student can open the opportunities, events and vcs tabs", async ({ page }) => {
  // A hydration mismatch (React #418) makes React throw away the server
  // HTML and re-render the page on the client; these three once did so
  // whenever the item count streamed in after the shell (D1).
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  for (const path of ["/opportunities", "/events", "/vcs"]) {
    await page.goto(path, { waitUntil: "networkidle" });
    await expect(page, `stayed on ${path}`).toHaveURL(new RegExp(path.replace("/", "\\/")));
  }
  expect(errors).toEqual([]);
});

test("student can open settings", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings/);
});

test("non-admin student gets a 404 on /admin (existence stays hidden)", async ({ page }) => {
  const res = await page.goto("/admin");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("Foundry control panel")).toHaveCount(0);
});

// D2: a soft navigation fetches only the page segment, so the admin
// layout's gate never runs for it. Every admin page carries the gate
// itself (requireAdminPage). The request is captured from a real admin's
// in-app navigation, so the test follows whatever Next sends, then replayed
// with this student's session: it must not render the admin page.
test("non-admin student can't fetch an admin page segment by soft navigation", async ({ page, browser }) => {
  const adminCtx = await browser.newContext({ storageState: storageStatePath("admin") });
  const adminPage = await adminCtx.newPage();
  let nav: { url: string; headers: Record<string, string> } | null = null;
  adminPage.on("request", (r) => {
    const h = r.headers();
    if (new URL(r.url()).pathname === "/admin/reports" && h["rsc"] && !h["next-router-prefetch"]) {
      nav = { url: r.url(), headers: h };
    }
  });
  await adminPage.goto("/admin");
  // A Next <Link> clicked before React owns it can sit unresponsive, and
  // Firefox hung here for the full 30s on one run in CI (passed on retry).
  // Clicking a link again is harmless, so replay click + URL check together
  // until the soft navigation takes — the same idiom as dialog.spec.ts.
  await expect(async () => {
    await adminPage.locator('a[href="/admin/reports"]').first().click({ timeout: 3_000 });
    await adminPage.waitForURL(/\/admin\/reports/, { timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  await expect(adminPage.getByText("Reported posts").first()).toBeVisible();
  await adminCtx.close();
  expect(nav, "captured the admin's soft-navigation request").not.toBeNull();

  const { url, headers } = nav!;
  const { cookie: _adminCookie, ...replay } = headers;
  void _adminCookie;
  const res = await page.request.get(url, { headers: replay, maxRedirects: 0 });
  const body = await res.text();
  expect(body).not.toContain("Reported posts");
  // A soft navigation answers 200 and carries the 404 inside the payload,
  // so the notFound() digest is what shows the gate ran.
  expect(body).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
});

// ════════════════════════════════════════════════════════════════════
// The three member pages that had no coverage at all.
//
// Added before the data-layer refactor touched them, not after: a refactor
// of an untested page is not verified by a green suite, because the suite
// has nothing to say about it.
//
// These seed real rows rather than asserting the empty state. Asserting
// "Nothing saved yet" would have passed whether the query worked or not —
// the read path degrades to [] on error by design, so a broken query and
// an empty account render the same page. A seeded row that has to appear
// is the only version of this test that can fail for the right reason.
// ════════════════════════════════════════════════════════════════════

test.describe("member pages that read per-user data", () => {
  const OPP = "Bookmarked Systems Engineer";
  const EVENT = "Seeded Upcoming Demo Night";
  let opportunityId = "";
  let eventId = "";
  let studentId = "";

  function admin() {
    return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  test.beforeAll(async () => {
    const db = admin();
    const { data: userList } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
    const idFor = (email: string) =>
      userList.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
    const student = idFor(USERS.student.email);
    const approver = idFor(USERS.admin.email);
    if (!student || !approver) throw new Error("seeded users not found");
    studentId = student;

    const approved = {
      status: "approved" as const,
      approved_at: new Date().toISOString(),
      approved_by: approver,
      posted_by: student,
    };

    const { data: opp, error: oppErr } = await db
      .from("opportunities")
      .insert({
        eligible_audience: "both",
        ...approved,
        position_name: OPP,
        company: "Bookmark Co",
        pay: "£1",
        location_type: "remote",
        description: "Seeded so /my-bookmarks and /my-activity have a row to render.",
        start_month: 1,
        start_year: 2030,
        application_deadline: new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10),
        apply_method: "email",
        contact_email: USERS.student.email,
      })
      .select("id")
      .single();
    if (oppErr) throw new Error(`seed opportunity: ${oppErr.message}`);
    opportunityId = opp!.id as string;

    const { data: ev, error: evErr } = await db
      .from("events")
      .insert({
        ...approved,
        title: EVENT,
        description: "Seeded so /calendar has something upcoming.",
        luma_link: "https://lu.ma/seeded",
        event_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        location: "Imperial",
        organiser_name: "Foundry",
        contact_email: USERS.student.email,
      })
      .select("id")
      .single();
    if (evErr) throw new Error(`seed event: ${evErr.message}`);
    eventId = ev!.id as string;

    const { error: bmErr } = await db
      .from("opportunity_bookmarks")
      .insert({ user_id: student, opportunity_id: opportunityId });
    if (bmErr) throw new Error(`seed bookmark: ${bmErr.message}`);

    const { error: actErr } = await db
      .from("user_listing_actions")
      .insert({ user_id: student, listing_kind: "opportunity", listing_id: opportunityId, action_type: "applied" });
    if (actErr) throw new Error(`seed listing action: ${actErr.message}`);
  });

  test.afterAll(async () => {
    const db = admin();
    if (opportunityId) {
      await db.from("user_listing_actions").delete().eq("listing_id", opportunityId).eq("user_id", studentId);
      await db.from("opportunity_bookmarks").delete().eq("opportunity_id", opportunityId);
      await db.from("opportunities").delete().eq("id", opportunityId);
    }
    if (eventId) await db.from("events").delete().eq("id", eventId);
  });

  test("/my-bookmarks lists the opportunity this member bookmarked", async ({ page }) => {
    const res = await page.goto("/my-bookmarks");
    expect(res?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Saved opportunities");
    await expect(page.getByText(OPP)).toBeVisible();
  });

  test("/my-activity lists what this member marked as applied", async ({ page }) => {
    const res = await page.goto("/my-activity");
    expect(res?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("applied to or are going to");
    await expect(page.getByText(OPP)).toBeVisible();
  });

  test("/calendar shows an upcoming event", async ({ page }) => {
    const res = await page.goto("/calendar");
    expect(res?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Events, opportunity deadlines");
    await expect(page.getByText(EVENT).first()).toBeVisible();
  });
});

// Changing the password reauthenticates with the current one first, so an
// unlocked, logged-in session can't silently reset the credential. Runs as a
// dedicated user because the success path calls signOut({ scope: "others" }),
// which revokes the seeded session — that must not disturb the shared student.
test.describe("settings password change", () => {
  test.use({ storageState: storageStatePath("reauth") });

  test("requires the correct current password", async ({ page }) => {
    const original = USERS.reauth.password;
    const next = "E2e-Reauth-Pw-456!";

    const current = page.getByLabel("Current password", { exact: true });
    const newPw = page.getByLabel("New password", { exact: true });
    const confirm = page.getByLabel("Confirm new password", { exact: true });
    const submit = page.getByRole("button", { name: "Update password" });

    await page.goto("/settings");

    // Wrong current password → rejected, credential untouched.
    await current.fill("not-the-password");
    await newPw.fill(next);
    await confirm.fill(next);
    await submit.click();
    await expect(page.getByText("Current password is incorrect.")).toBeVisible();

    // Correct current password → succeeds.
    await current.fill(original);
    await newPw.fill(next);
    await confirm.fill(next);
    await submit.click();
    await expect(page.getByText("Password updated.")).toBeVisible();

    // Restore the fixture password (fields clear only on success) so a local
    // re-run against a persistent stack still signs in during global-setup.
    // CI uses a fresh stack each run, so this is belt-and-braces.
    await current.fill(next);
    await newPw.fill(original);
    await confirm.fill(original);
    await submit.click();
    await expect(current).toHaveValue("");
  });
});

// ════════════════════════════════════════════════════════════════════
// Changing your email address.
//
// The real flow, not a mocked one: the test reads the actual 6-digit code
// out of the local mail catcher. That is why the change-email template is
// wired into the local config — the stock GoTrue template carries only a
// confirmation link and no {{ .Token }}, so there would be no code to read.
//
// GoTrue sends a code to BOTH mailboxes with double_confirm_changes on,
// and BOTH are needed: the first one verified returns a 200 that means
// "accepted, now send the other", with no user and no session, and the
// address does not move until the second arrives. The pair below pins that
// down — a single confirmation must leave auth.users untouched.
//
// Both codes matter for different reasons. The one at the current address
// is what stops a stolen session moving the account somewhere the attacker
// controls; the one at the new address is what stops a typo moving it
// somewhere nobody can read.
//
// Runs as its own user because it changes that account's address, and
// restores it afterwards via the service client so a local re-run
// against a persistent stack still signs in during global-setup.
// ════════════════════════════════════════════════════════════════════

import { waitForCode, clearMailbox } from "./mailpit";

test.describe("settings email change", () => {
  test.use({ storageState: storageStatePath("emailchange") });

  const original = USERS.emailchange.email;
  const next = "e2e-emailchange-new@imperial.ac.uk";

  const service = () =>
    createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

  test.afterAll(async () => {
    const admin = service();
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const user = data?.users.find((u) => u.email === next || u.email === original);
    if (user && user.email !== original) {
      await admin.auth.admin.updateUserById(user.id, { email: original });
    }
    // Both the change and the restore above are logged. Clear them so a
    // persistent local stack does not accumulate a run's worth each time.
    if (user) await admin.from("email_change_log").delete().eq("user_id", user.id);
    await Promise.all([clearMailbox(original), clearMailbox(next)]);
  });

  // ══════════════════════════════════════════════════════════════════
  // THE REGRESSION THIS PAIR EXISTS FOR.
  //
  // GoTrue answers the first of the two codes with HTTP 200 and a body of
  // {"msg":"Confirmation link accepted. Please proceed to confirm link
  // sent to the other email"} — no user, no session, and auth.users.email
  // untouched. supabase-js reports that as error: null, and the first
  // version of this form treated the absence of an error as a completed
  // change: it showed a success screen, told the member to sign in with
  // the new address, and left the account exactly where it was.
  //
  // The previous version of these tests could not catch that, because the
  // local stack ran with enable_confirmations off, which disables the
  // double-confirmation handshake outright — one code completed a change
  // locally and two were required in production. config.toml now matches
  // the hosted project, so this runs against the same GoTrue behaviour
  // members do.
  // ══════════════════════════════════════════════════════════════════

  // Runs before the happy path so the account is still on its original
  // address. It leaves a half-confirmed change behind, which the next test
  // overwrites by starting its own — re-requesting resets
  // email_change_confirm_status to 0 and reissues both tokens.
  test("one confirmed code is not a completed change", async ({ page }) => {
    await clearMailbox(original);
    await clearMailbox(next);

    await page.goto("/settings");
    await page.getByLabel("New email address", { exact: true }).fill(next);
    await page.getByLabel("Confirm new email address").fill(next);
    await page.getByRole("button", { name: "Send codes" }).click();

    const currentCode = await waitForCode(original);
    const newCode = await waitForCode(next);
    expect(newCode).not.toBe(currentCode);

    // The real code for the old inbox, a wrong one for the new inbox.
    const wrong = newCode === "000000" ? "111111" : "000000";
    await page.getByLabel("Code sent to your old email address").fill(currentCode);
    await page.getByLabel("Code sent to your new email address").fill(wrong);
    await page.getByRole("button", { name: "Confirm change" }).click();

    // The old-inbox code was accepted — the form says so, and that is the
    // 200 the old code mistook for success.
    await expect(page.getByText(/Confirmed\. Only the code sent to your new address/i)).toBeVisible();
    await expect(page.getByText(/code for your new email address is incorrect/i)).toBeVisible();
    await expect(page.getByText("Your email address has been changed")).toHaveCount(0);

    // The assertion that matters: a single confirmation moved nothing.
    const admin = service();
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    expect(
      data?.users.find((u) => u.email === original),
      "the account must still be on its original address",
    ).toBeTruthy();
    expect(data?.users.find((u) => u.email === next)).toBeFalsy();
  });

  test("both codes move the account", async ({ page }) => {
    await clearMailbox(original);
    await clearMailbox(next);

    await page.goto("/settings");
    await page.getByLabel("New email address", { exact: true }).fill(next);
    await page.getByLabel("Confirm new email address").fill(next);
    await page.getByRole("button", { name: "Send codes" }).click();

    const currentCode = await waitForCode(original);
    const newCode = await waitForCode(next);
    await page.getByLabel("Code sent to your old email address").fill(currentCode);
    await page.getByLabel("Code sent to your new email address").fill(newCode);
    await page.getByRole("button", { name: "Confirm change" }).click();

    await expect(page.getByText("Your email address has been changed")).toBeVisible({ timeout: 20_000 });

    // The assertion that matters: auth.users actually moved.
    const admin = service();
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const moved = data?.users.find((u) => u.email === next);
    expect(moved, "the account should now be on the new address").toBeTruthy();
    expect(data?.users.find((u) => u.email === original)).toBeFalsy();

    // The audit trail. This is what an admin has to work with when a member
    // mistypes the address and writes in locked out: the previous address,
    // to match against the one they contact you from. Asserted here rather
    // than only in rls_smoke because the trigger has to survive a real
    // change driven through GoTrue, not a hand-written UPDATE.
    // Newest row rather than a count. afterAll restores the address through
    // the admin API, and that restore is itself a logged change — which is
    // the trigger doing its job (it records changes made outside the form,
    // including from the Supabase dashboard), but it means history
    // accumulates across runs on a persistent local stack.
    const { data: log } = await admin
      .from("email_change_log")
      .select("old_email, new_email")
      .eq("user_id", moved!.id)
      .order("changed_at", { ascending: false })
      .limit(1);
    expect(log, "the change should have left an audit row").toHaveLength(1);
    expect(log![0]!.old_email).toBe(original);
    expect(log![0]!.new_email).toBe(next);
  });

  // The compliance half of the audit trail, and the half most likely to be
  // quietly wrong. This project keeps PII sparingly on purpose, so a log of
  // former addresses is only defensible while deleting an account still
  // deletes everything about them. Exercised through the admin API — the
  // path admin_delete_user, delete_my_account and reject_user all end in —
  // rather than a raw DELETE.
  test("deleting an account takes its email history with it", async () => {
    const admin = service();
    const throwaway = "e2e-cascade@imperial.ac.uk";

    const { data: created, error } = await admin.auth.admin.createUser({
      email: throwaway,
      email_confirm: true,
      user_metadata: { first_name: "Cass", surname: "Cade", role: "student" },
    });
    if (error) throw new Error(`cascade seed failed: ${error.message}`);
    const id = created.user!.id;

    await admin.from("email_change_log").insert({
      user_id: id,
      old_email: throwaway,
      new_email: "e2e-cascade-new@imperial.ac.uk",
    });
    const { data: before } = await admin.from("email_change_log").select("id").eq("user_id", id);
    expect(before).toHaveLength(1);

    await admin.auth.admin.deleteUser(id);

    const { data: after } = await admin.from("email_change_log").select("id").eq("user_id", id);
    expect(after, "the log row should not outlive the account").toHaveLength(0);
  });

  // The domain rule is enforced by the DB trigger, but the trigger fires
  // on the final write — after both codes. Catching it here is what stops
  // a student visiting two mailboxes only to be refused at the end.
  test("a student cannot move off the Imperial domain, and nothing is sent", async ({ page }) => {
    let updateCalled = false;
    await page.route("**/auth/v1/user**", (route) => {
      updateCalled = true;
      route.abort();
    });

    await page.goto("/settings");
    await page.getByLabel("New email address", { exact: true }).fill("mia@gmail.com");
    await page.getByLabel("Confirm new email address").fill("mia@gmail.com");
    await page.getByRole("button", { name: "Send codes" }).click();

    await expect(
      page.getByText("Student accounts must keep an @imperial.ac.uk or @ic.ac.uk address."),
    ).toBeVisible();
    expect(updateCalled, "no updateUser request should fire for a bad domain").toBe(false);
  });
});

// ─── Affiliation ─────────────────────────────────────────────────────
// The seeded member is a student, which is the branch that must NOT offer
// a picker: 'student' is the only auto-approving role, and graduation is a
// delete-and-resignup rather than a role change.
test("a student cannot change their own affiliation", async ({ page }) => {
  await page.goto("/profile");

  const section = page.locator("section", { hasText: "Your affiliation" });
  await expect(section).toBeVisible();
  await expect(section.getByText("Current student")).toBeVisible();
  await expect(section.getByText(/your student account is closed/i)).toBeVisible();

  await expect(section.getByRole("button", { name: "Save affiliation" })).toHaveCount(0);
  await expect(section.getByRole("radiogroup")).toHaveCount(0);
});

// D1: a long board renders one page of cards and a "Show more" button,
// rather than hydrating every open role at once. The search narrows the
// board to the seeded rows, so other specs' listings can't move the count.
test.describe("opportunities board renders one page at a time", () => {
  const TAG = "Pagingcheck Role";
  const ids: string[] = [];

  function admin() {
    return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  test.beforeAll(async () => {
    const db = admin();
    const { data: userList } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
    const idFor = (email: string) =>
      userList.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
    const student = idFor(USERS.student.email);
    const approver = idFor(USERS.admin.email);
    if (!student || !approver) throw new Error("seeded users not found");
    const deadline = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await db
      .from("opportunities")
      .insert(Array.from({ length: 31 }, (_, i) => ({
        eligible_audience: "both",
        status: "approved" as const,
        approved_at: new Date().toISOString(),
        approved_by: approver,
        posted_by: student,
        position_name: `${TAG} ${String(i + 1).padStart(2, "0")}`,
        company: "Paging Co",
        pay: "£1",
        location_type: "remote" as const,
        description: "Seeded to fill more than one page of the board.",
        start_month: 1,
        start_year: 2030,
        application_deadline: deadline,
        apply_method: "email" as const,
        contact_email: USERS.student.email,
      })))
      .select("id");
    if (error) throw new Error(`seed opportunities: ${error.message}`);
    ids.push(...data!.map((r) => r.id as string));
  });

  test.afterAll(async () => {
    if (ids.length) await admin().from("opportunities").delete().in("id", ids);
  });

  test("30 cards, then the 31st behind Show more", async ({ page }) => {
    await page.goto(`/opportunities?q=${encodeURIComponent(TAG)}`);
    const cards = page.locator("article").filter({ hasText: TAG });
    await expect(cards).toHaveCount(30);
    await page.getByRole("button", { name: "Show more (1 more)" }).click();
    await expect(cards).toHaveCount(31);
    await expect(page.getByRole("button", { name: /Show more/ })).toHaveCount(0);
  });
});
