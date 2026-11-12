import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { waitForCode, waitForBody, clearMailbox, expectNoMail } from "./mailpit";
import { openNonStudentSignIn } from "./fixtures";

// ════════════════════════════════════════════════════════════════════
// The credential pipelines, end to end.
//
// WHY THESE ARE SEPARATE FROM member.spec.ts. Those tests run as a seeded
// member with a session already in storageState, which is the right shape
// for asserting on pages. It cannot assert on the thing that actually
// broke: whether the CREDENTIAL changed. An email change that reports
// success and moves nothing leaves the page looking correct — the account
// is still signed in, on the old session, and every page renders. The
// only evidence is whether the new address can now sign in and the old one
// can't, and that question is not askable from inside a session.
//
// So each test here owns a throwaway alum account, drives the real form,
// and then asks GoTrue directly whether the credential moved. Alum rather
// than student because alumni sign in with a password (students use a
// typed code) and carry no domain restriction, so an address can move
// anywhere — which is what the reported bug did.
//
// Signing in is done through the API rather than the login form on
// purpose. The form is already covered in auth.spec.ts; what is under test
// here is the state of the credential, and signInWithPassword is the same
// call the form makes. Routing a credential assertion through a UI adds
// ways for the test to fail that have nothing to do with the credential.
// ════════════════════════════════════════════════════════════════════

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const service = (): SupabaseClient =>
  createClient(URL, SRK, { auth: { persistSession: false, autoRefreshToken: false } });

const anon = (): SupabaseClient =>
  createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

/** Can this address and password sign in right now? The whole point of the file. */
async function canSignIn(email: string, password: string): Promise<boolean> {
  const { data, error } = await anon().auth.signInWithPassword({ email, password });
  return !error && !!data.session;
}

let seq = 0;
/** A fresh address per call — tests must never share a mailbox. */
const addr = (tag: string) => `pipe-${tag}-${Date.now()}-${seq++}@example.com`;

async function makeAlum(admin: SupabaseClient, email: string, password: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: "Pip", surname: "Eline", role: "alum" },
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  const id = data.user!.id;
  const { error: pErr } = await admin
    .from("profiles")
    // course is required once a profile leaves pending_onboarding
    // (profiles_course_required_post_onboarding), and grad_year for both roles.
    // intake_deferred_at: a brand-new approved member is bounced /home ->
    // /intake by a second client-side redirect that fires AFTER signInUI's
    // waitForURL has already returned on /home. The next page.goto then
    // collided with it (Firefox aborts it: NS_BINDING_ABORTED, and the page
    // ended up on /intake). Existing members never see that bounce — the
    // 20260901000004 backfill set this column for them — so setting it here
    // is the realistic fixture, and leaves /home as the only landing page.
    .update({ status: "approved", course: "MSc Innovation", grad_year: 2020, intake_deferred_at: new Date().toISOString() })
    .eq("id", id);
  if (pErr) throw new Error(`approve ${email}: ${pErr.message}`);
  return id;
}

/**
 * Get to the alum sign-in form.
 *
 * Order matters and is not obvious: switchMode() calls setRole(null), so
 * picking the role first and then flipping to sign-in drops you back on the
 * chooser. Mode first, role second.
 */
async function openAlumSignIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  // The toggle sits outside the <form>; the submit button inside it carries
  // the same accessible name, so both need scoping.
  await page.getByText("Already have an account?").getByRole("button", { name: "Sign in" }).click();
  await openNonStudentSignIn(page);
}

/** Sign in through the real form, so the browser holds a real session. */
async function signInUI(page: import("@playwright/test").Page, email: string, password: string) {
  await openAlumSignIn(page);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
}

async function destroy(admin: SupabaseClient, ids: string[], mailboxes: string[]) {
  await Promise.all(ids.map((id) => admin.auth.admin.deleteUser(id).catch(() => undefined)));
  await Promise.all(mailboxes.map((m) => clearMailbox(m).catch(() => undefined)));
}

// ─── A · email change ────────────────────────────────────────────────

