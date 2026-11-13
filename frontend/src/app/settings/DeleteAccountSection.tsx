"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { deleteMyAccount } from "@/app/settings/actions";
import { ErrorBanner } from "@/components/forms/Banners";

export default function DeleteAccountSection({ email }: { email: string }) {
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const confirmed = confirmText.trim().toLowerCase() === email.trim().toLowerCase();

  const handleDelete = async () => {
    setError("");
    if (!confirmed) return;

    setIsLoading(true);
    try {
      const result = await deleteMyAccount();
      if (!result.ok) {
        setError(result.error);
        setIsLoading(false);
        return;
      }

      // The account is already gone, so a failed sign-out changes nothing the
      // member can act on: clear the local session if we can, then leave.
      await supabase.auth.signOut().catch(() => undefined);
      // A full navigation, not router.replace. The action above revalidates
      // paths, so Next re-renders this page in the same response; with the
      // account gone that render redirects to /login, and the soft
      // router.replace("/") then lost that race often enough that members (and
      // the adversarial E2E) ended up on /login instead of home.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate hard navigation, see above
      window.location.assign("/");
    } catch {
      setError("Something went wrong. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="rounded-2xl bg-bg-card border border-danger/20 p-8">
      <div className="text-lead font-medium text-text-primary mb-1">Delete account</div>
      <p className="text-body text-text-muted leading-relaxed mb-5">
        This cannot be undone.
      </p>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-4 py-2 rounded-lg bg-transparent border border-danger/30 text-danger text-body font-medium cursor-pointer transition-colors hover:bg-danger/10"
        >
          Delete my account
        </button>
      ) : (
        <div className="space-y-4 pt-4 border-t border-border-subtle">
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <div>
            <label htmlFor="confirm-email" className="block text-small text-text-muted mb-1.5">
              Type your email <span className="text-text-secondary">{email}</span> to confirm
            </label>
            <input
              id="confirm-email"
              type="text"
              autoComplete="off"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="w-full px-4 py-3 bg-tint-1 border border-border rounded-lg text-body text-text-primary placeholder:text-text-muted transition-colors duration-150 focus:border-danger/50"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={!confirmed || isLoading}
              className="px-4 py-2 rounded-lg bg-danger/15 border border-danger/30 text-danger text-body font-medium cursor-pointer transition-colors hover:bg-danger/25 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? "Deleting…" : "Permanently delete account"}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setConfirmText(""); setError(""); }}
              disabled={isLoading}
              className="px-4 py-2 rounded-lg bg-tint-2 border border-border-strong text-text-primary text-body cursor-pointer transition-colors hover:bg-tint-4 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
