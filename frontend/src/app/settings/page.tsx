import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { throwIfAuthUnreachable, throwIfUnreachable } from "@/lib/supabase/unavailable";
import { computeDisplayName } from "@/lib/auth/guard";
import { currentUser } from "@/lib/auth/currentUser";
import AppShell from "@/components/app/AppShell";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { PageHead } from "@/components/ui/PageHead";
import { Icon } from "@/design-system/icons/Icon";
import EmailChangeForm from "./EmailChangeForm";
import PasswordChangeForm from "./PasswordChangeForm";
import DeleteAccountSection from "./DeleteAccountSection";
import SessionsSection from "./SessionsSection";
import DataExportSection from "./DataExportSection";
import AnalyticsSection from "./AnalyticsSection";
import ConnectionSettings from "./ConnectionSettings";
import BlockedMembers from "./BlockedMembers";
import { myConnectionSettings } from "@/lib/data/connections";
import { myEducation } from "@/lib/data/opportunities";
import { anyAiModeEnabled, listConcepts, myAiSettings } from "@/lib/ai/data";
import { EducationForm } from "@/components/forms/EducationForm";
import AiSettingsCard from "./AiSettingsCard";
import { SettingsSection } from "./SettingsSection";
import { Page } from "@/components/ui/Page";

export const metadata: Metadata = { title: "Settings" };

// Fetches the settings page's cascading, approval-gated data (connections,
// education, AI settings only load once we know the member is approved, and
// AI settings only once we know an AI mode is on) and applies the auth and
// onboarding gates. Pulled out so the page component's job is rendering.
async function loadSettingsPageData(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { user, error: authError } = await currentUser(supabase);
  throwIfAuthUnreachable("session", authError);
  if (!user) redirect("/login");

  const [profileRes, isAdminRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("status, role, first_name, surname, preferred_name")
      .eq("id", user.id)
      .single(),
    supabase.rpc("is_admin"),
  ]);
  throwIfUnreachable("profile", profileRes);
  throwIfUnreachable("is_admin", isAdminRes);

  // Read after the gate rather than alongside it: the RPC requires an
  // approved member, and a member still in review has no connections
  // surface to configure.
  const approved = profileRes.data?.status === "approved";
  const connectionSettings = approved ? await myConnectionSettings(supabase) : null;
  const [education, aiOn] = approved
    ? await Promise.all([myEducation(supabase), anyAiModeEnabled(supabase)])
    : [null, false];
  const [aiSettings, concepts] = aiOn
    ? await Promise.all([myAiSettings(supabase), listConcepts(supabase, ["tool", "method", "area", "language", "interest"])])
    : [null, []];

  const profile = profileRes.data;
  const isAdmin = !!isAdminRes.data;
  if (!profile) redirect("/login");
  // Admins bypass the onboarding gate so they can browse the user-facing UI for diagnostics.
  if (!isAdmin && profile.status === "pending_onboarding") redirect("/onboarding");

  // OAuth-only users have no password to change. Surfaced in the password card.
  const hasPassword = (user.providers ?? []).includes("email");

  return { user, profile, isAdmin, connectionSettings, education, aiSettings, concepts, hasPassword };
}

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    user, profile, isAdmin, connectionSettings, education, aiSettings, concepts, hasPassword,
  } = await loadSettingsPageData(supabase);

  return (
    <AppShell
      active="settings"
      name={computeDisplayName(profile)}
      isApproved={profile.status === "approved"}
      isAdmin={isAdmin}
    >
      <Page>
        <PageHead
          context="Settings"
          title="Account & profile"
          actions={
            <>
              <ButtonLink href="/profile" size="sm">
                Edit your profile
                <Icon name="arrow-right" size={16} />
              </ButtonLink>
              <ButtonLink href="/my-submissions" variant="ghost" size="sm">
                Your submissions
                <Icon name="arrow-right" size={16} />
              </ButtonLink>
              <ButtonLink href="/my-bookmarks" variant="ghost" size="sm">
                Saved opportunities
                <Icon name="arrow-right" size={16} />
              </ButtonLink>
              <ButtonLink href="/contact" variant="ghost" size="sm">
                Contact the team
                <Icon name="arrow-right" size={16} />
              </ButtonLink>
            </>
          }
        />

        <div className="mt-8">
          {connectionSettings && (
            <ConnectionSettings
              emailsEnabled={connectionSettings.connection_emails_enabled}
              openToConnections={connectionSettings.open_to_connections}
            />
          )}

          {connectionSettings && <BlockedMembers />}

          {education && (
            <SettingsSection
              id="education"
              title="Education status"
              description="Jobs are for students, graduates or both; this decides which you see."
            >
              <EducationForm initialEnrolled={education.enrolled} initialGraduated={education.graduated} />
            </SettingsSection>
          )}

          {aiSettings && <AiSettingsCard initial={aiSettings} concepts={concepts} />}

          <EmailChangeForm currentEmail={user.email ?? ""} role={profile.role} />

          <PasswordChangeForm hasPassword={hasPassword} email={user.email ?? ""} />

          <SessionsSection />

          <DataExportSection />
          <AnalyticsSection />

          {/* The one boxed row: the danger zone, last. */}
          <div className="border-t border-border-subtle pt-9">
            <DeleteAccountSection email={user.email ?? ""} />
          </div>
        </div>
      </Page>
    </AppShell>
  );
}