test.describe("pipeline · email change", () => {
  test("bench A3 · the delivered email is the corrected template", async ({ page }) => {
    const admin = service();
    const oldAddr = addr("a3-old");
    const newAddr = addr("a3-new");
    const pw = "Pipeline-Pw-12345!";
    const id = await makeAlum(admin, oldAddr, pw);

    try {
      await clearMailbox(oldAddr);
      await signInUI(page, oldAddr, pw);
      await page.goto("/settings");
      await page.getByLabel("New email address", { exact: true }).fill(newAddr);
      await page.getByLabel("Confirm new email address").fill(newAddr);
      await page.getByRole("button", { name: "Send codes" }).click();

      const body = await waitForBody(oldAddr);

      // The corrected copy. The old template told whoever read it at the new
      // address that their code was useless — which is the code they need.
      expect(body, "should say both codes are needed").toContain("one of two codes");
      expect(body, "should route 'wasn't me' at the contact form").toContain("/contact");
      expect(body).not.toContain("only works from");

      // And neither address is printed, which is the whole point of the strip.
      expect(body, "the old address must not appear").not.toContain(oldAddr);
      expect(body, "the new address must not appear").not.toContain(newAddr);
    } finally {
      await destroy(admin, [id], [oldAddr, newAddr]);
    }
  });

  test("bench A5–A7 · both codes move the credential, and the old address dies", async ({ page }) => {
    const admin = service();
    const oldAddr = addr("a6-old");
    const newAddr = addr("a6-new");
    const pw = "Pipeline-Pw-12345!";
    const id = await makeAlum(admin, oldAddr, pw);

    try {
      await clearMailbox(oldAddr);
      await clearMailbox(newAddr);
      await signInUI(page, oldAddr, pw);
      await page.goto("/settings");
      await page.getByLabel("New email address", { exact: true }).fill(newAddr);
      await page.getByLabel("Confirm new email address").fill(newAddr);
      await page.getByRole("button", { name: "Send codes" }).click();

      const codeOld = await waitForCode(oldAddr);
      const codeNew = await waitForCode(newAddr);
      await page.getByLabel("Code sent to your old email address").fill(codeOld);
      await page.getByLabel("Code sent to your new email address").fill(codeNew);
      await page.getByRole("button", { name: "Confirm change" }).click();
      await expect(page.getByText("Your email address has been changed")).toBeVisible({
        timeout: 20_000,
      });

      // bench A6 — the step that failed in production while the screen said
      // the change had worked.
      expect(await canSignIn(newAddr, pw), "the new address must sign in").toBe(true);
      // bench A7 — the other reading of the same fault.
      expect(await canSignIn(oldAddr, pw), "the old address must be dead").toBe(false);
    } finally {
      await destroy(admin, [id], [oldAddr, newAddr]);
    }
  });

  test("bench A10 · a mistyped confirmation sends nothing", async ({ page }) => {
    const admin = service();
    const oldAddr = addr("a10-old");
    const typo = addr("a10-typo");
    const pw = "Pipeline-Pw-12345!";
    const id = await makeAlum(admin, oldAddr, pw);

    try {
      await clearMailbox(typo);
      await signInUI(page, oldAddr, pw);
      await page.goto("/settings");
      await page.getByLabel("New email address", { exact: true }).fill(typo);
      await page.getByLabel("Confirm new email address").fill(addr("a10-other"));
      await page.getByRole("button", { name: "Send codes" }).click();

      await expect(page.getByText("The two addresses don't match.")).toBeVisible();
      expect(await expectNoMail(typo), "no code should reach a mistyped address").toBe(true);
    } finally {
      await destroy(admin, [id], [oldAddr, typo]);
    }
  });

  test("bench A11 · an address already in use is indistinguishable from a free one", async ({
    page,
  }) => {
    const admin = service();
    const mine = addr("a11-mine");
    const taken = addr("a11-taken");
    const pw = "Pipeline-Pw-12345!";
    const id = await makeAlum(admin, mine, pw);
    const otherId = await makeAlum(admin, taken, pw);

    try {
      await clearMailbox(taken);
      await signInUI(page, mine, pw);
      await page.goto("/settings");
      await page.getByLabel("New email address", { exact: true }).fill(taken);
      await page.getByLabel("Confirm new email address").fill(taken);
      await page.getByRole("button", { name: "Send codes" }).click();

      // Anti-enumeration. GoTrue refuses at updateUser with 422 email_exists,
      // but saying so would let any member test addresses one at a time and
      // learn which are registered. The form swallows that one error and
      // shows the code step it shows for a free address (bench A5-A7), so
      // the two cases cannot be told apart from the outside.
      await expect(page.getByLabel("Code sent to your old email address")).toBeVisible();
      await expect(
        page.getByText(/already (been )?registered|already exists|already in use/i),
      ).toHaveCount(0);
      expect(await expectNoMail(taken), "the other account must not be emailed").toBe(true);

      // Staying quiet costs nothing server-side: GoTrue wrote no pending
      // change, so the codes the screen asks for do not exist and the
      // change cannot complete.
      const { data } = await admin.auth.admin.getUserById(id);
      expect(data.user?.new_email ?? "", "no pending address should be recorded").toBe("");
    } finally {
      await destroy(admin, [id, otherId], [mine, taken]);
    }
  });
});

// ─── B · password change ─────────────────────────────────────────────

