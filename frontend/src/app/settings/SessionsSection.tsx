"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ErrorBanner } from "@/components/forms/Banners";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { SettingsSection } from "./SettingsSection";

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
    <SettingsSection title="Active sessions">
      <div className="grid gap-4">
        {error && <ErrorBanner>{error}</ErrorBanner>}

        {!confirming ? (
          <div>
            <Button type="button" variant="dangerGhost" size="md" onClick={() => setConfirming(true)}>
              Sign out everywhere
            </Button>
          </div>
        ) : (
          <>
            <Notice tone="danger" icon="warning">
              This will sign you out on this device too. You&apos;ll have to sign in again to get back to Foundry.
            </Notice>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="danger" size="md" onClick={handleSignOutEverywhere} loading={pending}>
                {pending ? "Signing out…" : "Confirm — sign out everywhere"}
              </Button>
              <Button type="button" variant="ghost" size="md" onClick={() => setConfirming(false)} disabled={pending}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </SettingsSection>
  );
}
