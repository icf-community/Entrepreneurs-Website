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
        <div className="text-[0.95rem] font-medium text-text-primary">Active sessions</div>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="px-5 py-2.5 rounded-lg bg-transparent border border-[#ff4d4d]/25 text-[#ff6b6b] text-[0.825rem] font-medium cursor-pointer transition-colors hover:bg-[#ff4d4d]/10"
        >
          Sign out everywhere
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-[0.8rem] text-[#ff8b8b] leading-relaxed">
            This will sign you out on this device too. You&apos;ll have to sign in again to get back to Foundry.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSignOutEverywhere}
              disabled={pending}
              className="px-5 py-2.5 rounded-lg bg-[#ff4d4d]/15 border border-[#ff4d4d]/30 text-[#ff6b6b] text-[0.825rem] font-medium cursor-pointer transition-colors hover:bg-[#ff4d4d]/25 disabled:opacity-60"
            >
              {pending ? "Signing out…" : "Confirm — sign out everywhere"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="px-5 py-2.5 rounded-lg bg-white/[0.05] border border-border-strong text-text-primary text-[0.825rem] cursor-pointer transition-colors hover:bg-white/[0.10] disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