test.describe("pipeline · password change", () => {
  test("bench B3–B5 · the new password works and the old one dies", async ({ page }) => {
    const admin = service();
    const email = addr("b3");
    const pw = "Pipeline-Pw-12345!";
    const next = "Pipeline-Pw-67890!";
    const id = await makeAlum(admin, email, pw);

    try {
      await signInUI(page, email, pw);
      await page.goto("/settings");
      await page.getByLabel("Current password", { exact: true }).fill(pw);
      await page.getByLabel("New password", { exact: true }).fill(next);
      await page.getByLabel("Confirm new password").fill(next);
      await page.getByRole("button", { name: "Update password" }).click();
      await expect(page.getByText("Password updated.")).toBeVisible({ timeout: 20_000 });

      expect(await canSignIn(email, next), "the new password must work").toBe(true);
      expect(await canSignIn(email, pw), "the old password must be dead").toBe(false);
    } finally {
      await destroy(admin, [id], [email]);
    }
  });

  test("bench B6 · a short password is refused before it leaves the browser", async ({ page }) => {
    const admin = service();
    const email = addr("b6");
    const pw = "Pipeline-Pw-12345!";
    const id = await makeAlum(admin, email, pw);

    try {
      await signInUI(page, email, pw);
      await page.goto("/settings");

      // Watch rather than abort: /auth/v1/user is also the GET that renders
      // this page, so blocking it removes the very form under test.
      const writes: string[] = [];
      page.on("request", (r) => {
        if (/\/auth\/v1\/user/.test(r.url()) && r.method() !== "GET") writes.push(r.method());
      });

      await page.getByLabel("Current password", { exact: true }).fill(pw);
      await page.getByLabel("New password", { exact: true }).fill("short12");
      await page.getByLabel("Confirm new password").fill("short12");
      await page.getByRole("button", { name: "Update password" }).click();

      // The browser refuses first: both fields carry minLength={8}, so native
      // constraint validation blocks the submit before the form's own check
      // renders its message. Either way the requirement holds and nothing is
      // sent — assert the outcome, not which layer caught it.
      const tooShort = await page
        .locator("#new-password")
        .evaluate((el) => (el as HTMLInputElement).validity.tooShort);
      expect(tooShort, "a 7-character password must fail validation").toBe(true);
      expect(writes, "nothing should reach Supabase for a 7-character password").toEqual([]);
      expect(await canSignIn(email, pw), "the password must be untouched").toBe(true);
    } finally {
      await destroy(admin, [id], [email]);
    }
  });
});

// ─── C · forgotten password ──────────────────────────────────────────

test.describe("pipeline · forgotten password", () => {
  // BENCH C1/C3/C4 (the full recovery round-trip) IS NOT AUTOMATED HERE, and
  // the reason is recorded rather than left as a gap someone rediscovers.
  //
  // Recovery is a LINK, not a typed code — deliberately unlike sign-in, which
  // uses codes so Microsoft Safe Links cannot pre-fetch and burn them. Driving
  // it means pulling {{ .ConfirmationURL }} out of the delivered mail and
  // following it, which works as far as /auth/callback: the PKCE exchange
  // succeeds (a failure there redirects to /login?error=..., and the observed
  // landing was a clean /login with no error), and /reset-password then turns
  // the visit away because getUser() or the pw-recovery marker did not survive
  // the hop.
  //
  // Two candidate causes were ruled out on the way: the marker's `secure` flag
  // is already conditional on the origin, so http localhost is not the problem;
  // and additional_redirect_urls did have the wrong scheme and host
  // ("https://127.0.0.1:3000" against a server on http://localhost:3000), which
  // is fixed in config.toml — the redirect now honours localhost, proving the
  // allow-list is no longer the blocker.
  //
  // What remains is a local-environment difference rather than an established
  // app fault, and asserting on it without knowing which would put a red test
  // in the suite that claims something unproven. Bench C1/C3/C4 stay manual.
  // C2 below is automated because it needs no round-trip.

  test("bench C2 · an unknown address gets the same answer and no email", async ({ page }) => {
    const unknown = addr("c2-nobody");

    await clearMailbox(unknown);
    await openAlumSignIn(page);
    await page.getByRole("button", { name: /Forgot your password/i }).click();
    await page.locator("#reset-email").fill(unknown);
    await page.getByRole("button", { name: "Send reset link" }).click();

    // Anti-enumeration: the screen must not distinguish a real address from a
    // made-up one. Anything naming the account as unknown is the failure.
    await expect(page.getByText(/no account|not found|doesn't exist/i)).toHaveCount(0);
    expect(await expectNoMail(unknown), "nothing should be sent to an unknown address").toBe(true);
  });
});
