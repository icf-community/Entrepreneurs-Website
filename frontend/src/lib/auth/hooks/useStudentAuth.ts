import { cleanName, isValidName, MAX_NAME_LENGTH } from "@/lib/text";
import { turnstileConfigured } from "@/lib/turnstileConfig";
import { isImperialEmail } from "@/lib/auth/imperialEmail";
import { verifyOtpServerSide } from "@/lib/auth/verifyOtpGate";
import type { createClient } from "@/lib/supabase/client";
import { friendlyVerifyError } from "./authErrorText";
import type { Mode } from "./loginTypes";

type Supabase = ReturnType<typeof createClient>;

type Params = {
  supabase: Supabase;
  mode: Mode;
  email: string;
  firstName: string;
  surname: string;
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

// Imperial students verify via emailed link/code. The four handlers below
// are exactly what /login's chooser hands off to once the reader picks the
// student door — split out of the page component so its ~450-line handler
// section reads by flow instead of as one block.
export function useStudentAuth(p: Params) {
  // Imperial students verify via emailed link. We validate the domain
  // client-side and the DB trigger re-checks (defence in depth — see
  // migration 20260529000001).
  const sendStudentVerificationEmail = async (): Promise<string | null> => {
    const trimmedEmail = p.email.trim().toLowerCase();
    if (!trimmedEmail || !isImperialEmail(trimmedEmail)) {
      return "Please use your Imperial email address (@imperial.ac.uk or @ic.ac.uk).";
    }

    let signupData: Record<string, string> | undefined;
    if (p.mode === "signup") {
      const trimmedFirst = cleanName(p.firstName);
      const trimmedSurname = cleanName(p.surname);
      if (!trimmedFirst || !trimmedSurname) {
        return "First name and surname are required.";
      }
      if (trimmedFirst.length > MAX_NAME_LENGTH || trimmedSurname.length > MAX_NAME_LENGTH) {
        return `First name and surname must be ${MAX_NAME_LENGTH} characters or fewer.`;
      }
      if (!isValidName(trimmedFirst) || !isValidName(trimmedSurname)) {
        return "Names can only contain letters, spaces, hyphens, apostrophes and periods.";
      }
      if (!p.tcAgreed) {
        return "Please agree to the Terms & Conditions and Privacy Policy to continue.";
      }
      signupData = {
        role: "student",
        first_name: trimmedFirst,
        surname: trimmedSurname,
      };
    }

    if (turnstileConfigured && !p.turnstileToken) {
      return "Please complete the verification challenge below.";
    }

    const { error: otpError } = await p.supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        shouldCreateUser: p.mode === "signup",
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: signupData,
        captchaToken: p.turnstileToken || undefined,
      },
    });
    return otpError ? otpError.message : null;
  };

  const handleStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    p.setError("");
    p.setIsLoading(true);
    const err = await sendStudentVerificationEmail();
    p.setIsLoading(false);
    p.refreshTurnstile();
    if (err) {
      p.setError(err);
      return;
    }
    p.setEmailSent(true);
    p.setResendCooldown(60);
  };

  const handleStudentResend = async () => {
    if (p.resendCooldown > 0 || p.isLoading) return;
    p.setError("");
    p.setIsLoading(true);
    const err = await sendStudentVerificationEmail();
    p.setIsLoading(false);
    p.refreshTurnstile();
    if (err) {
      p.setError(err);
      return;
    }
    p.setResendCooldown(60);
  };

  // Verify the 6-digit code the student typed. signInWithOtp issues an email
  // OTP (type "email"); verifyOtp needs no PKCE verifier, so it works on any
  // device/browser. The rate-limit check and the actual verifyOtp call both
  // run server-side now (verifyOtpServerSide) — see that file for why a
  // client-side verifyOtp call can't be gated. On success we sync the
  // returned session into this browser client before routing, since the
  // server set the cookie but this already-initialized client doesn't know
  // that on its own.
  const handleStudentVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    p.setVerifyError("");
    p.setVerifying(true);
    const result = await verifyOtpServerSide(p.email, p.code, "email");
    if (!result.ok) {
      p.setVerifying(false);
      p.setVerifyError(friendlyVerifyError(result.error));
      return;
    }
    if (!result.data.session) {
      p.setVerifying(false);
      p.setVerifyError("We couldn't verify that code. Please try again.");
      return;
    }
    await p.supabase.auth.setSession({
      access_token: result.data.session.accessToken,
      refresh_token: result.data.session.refreshToken,
    });
    await p.routeAfterSignIn();
  };

  return { handleStudentSubmit, handleStudentResend, handleStudentVerify };
}
