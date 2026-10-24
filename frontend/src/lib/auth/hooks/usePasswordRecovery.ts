import { turnstileConfigured } from "@/lib/turnstileConfig";
import type { createClient } from "@/lib/supabase/client";

type Supabase = ReturnType<typeof createClient>;

type Params = {
  supabase: Supabase;
  email: string;
  isLoading: boolean;
  resendCooldown: number;
  turnstileToken: string;
  setError: (v: string) => void;
  setIsLoading: (v: boolean) => void;
  setForgotSent: (v: boolean) => void;
  setResendCooldown: (v: number) => void;
  refreshTurnstile: () => void;
};

export function usePasswordRecovery(p: Params) {
  // Alumni password recovery. Kept on the PKCE link (redirectTo /auth/callback)
  // deliberately — recovery is the highest-stakes flow, so the link alone must
  // not be enough to take over an account. /auth/callback shuttles a valid
  // recovery click on to /reset-password.
  const handleForgotPassword = async () => {
    if (p.resendCooldown > 0 || p.isLoading) return;
    p.setError("");
    const trimmed = p.email.trim();
    if (!trimmed) {
      p.setError("Please enter your email address first.");
      return;
    }
    if (turnstileConfigured && !p.turnstileToken) {
      p.setError("Please complete the verification challenge below.");
      return;
    }
    p.setIsLoading(true);
    const { error: resetError } = await p.supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      captchaToken: p.turnstileToken || undefined,
    });
    p.setIsLoading(false);
    p.refreshTurnstile();
    if (resetError) {
      p.setError(resetError.message);
      return;
    }
    // resetPasswordForEmail is anti-enumeration (succeeds even for unknown
    // emails), so the confirmation never leaks whether an account exists.
    p.setForgotSent(true);
    p.setResendCooldown(60);
  };

  // Clear recovery sub-view state (used both on entering and leaving it).
  const exitForgot = () => {
    p.setForgotSent(false);
    p.setError("");
  };

  return { handleForgotPassword, exitForgot };
}
