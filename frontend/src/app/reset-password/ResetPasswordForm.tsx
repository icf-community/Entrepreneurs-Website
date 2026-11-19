"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clearRecoveryMarker } from "./actions";
import { Button } from "@/components/ui/Button";
import { FormActions } from "@/components/ui/FormActions";
import { FormSection } from "@/components/ui/FormSection";
import { Input } from "@/components/ui/Input";
import { StepDots, type StepItem } from "@/components/ui/StepDots";
import { ErrorBanner } from "@/components/forms/Banners";
import { Field } from "@/components/forms/Field";
import { Disc } from "@/design-system/icons/Disc";
import { Icon } from "@/design-system/icons/Icon";

// The same three marks /login draws while you ask for a link and open it (login/LoginClient.tsx, RECOVERY_STEPS): this is the third,
// so the three screens read as one flow. The words are read by a screen reader, not drawn.
const STEPS: readonly StepItem[] = [
  { id: "request", label: "Request a link" },
  { id: "inbox", label: "Open the link" },
  { id: "password", label: "Choose a password" },
];

export default function ResetPasswordForm() {
  const router = useRouter();
  const supabase = createClient();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

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
      <FormSection className="justify-items-center text-center">
        {/* every step travelled: none is current */}
        <StepDots steps={STEPS} current="finished" done={STEPS.map((s) => s.id)} label="Password reset progress" />
        <Disc size="lg" lit>
          <Icon name="check" size={24} />
        </Disc>
        <div className="grid gap-2">
          <h2 className="font-display text-title text-text-primary">Password updated</h2>
          <p className="text-body text-text-secondary">
            You can now sign in with your new password.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => { router.replace("/login"); router.refresh(); }}
          variant="primary"
          size="lg"
          className="w-full"
        >
          Continue to sign in
        </Button>
      </FormSection>
    );
  }

  return (
    <FormSection as="form" onSubmit={handleSubmit}>
      <StepDots steps={STEPS} current="password" label="Password reset progress" />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <Field label="New password">
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      <Field label="Confirm new password">
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          placeholder="Repeat password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </Field>

      <FormActions>
        <Button
          type="submit"
          loading={isLoading}
          variant="primary"
          size="lg"
          className="w-full"
        >
          Update password
        </Button>
      </FormActions>
    </FormSection>
  );
}
