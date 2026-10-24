import { cleanName, isValidName, MAX_NAME_LENGTH } from "@/lib/text";
import { turnstileConfigured } from "@/lib/turnstileConfig";
import { checkOtpVerifyRateLimit } from "@/lib/auth/verifyOtpGate";
import type { createClient } from "@/lib/supabase/client";
import { friendlyVerifyError } from "./authErrorText";
import type { Mode, Role } from "./loginTypes";

type Supabase = ReturnType<typeof createClient>;

type Params = {
  supabase: Supabase;
  mode: Mode;
  role: Role;
  firstName: string;
  surname: string;
  email: string;
  password: string;
  repeatPassword: string;
  tcAgreed: boolean;
  code: string;
  isLoading: boolean;
  resendCooldown: number;
  turnstileToken: string;
  setError: (v: string) => void;
  setIsLoading: (v: boolean) => void;
  setEmailSent: (v: boolean) => void;
  setResendCooldown: (v: number) => void;
  setVerifying: (v: boolean) => void;
  setVerifyError: (v: string) => void;
  refreshTurnstile: () => void;
  routeAfterSignIn: () => Promise<void>;
};

// The five non-student affiliations all ride this one password-plus-review
// flow. Split out of the page component alongside useStudentAuth so each
// flow's handlers read as their own unit.
export function useAlumAuth(p: Params) {
  // Re-send the signup confirmation email. Distinct from the student
  // resend: alum verification is a "confirm signup" email (auth.resend
  // with type "signup"), not a passwordless OTP.
  const handleAlumResend = async () => {
    if (p.resendCooldown > 0 || p.isLoading) return;
    p.setError("");
    if (turnstileConfigured && !p.turnstileToken) {
      p.setError("Please complete the verification challenge below.");
      return;
    }
    p.setIsLoading(true);
    const { error: resendError } = await p.supabase.auth.resend({
      type: "signup",
      email: p.email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        captchaToken: p.turnstileToken || undefined,
      },
    });
    p.setIsLoading(false);
    p.refreshTurnstile();
    if (resendError) {
      p.setError(resendError.message);
      return;
    }
    p.setResendCooldown(60);
  };

  // Verify the 6-digit code for an alum signup confirmation (type "signup",
  // matching signUp / resend({ type: "signup" })). Same success routing.
  const handleAlumVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    p.setVerifyError("");
    p.setVerifying(true);
    const gate = await checkOtpVerifyRateLimit(p.email);
    if (!gate.ok) {
      p.setVerifying(false);
      p.setVerifyError(gate.error);
      return;
    }
    const { error: vErr } = await p.supabase.auth.verifyOtp({
      email: p.email.trim().toLowerCase(),
      token: p.code.trim(),
      type: "signup",
    });
    if (vErr) {
      p.setVerifying(false);
      p.setVerifyError(friendlyVerifyError(vErr.message));
      return;
    }
    await p.routeAfterSignIn();
  };

  const handleAlumSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    p.setError("");

    if (p.mode === "signup") {
      // No silent default. The old chooser made this choice unavoidable by
      // being six buttons; behind a dropdown it can be skipped, and the
      // value is what an admin verifies you as — so ask rather than guess.
      if (!p.role) {
        p.setError("Please choose how you're connected to Imperial.");
        return;
      }
      const trimmedFirst = cleanName(p.firstName);
      const trimmedSurname = cleanName(p.surname);
      if (!trimmedFirst || !trimmedSurname) {
        p.setError("First name and surname are required.");
        return;
      }
      if (trimmedFirst.length > MAX_NAME_LENGTH || trimmedSurname.length > MAX_NAME_LENGTH) {
        p.setError(`First name and surname must be ${MAX_NAME_LENGTH} characters or fewer.`);
        return;
      }
      if (!isValidName(trimmedFirst) || !isValidName(trimmedSurname)) {
        p.setError("Names can only contain letters, spaces, hyphens, apostrophes and periods.");
        return;
      }
      if (p.password !== p.repeatPassword) {
        p.setError("Passwords do not match.");
        return;
      }
      if (!p.tcAgreed) {
        p.setError("Please agree to the Terms & Conditions and Privacy Policy to continue.");
        return;
      }
    }

    if (!p.email.trim()) {
      p.setError("Email is required.");
      return;
    }
    if (p.password.length < 8) {
      p.setError("Password must be at least 8 characters.");
      return;
    }
    if (turnstileConfigured && !p.turnstileToken) {
      p.setError("Please complete the verification challenge below.");
      return;
    }

    p.setIsLoading(true);

    if (p.mode === "signup") {
      const { data, error: signUpError } = await p.supabase.auth.signUp({
        email: p.email,
        password: p.password,
        options: {
          // Without this, the confirmation link redirects to the Supabase
          // Site URL root, which has no code-exchange handler — the alum
          // lands logged-out on the homepage. Point it at /auth/callback so
          // clicking the link establishes a session and routes by status,
          // exactly like the student magic-link flow.
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          captchaToken: p.turnstileToken || undefined,
          // These keys are read by the tg_handle_new_user trigger to populate
          // public.profiles with role/first_name/surname on insert.
          // grad_year is collected later during onboarding.
          data: {
            // Whatever they picked in the Chooser. tg_handle_new_user casts
            // this straight to user_role and enforces the Imperial-domain
            // rule for 'student' only; every other value lands in
            // pending_review, so this cannot be used to skip review.
            role: p.role ?? "alum",
            first_name: cleanName(p.firstName),
            surname: cleanName(p.surname),
          },
        },
      });
      p.refreshTurnstile();
      if (signUpError) {
        p.setError(signUpError.message);
        p.setIsLoading(false);
        return;
      }
      p.setIsLoading(false);
      // "Confirm email" is ON, so signUp returns no session — the user must
      // click the emailed link first. Show the check-your-inbox panel rather
      // than calling routeAfterSignIn (which would find no session and dump
      // them on '/'). This branch also covers Supabase's email-enumeration
      // protection: signing up an already-registered address returns no
      // session and no error, and showing the same panel avoids leaking
      // whether the account exists. If "Confirm email" is ever turned off,
      // data.session is populated and we route immediately.
      if (!data.session) {
        p.setEmailSent(true);
        p.setResendCooldown(60);
        return;
      }
      await p.routeAfterSignIn();
      return;
    }

    const { error: signInError } = await p.supabase.auth.signInWithPassword({
      email: p.email,
      password: p.password,
      options: { captchaToken: p.turnstileToken || undefined },
    });
    p.refreshTurnstile();
    if (signInError) {
      // Unconfirmed email: Supabase blocks sign-in until the confirmation
      // link is clicked. Don't dead-end on the raw "Email not confirmed"
      // string — resend the confirmation and show the same check-your-inbox
      // panel as signup. (Students recover via an OTP re-send; this is the
      // alum equivalent, the sign-in twin of the signup fix.)
      const unconfirmed =
        signInError.code === "email_not_confirmed" ||
        /not confirmed/i.test(signInError.message);
      if (unconfirmed) {
        // Best-effort resend; the panel also offers a manual "Resend". With
        // captcha enabled this auto-resend can't succeed (the single-use token
        // was just spent by signInWithPassword), so it no-ops here and the
        // user falls back to the panel's manual Resend, which gets a fresh
        // token from the remounted widget.
        await p.supabase.auth.resend({
          type: "signup",
          email: p.email.trim(),
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
            captchaToken: p.turnstileToken || undefined,
          },
        });
        p.setIsLoading(false);
        p.setEmailSent(true);
        p.setResendCooldown(60);
        return;
      }
      p.setError(signInError.message);
      p.setIsLoading(false);
      return;
    }
    await p.routeAfterSignIn();
  };

  return { handleAlumResend, handleAlumVerify, handleAlumSubmit };
}
