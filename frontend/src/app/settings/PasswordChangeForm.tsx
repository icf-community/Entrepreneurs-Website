"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { TurnstileWidget } from "@/components/forms/TurnstileWidget";
import { turnstileConfigured } from "@/lib/turnstileConfig";
import { ErrorBanner, SuccessBanner } from "@/components/forms/Banners";

export default function PasswordChangeForm({ hasPassword, email }: { hasPassword: boolean; email: string }) {
  const supabase = createClient();

  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // The reauth below is a signInWithPassword, and GoTrue applies its captcha
  // gate to every endpoint that mints a session — /token included. Without a
  // token here, turning on Attack Protection → CAPTCHA would make this form
  // fail at the reauth and report "Current password is incorrect", which is
  // the one message guaranteed to send someone looking in the wrong place.
  //
  // A token is single-use and the call spends it whether it succeeds or
  // fails, so the widget is remounted after every attempt via the nonce.
  // Otherwise one mistyped password leaves the form unusable until reload.
  // Read only inside handleSubmit, never in JSX — a ref avoids a re-render
  // on every token the widget mints.
  const turnstileTokenRef = useRef("");
  const [turnstileNonce, setTurnstileNonce] = useState(0);
  const refreshTurnstile = () => {
    turnstileTokenRef.current = "";
    setTurnstileNonce((n) => n + 1);
  };

  const inputCls =
    "w-full px-4 py-3 bg-tint-1 border border-border rounded-lg text-body text-text-primary placeholder:text-text-muted transition-colors duration-150 focus:border-accent/50 focus:bg-tint-2";

  // OAuth-only (Google) accounts have no password to manage — hide the card entirely.
  if (!hasPassword) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaved(false);

    if (!currentPassword) {
      setError("Please enter your current password.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (turnstileConfigured && !turnstileTokenRef.current) {
      setError("Please complete the verification challenge below.");
      return;
    }

    setIsLoading(true);

    try {
      // Reauthenticate first: verify the current password so an unlocked, logged-in
      // session can't silently change the credential. On success this refreshes the
      // same user's session; on failure the existing session is untouched and we abort.
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
        options: { captchaToken: turnstileTokenRef.current || undefined },
      });
      // Spent either way — mint a fresh one before anything can return.
      refreshTurnstile();
      if (reauthError) {
        setError("Current password is incorrect.");
        return;
      }

      // current_password is the *server-side* half of the same check, enforced by
      // GoTrue rather than by this component. Both are here on purpose, because
      // each covers a case the other does not:
      //
      //   * The check above runs in the browser. A hijacked session that calls
      //     updateUser directly never executes it.
      //   * current_password is ignored by GoTrue unless "Require current password
      //     when updating" is enabled (Auth → Sign In / Providers → Email). Tested
      //     against a local stack with it off: an update sent with a deliberately
      //     wrong current_password was accepted and the password did change. So on
      //     its own this field is not a guarantee either — it is a guarantee only
      //     while that dashboard toggle stays on, and a toggle can be flipped by
      //     someone who does not know it is load-bearing.
      //
      // Together they hold in both directions, which is why neither was dropped.
      const { error: updateError } = await supabase.auth.updateUser({
        password,
        current_password: currentPassword,
      });
      if (updateError) {
        setError(updateError.message);
        return;
      }

      // After a password change, revoke every OTHER active session so a
      // previously-stolen refresh token can't outlive the credential it
      // was issued against. The current session stays alive — the user
      // doesn't need to re-sign-in on this device.
      await supabase.auth.signOut({ scope: "others" });

      setSaved(true);
      setCurrentPassword("");
      setPassword("");
      setConfirm("");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl bg-bg-card border border-border p-8">
      <div>
        <div className="text-lead font-medium text-text-primary mb-1">Change password</div>
        <p className="text-body text-text-muted leading-relaxed">
          You&apos;ll stay signed in on this device. Every other device you&apos;re signed in on will be signed out automatically.
        </p>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}
      {saved && !error && <SuccessBanner>Password updated.</SuccessBanner>}

      <div>
        <label htmlFor="current-password" className="block text-small text-text-muted mb-1.5">Current password</label>
        <input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className={inputCls}
          required
        />
      </div>

      <div>
        <label htmlFor="new-password" className="block text-small text-text-muted mb-1.5">New password</label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
          minLength={8}
          required
        />
      </div>

      <div>
        <label htmlFor="confirm-password" className="block text-small text-text-muted mb-1.5">Confirm new password</label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={inputCls}
          minLength={8}
          required
        />
      </div>

      {turnstileConfigured && (
        <div className="flex justify-center">
          <TurnstileWidget key={turnstileNonce} onToken={(t) => { turnstileTokenRef.current = t; }} />
        </div>
      )}

      <Button
        type="submit"
        loading={isLoading}
        variant="primary"
        size="md"
      >
        Update password
      </Button>
    </form>
  );
}
