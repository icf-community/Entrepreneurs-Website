import { test, expect, type Page } from "@playwright/test";
import { startNonStudentSignup, openNonStudentSignIn, USERS } from "./fixtures";
import { clearMailbox, waitForCode } from "./mailpit";

// ════════════════════════════════════════════════════════════════════
// Foundry · Auth entry-flow E2E (logged-out)
//
// The signup/login surface has no other E2E coverage: the rest of the
// suite seeds users via the admin API and loads a storageState, so it
// never exercises the role chooser, client-side validation, or the
// "check your inbox" panels — exactly the paths that have bitten us
// (alum signup dead-end, unconfirmed-alum sign-in).
//
// GoTrue calls are mocked at the network boundary (`page.route`) so the
// outcomes are deterministic regardless of the ephemeral stack's email-
// confirmation setting. Everything else (validation, gating, panel
// rendering) is real client behaviour.
// ════════════════════════════════════════════════════════════════════

// Fulfil a GoTrue endpoint with a fixed JSON body, including the CORS
// preflight the browser fires before the cross-origin POST.
async function mockGoTrue(page: Page, urlGlob: string, body: unknown) {
  await page.route(urlGlob, async (route) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
    };
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { ...cors, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  });
}

test.describe("auth entry flows", () => {
  // Two doors, because only "Current student" takes the Imperial-OTP path
  // and is auto-approved; the other five all sign up with a password and go
  // to admin review. The chooser offers the fork that exists, not the six
  // affiliations — those moved to a field on the form behind the second door.
  test("the chooser offers the two paths that actually differ", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: /Current student/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Alum, mentor, investor or staff/i })).toBeVisible();
    // The affiliations are no longer top-level choices.
    for (const gone of [/Recent graduate/i, /Angel investor/i, /Staff or faculty/i]) {
      await expect(page.getByRole("button", { name: gone })).toHaveCount(0);
    }
  });

  // Still creatable, just one level in — this is the only place the five
  // non-student roles can be self-assigned, so losing one would silently
  // make that affiliation unreachable.
  test("all five non-student affiliations are offered behind the second door", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /Alum, mentor, investor or staff/i }).click();

    const select = page.locator("#affiliation");
    await expect(select).toBeVisible();
    const values = await select.locator("option").evaluateAll(
      (os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    expect(values.sort()).toEqual(
      ["alum", "angel", "mentor", "recent_grad", "staff_faculty"],
    );
    // 'student' is not self-assignable here: it would mean auto-approval.
    expect(values).not.toContain("student");
  });

  // The affiliation is required, and checked before the rest of the form —
  // the six-button chooser made it impossible to skip, a dropdown does not.
  test("signup refuses to proceed without an affiliation", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /Alum, mentor, investor or staff/i }).click();
    await page.locator("#first-name").fill("Grace");
    await page.locator("#surname").fill("Hopper");
    await page.locator("#email").fill("grace@example.com");
    await page.locator("#password").fill("password123");
    await page.locator("#repeat-password").fill("password123");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText(/choose how you.re connected/i)).toBeVisible();
  });

  // The graduation email links here with ?role=alum. It went unread until
  // 2026-08-28, which was survivable with two options and is not with six.
  test("?role= preselects the affiliation the graduation email sends", async ({ page }) => {
    await page.goto("/login?role=alum");
    // Straight to the password form, not the chooser, with the affiliation
    // already declared — otherwise the link would hand a graduate a form
    // that stops them on a field the email had already answered.
    await expect(page.getByRole("button", { name: /Current student/i })).toHaveCount(0);
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.locator("#affiliation")).toHaveValue("alum");
  });

  test("?role= will not preselect student, which needs a verified address", async ({ page }) => {
    await page.goto("/login?role=student");
    await expect(page.getByRole("button", { name: /Current student/i })).toBeVisible();
  });

  test("?role= ignores a value that is not an affiliation", async ({ page }) => {
    await page.goto("/login?role=administrator");
    await expect(page.getByRole("button", { name: /Current student/i })).toBeVisible();
  });

  test("student: a non-Imperial email is rejected client-side (no email sent)", async ({ page }) => {
    // The domain is checked before any network call, so this never reaches
    // GoTrue — assert that, then assert the error.
    let otpCalled = false;
    await page.route("**/auth/v1/otp**", (route) => { otpCalled = true; route.abort(); });

    await page.goto("/login");
    await page.getByRole("button", { name: /Current student/i }).click();
    await page.getByRole("checkbox").check(); // T&C gates the submit button
    await page.locator("#email").fill("someone@gmail.com");
    await page.getByRole("button", { name: "Send verification code" }).click();

    await expect(page.getByText(/use your Imperial email/i)).toBeVisible();
    expect(otpCalled, "no OTP request should fire for a bad domain").toBe(false);
  });

  test("student: a valid Imperial email shows the code-entry panel", async ({ page }) => {
    await mockGoTrue(page, "**/auth/v1/otp**", {});

    await page.goto("/login");
    await page.getByRole("button", { name: /Current student/i }).click();
    await page.locator("#first-name").fill("Ada");
    await page.locator("#surname").fill("Lovelace");
    await page.locator("#email").fill("ada@imperial.ac.uk");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Send verification code" }).click();

    await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
    await expect(page.getByText("ada@imperial.ac.uk")).toBeVisible();
    await expect(page.locator("#otp-code")).toBeVisible();
  });

  test("student: entering the emailed code POSTs it to verifyOtp", async ({ page }) => {
    // Assert the wiring end to end: code field → verifyOtpServerSide → a real
    // session. This used to mock **/auth/v1/verify** at the page.route level
    // and poll its captured body, but verifyOtp runs server-side now
    // (useStudentAuth.ts, "the rate-limit check and the actual verifyOtp call
    // both run server-side") — that network call happens Node-to-Supabase,
    // never through the browser, so the mocked route never saw a request and
    // the poll just timed out. The send step (signInWithOtp) is still
    // client-side, so it stays unmocked here and genuinely emails a code,
    // which the real verify call then needs to be able to accept.
    //
    // Signing IN (an already-seeded student) rather than signing up a brand
    // new one: `signInWithOtp({ shouldCreateUser: true })` against a
    // nonexistent user sends through GoTrue's own "confirm signup" mail
    // action — a different, uncustomized template (no {{ .Token }} rendered
    // in its subject) from the "magic link" one this repo's own
    // magic_link.html documents as "Used by signInWithOtp (student sign-in /
    // sign-up)". Signing in an existing user goes through that documented,
    // customized path, which is genuinely what this test is asserting the
    // wiring of — the brand-new-signup mail action is a GoTrue/local-stack
    // quirk orthogonal to the code-field-to-verifyOtp wiring this covers.
    const email = USERS.student.email;
    await clearMailbox(email);

    await page.goto("/login");
    await page.getByRole("button", { name: "Log in" }).click();
    await page.getByRole("button", { name: /Current student/i }).click();
    await page.locator("#email").fill(email);
    await page.getByRole("button", { name: "Send sign-in code" }).click();

    const code = await waitForCode(email);
    await page.locator("#otp-code").fill(code);
    await page.getByRole("button", { name: "Verify" }).click();

    // A correct code never leaves the member looking at the code panel with
    // a verify error, and it navigates on (routeAfterSignIn) rather than
    // sitting on /login.
    await expect(page.getByText(/code (has expired|is incorrect)/i)).not.toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("student: a wrong code shows a friendly verify error", async ({ page }) => {
    await mockGoTrue(page, "**/auth/v1/otp**", {});
    // GoTrue rejects a bad/expired OTP with a 4xx; assert the mapped copy.
    await page.route("**/auth/v1/verify**", async (route) => {
      const cors = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "*",
      };
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      await route.fulfill({
        status: 403,
        headers: { ...cors, "content-type": "application/json" },
        body: JSON.stringify({ error_code: "otp_expired", msg: "Token has expired or is invalid" }),
      });
    });

    await page.goto("/login");
    await page.getByRole("button", { name: /Current student/i }).click();
    await page.locator("#first-name").fill("Ada");
    await page.locator("#surname").fill("Lovelace");
    await page.locator("#email").fill("ada@imperial.ac.uk");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Send verification code" }).click();

    await page.locator("#otp-code").fill("999999");
    await page.getByRole("button", { name: "Verify" }).click();

    await expect(page.getByText(/code (has expired|is incorrect)/i)).toBeVisible();
  });

  test("alum: the submit button is gated on the T&C checkbox", async ({ page }) => {
    await page.goto("/login");
    await startNonStudentSignup(page);

    const submit = page.getByRole("button", { name: "Create account" });
    await expect(submit).toBeDisabled();
    await page.getByRole("checkbox").check();
    await expect(submit).toBeEnabled();
  });

  test("alum: mismatched passwords are rejected client-side", async ({ page }) => {
    await page.goto("/login");
    await startNonStudentSignup(page);
    await page.locator("#first-name").fill("Grace");
    await page.locator("#surname").fill("Hopper");
    await page.locator("#email").fill("grace@example.com");
    await page.locator("#password").fill("password123");
    await page.locator("#repeat-password").fill("password456");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText(/passwords do not match/i)).toBeVisible();
  });

  test("alum: a password under 8 characters is rejected client-side", async ({ page }) => {
    await page.goto("/login");
    await startNonStudentSignup(page);
    await page.locator("#first-name").fill("Grace");
    await page.locator("#surname").fill("Hopper");
    await page.locator("#email").fill("grace@example.com");
    await page.locator("#password").fill("short");
    await page.locator("#repeat-password").fill("short");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText(/at least 8 characters/i)).toBeVisible();
  });

  test("alum: a successful signup with no session shows the code-entry panel", async ({ page }) => {
    // "Confirm email" ON → GoTrue returns a user but no session. This is the
    // path that used to dump alums on '/' (fixed earlier): assert they get the
    // code-entry panel to type the emailed code instead.
    await mockGoTrue(page, "**/auth/v1/signup**", {
      user: { id: "00000000-0000-0000-0000-000000000001", email: "newalum@example.com" },
      session: null,
    });

    await page.goto("/login");
    await startNonStudentSignup(page);
    await page.locator("#first-name").fill("New");
    await page.locator("#surname").fill("Alum");
    await page.locator("#email").fill("newalum@example.com");
    await page.locator("#password").fill("password123");
    await page.locator("#repeat-password").fill("password123");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
    await expect(page.getByText("newalum@example.com")).toBeVisible();
    await expect(page.locator("#otp-code")).toBeVisible();
  });

  test("auth/confirm without a token bounces to /login", async ({ page, browserName }) => {
    // gap 27: this route's redirect is absolute, built from the real
    // server's own bound address — it bounces straight past
    // hstsStripProxy.ts to the real server's plain-HTTP address, which
    // WebKit's auto-HTTPS-upgrade then can't reach. See that file.
    test.skip(browserName === "webkit", "known gap: see hstsStripProxy.ts");

    // The token_hash verification route (used by cross-browser email links).
    // With no token it must fail closed back to /login, not error out — the
    // login page surfaces the reason from ?error=.
    await page.goto("/auth/confirm");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
  });

  test("alum: forgot-password sends a reset link and shows confirmation", async ({ page }) => {
    await mockGoTrue(page, "**/auth/v1/recover**", {});

    // The mode toggle also resets the role chooser, so switch to sign-in mode
    // first (from the chooser), THEN pick alum — otherwise we bounce back to
    // the chooser and the forgot link never renders.
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in" }).click(); // toggle into sign-in mode
    await openNonStudentSignIn(page);
    await page.getByRole("button", { name: "Forgot your password?" }).click();

    await page.locator("#reset-email").fill("alum@example.com");
    await page.getByRole("button", { name: "Send reset link" }).click();

    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
    await expect(page.getByText("alum@example.com")).toBeVisible();
  });

  test("reset-password without a recovery session bounces to /login", async ({ page }) => {
    // The page requires both a session and the pw-recovery marker cookie; with
    // neither it must fail closed so it can't be used to bypass the settings
    // reauth on password change.
    await page.goto("/reset-password");
    await expect(page).toHaveURL(/\/login/);
  });
});
