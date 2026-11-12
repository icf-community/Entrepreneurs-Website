"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clearRecoveryMarker } from "./actions";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/forms/Banners";

export default function ResetPasswordForm() {
  const router = useRouter();
  const supabase = createClient();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const inputCls =
    "w-full px-4 py-3 bg-white/[0.03] border border-border rounded-lg text-[0.85rem] text-text-primary placeholder:text-text-muted transition-colors duration-150 focus:border-accent/50 focus:bg-white/[0.05]";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setIsLoading(true);
    let updateError: Awaited<ReturnType<typeof supabase.auth.updateUser>>["error"];
    try {
      ({ error: updateError } = await supabase.auth.updateUser({ password }));
    } finally {
      setIsLoading(false);
    }
    if (updateError) {
      setError(updateError.message);
      return;
    }

    // New credential established. A forgotten password can imply a compromised
    // account, so revoke every session (global sign-out) and clear the recovery
    // marker, then have them sign in fresh with the new password.
    await clearRecoveryMarker();
    await supabase.auth.signOut();
    setDone(true);
  };

  if (done) {
    return (
      <div className="text-center space-y-4 py-2">
        <h2 className="font-display text-[1.15rem] text-text-primary">Password updated</h2>
        <p className="text-[0.8rem] text-text-secondary leading-relaxed">
          You can now sign in with your new password.
        </p>
        <Button
          type="button"
          onClick={() => { router.replace("/login"); router.refresh(); }}
          variant="primary"
          size="lg"
          className="w-full mt-1"
        >
          Continue to sign in
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div>
        <label htmlFor="new-password" className="block text-[0.75rem] text-text-muted mb-1.5">New password</label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
        />
      </div>

      <div>
        <label htmlFor="confirm-password" className="block text-[0.75rem] text-text-muted mb-1.5">Confirm new password</label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          placeholder="Repeat password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={inputCls}
        />
      </div>

      <Button
        type="submit"
        loading={isLoading}
        variant="primary"
        size="lg"
        className="w-full mt-1"
      >
        Update password
      </Button>
    </form>
  );
}
