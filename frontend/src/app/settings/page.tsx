import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { computeDisplayName } from "@/lib/auth/guard";
import AppShell from "@/components/app/AppShell";
import EmailChangeForm from "./EmailChangeForm";
import PasswordChangeForm from "./PasswordChangeForm";
import DeleteAccountSection from "./DeleteAccountSection";
import SessionsSection from "./SessionsSection";

export default async function SettingsPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profileRes, isAdminRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("status, role, first_name, surname, preferred_name")
      .eq("id", user.id)
      .single(),
    supabase.rpc("is_admin"),
  ]);

  const profile = profileRes.data;
  const isAdmin = !!isAdminRes.data;
  if (!profile) redirect("/login");
  // Admins bypass the onboarding gate so they can browse the user-facing UI for diagnostics.
  if (!isAdmin && profile.status === "pending_onboarding") redirect("/onboarding");

  // OAuth-only users have no password to change. Surfaced in the password card.
  const hasPassword = (user.identities ?? []).some((i) => i.provider === "email");

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
            <h1 className="font-display text-text-primary leading-[1.1] tracking-tight text-[clamp(1.75rem,3.5vw,2.5rem)]">
              Account & profile
            </h1>
          </div>

          <div className="space-y-5">
            <Link
              href="/profile"
              className="group block rounded-2xl border border-border bg-bg-card p-6 no-underline transition-colors duration-150 hover:border-accent hover:bg-bg-card-hover"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="text-[0.95rem] font-medium text-text-primary">Edit your profile</div>
                <span className="shrink-0 text-text-muted transition-colors group-hover:text-text-primary"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5"><line x1="4" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg></span>
              </div>
            </Link>

            <Link
              href="/my-submissions"
              className="group block rounded-2xl border border-border bg-bg-card p-6 no-underline transition-colors duration-150 hover:border-accent hover:bg-bg-card-hover"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="text-[0.95rem] font-medium text-text-primary">Your submissions</div>
                <span className="shrink-0 text-text-muted transition-colors group-hover:text-text-primary"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5"><line x1="4" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg></span>
              </div>
            </Link>

            <Link
              href="/my-bookmarks"
              className="group block rounded-2xl border border-border bg-bg-card p-6 no-underline transition-colors duration-150 hover:border-accent hover:bg-bg-card-hover"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="text-[0.95rem] font-medium text-text-primary">Saved opportunities</div>
                <span className="shrink-0 text-text-muted transition-colors group-hover:text-text-primary"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5"><line x1="4" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg></span>
              </div>
            </Link>

            <Link
              href="/contact"
              className="group block rounded-2xl border border-border bg-bg-card p-6 no-underline transition-colors duration-150 hover:border-accent hover:bg-bg-card-hover"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="text-[0.95rem] font-medium text-text-primary">Contact the team</div>
                <span className="shrink-0 text-text-muted transition-colors group-hover:text-text-primary"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5"><line x1="4" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg></span>
              </div>
            </Link>

            <EmailChangeForm currentEmail={user.email ?? ""} role={profile.role} />

            <PasswordChangeForm hasPassword={hasPassword} email={user.email ?? ""} />

            <SessionsSection />

            <DeleteAccountSection email={user.email ?? ""} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
