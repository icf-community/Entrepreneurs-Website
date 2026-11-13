"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ErrorBanner } from "@/components/forms/Banners";

// ════════════════════════════════════════════════════════════════════
// Foundry · Active sessions card
//
// Calls supabase.auth.signOut({ scope: 'global' }) to revoke every
// active refresh token attached to the user, on every device. After
// success we route to /login so the now-stale local cookie isn't sat
// on a protected page.
//
// We deliberately don't render a per-session list yet: it requires a
// SECURITY DEFINER RPC over auth.sessions and a per-row revoke RPC.
// The "sign out everywhere" affordance handles the security-critical
// case (compromised device) without that depth.
// ════════════════════════════════════════════════════════════════════

export default function SessionsSection() {
  const router = useRouter();
  const supabase = createClient();

  const [confirming, setConfirming] = useState(false);
  const [pending,    setPending]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const handleSignOutEverywhere = async () => {
    setError(null);
    setPending(true);
    let e: { message: string } | null;
    try {
      ({ error: e } = await supabase.auth.signOut({ scope: "global" }));
    } catch {
      e = { message: "Couldn't reach the server. Please try again." };
    } finally {
      setPending(false);
    }
    if (e) { setError(e.message); return; }
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="rounded-2xl bg-bg-card border border-border p-8 space-y-5">
      <div>
        <div className="text-lead font-medium text-text-primary">Active sessions</div>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="px-5 py-2.5 rounded-lg bg-transparent border border-danger/25 text-danger text-body font-medium cursor-pointer transition-colors hover:bg-danger/10"
        >
          Sign out everywhere
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-body text-danger leading-relaxed">
            This will sign you out on this device too. You&apos;ll have to sign in again to get back to Foundry.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSignOutEverywhere}
              disabled={pending}
              className="px-5 py-2.5 rounded-lg bg-danger/15 border border-danger/30 text-danger text-body font-medium cursor-pointer transition-colors hover:bg-danger/25 disabled:opacity-60"
            >
              {pending ? "Signing out…" : "Confirm — sign out everywhere"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="px-5 py-2.5 rounded-lg bg-tint-2 border border-border-strong text-text-primary text-body cursor-pointer transition-colors hover:bg-tint-4 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
