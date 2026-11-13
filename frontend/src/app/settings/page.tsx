import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { throwIfAuthUnreachable, throwIfUnreachable } from "@/lib/supabase/unavailable";
import { computeDisplayName } from "@/lib/auth/guard";
import { currentUser } from "@/lib/auth/currentUser";
import AppShell from "@/components/app/AppShell";
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
      <div className="px-4 sm:px-8 py-10 sm:py-12">
        <div className="max-w-[640px] mx-auto">
          <div className="mb-10 rule-draw pt-6">
            <p className="label-wide text-text-secondary mb-3">Settings</p>
            <h1 className="font-display text-text-primary leading-[1.1] tracking-tight text-display">
              Account & profile
            </h1>
          </div>

          <div className="space-y-5">
            <Link
              href="/profile"
              className="group block rounded-2xl border border-border bg-bg-card p-6 no-underline transition-colors duration-150 hover:border-accent hover:bg-bg-card-hover"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="text-lead font-medium text-text-primary">Edit your profile</div>
                <span className="shrink-0 text-text-muted transition-colors group-hover:text-text-primary"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5"><line x1="4" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg></span>
              </div>
            </Link>

            <Link
              href="/my-submissions"
              className="group block rounded-2xl border border-border bg-bg-card p-6 no-underline transition-colors duration-150 hover:border-accent hover:bg-bg-card-hover"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="text-lead font-medium text-text-primary">Your submissions</div>
                <span className="shrink-0 text-text-muted transition-colors group-hover:text-text-primary"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5"><line x1="4" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg></span>
              </div>
            </Link>

            <Link
              href="/my-bookmarks"
              className="group block rounded-2xl border border-border bg-bg-card p-6 no-underline transition-colors duration-150 hover:border-accent hover:bg-bg-card-hover"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="text-lead font-medium text-text-primary">Saved opportunities</div>
                <span className="shrink-0 text-text-muted transition-colors group-hover:text-text-primary"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5"><line x1="4" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg></span>
              </div>
            </Link>

            <Link
              href="/contact"
              className="group block rounded-2xl border border-border bg-bg-card p-6 no-underline transition-colors duration-150 hover:border-accent hover:bg-bg-card-hover"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="text-lead font-medium text-text-primary">Contact the team</div>
                <span className="shrink-0 text-text-muted transition-colors group-hover:text-text-primary"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5"><line x1="4" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg></span>
              </div>
            </Link>

            {connectionSettings && (
              <ConnectionSettings
                emailsEnabled={connectionSettings.connection_emails_enabled}
                openToConnections={connectionSettings.open_to_connections}
              />
            )}

            {connectionSettings && <BlockedMembers />}

            {education && (
              <section id="education" className="rounded-2xl border border-border bg-bg-card p-6">
                <h2 className="text-lead font-medium text-text-primary">Education status</h2>
                <p className="mt-1 mb-4 text-small text-text-muted">Jobs are for students, graduates or both; this decides which you see.</p>
                <EducationForm initialEnrolled={education.enrolled} initialGraduated={education.graduated} />
              </section>
            )}

            {aiSettings && <AiSettingsCard initial={aiSettings} concepts={concepts} />}

            <EmailChangeForm currentEmail={user.email ?? ""} role={profile.role} />

            <PasswordChangeForm hasPassword={hasPassword} email={user.email ?? ""} />

            <SessionsSection />

            <DataExportSection />
            <AnalyticsSection />

            <DeleteAccountSection email={user.email ?? ""} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
