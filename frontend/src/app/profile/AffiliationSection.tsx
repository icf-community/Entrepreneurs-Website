"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { ErrorBanner, SuccessBanner } from "@/components/forms/Banners";
import { ChoiceCards } from "@/components/intake/controls";
import { Disc } from "@/design-system/icons/Disc";
import { Icon } from "@/design-system/icons/Icon";
import { SettingsSection } from "@/app/settings/SettingsSection";
import { describeSupabaseError } from "@/lib/supabaseErrors";
import { createClient } from "@/lib/supabase/client";
import { AFFILIATIONS, NON_STUDENT_AFFILIATIONS, type Affiliation } from "@/lib/intake/steps";
import { invalidateDirectoryCache } from "@/app/profile/actions";

// ════════════════════════════════════════════════════════════════════
// Foundry · Affiliation
//
// Its own section with its own save, rather than a field inside the main
// profile form: it is a different kind of action, backed by a different
// RPC, with a rule the rest of the form does not have.
//
// THE RULE: a member can move between any of the five non-student roles,
// and cannot move into or out of 'student'.
//
// 'student' is the only role that auto-approves, so it is the only one
// worth lying about — refusing every transition touching it removes the
// incentive entirely. And excluding it costs nothing, because students do
// not become alumni by changing role: admin_delete_graduates closes the
// account at graduation and emails them to sign up again as an alum.
//
// Enforced in set_my_affiliation(), not here. This component only decides
// what to draw.
// ════════════════════════════════════════════════════════════════════

export default function AffiliationSection({ role }: { role: Affiliation }) {
  const router = useRouter();
  const supabase = createClient();

  // react-doctor-disable-next-line react-doctor/no-derived-useState -- editable choice seeded once from the role prop; only ever mutated by this component's own ChoiceCards onChange and its own submit handler, never by an external writer while mounted
  const [choice, setChoice] = useState<Affiliation>(role);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const current = AFFILIATIONS.find((a) => a.value === role);

  if (role === "student") {
    return (
      <SettingsSection title="Your affiliation" description="Set when you signed up with your Imperial address.">
        <div className="grid gap-5">
          <Panel tone="inset" size="sm" className="flex items-start gap-4 p-4">
            <Disc size="sm"><Icon name="user-check" size={18} /></Disc>
            <span className="min-w-0">
              <span className="block text-body font-medium text-text-primary">
                {current?.label}
              </span>
              <span className="mt-0.5 block text-small text-text-muted">
                {current?.blurb}
              </span>
            </span>
          </Panel>

          <p className="text-body leading-relaxed text-text-secondary">
            When you graduate, your student account is closed and you&apos;ll get an
            email inviting you to sign up again as an alum. That&apos;s how the
            transition works — there&apos;s nothing to change here.
          </p>
        </div>
      </SettingsSection>
    );
  }

  // Everything except student. Moving into 'student' requires a verified
  // Imperial address, which only the signup flow can establish.
  const options = NON_STUDENT_AFFILIATIONS;

  const save = async () => {
    if (choice === role) return;
    setIsLoading(true);
    setError("");
    setSaved(false);

    try {
      const { error: rpcError } = await supabase.rpc("set_my_affiliation", { p_role: choice });
      if (rpcError) {
        setError(describeSupabaseError(rpcError));
        return;
      }

      setSaved(true);
      // The directory labels members by role, so its cache is now stale.
      await invalidateDirectoryCache();
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Try again in a moment.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SettingsSection
      title="Your affiliation"
      description="How the directory describes you. Change it whenever it stops being accurate — it doesn't send you back for review."
    >
      <div className="grid gap-5">
        {error && <ErrorBanner>{error}</ErrorBanner>}
        {saved && <SuccessBanner>Affiliation updated.</SuccessBanner>}

        <ChoiceCards<Affiliation>
          name="Affiliation"
          options={options}
          value={choice}
          onChange={setChoice}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={save}
            loading={isLoading}
            disabled={choice === role}
          >
            Save affiliation
          </Button>
          {choice !== role && (
            <span className="text-body text-text-muted">
              Changing from {current?.label}
            </span>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
