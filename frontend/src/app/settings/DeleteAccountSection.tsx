"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { deleteMyAccount } from "@/app/settings/actions";
import { ErrorBanner } from "@/components/forms/Banners";
import { Field } from "@/components/forms/Field";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SettingsSection } from "./SettingsSection";

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
    <SettingsSection tone="danger" title="Delete account" description="This cannot be undone.">
      {!open ? (
        <Button type="button" variant="danger" size="md" onClick={() => setOpen(true)}>
          Delete my account
        </Button>
      ) : (
        <div className="grid gap-5">
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <Field
            label={
              <>
                Type your email <span className="text-text-primary">{email}</span> to confirm
              </>
            }
          >
            <Input
              id="confirm-email"
              type="text"
              autoComplete="off"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="danger"
              size="md"
              onClick={handleDelete}
              disabled={!confirmed}
              loading={isLoading}
            >
              {isLoading ? "Deleting…" : "Permanently delete account"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => { setOpen(false); setConfirmText(""); setError(""); }}
              disabled={isLoading}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
