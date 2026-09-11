import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { computeDisplayName } from "@/lib/auth/guard";
import { destinationForStatus } from "@/lib/auth/status";
import AppShell from "@/components/app/AppShell";
import { listSkillsDetailed, listSectors, profileIntakeData } from "@/lib/data/taxonomy";
import { signedImageUrls } from "@/lib/storage/blobRead";
import AffiliationSection from "./AffiliationSection";
import ProfileForm from "./ProfileForm";

export default async function ProfilePage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profileRes, skillTaxonomy, sectors, selected, isAdminRes, cvInfoRes, githubStatusRes, ingestionEnabledRes] = await Promise.all([
    supabase
      .from("profiles")
      .select(`
        role, status, first_name, surname, course, grad_year,
        linkedin_url, github_url, portfolio_url,
        preferred_name, bio_focus, bio_hobbies, avatar_path,
        current_focus, venture_stage, venture_name, venture_url, venture_one_liner,
        recruiting_status, intent_urgency, availability_hours
      `)
      .eq("id", user.id)
      .single(),
    listSkillsDetailed(supabase),
    listSectors(supabase),
    profileIntakeData(supabase, user.id),
    supabase.rpc("is_admin"),
    supabase.rpc("get_my_cv_info").maybeSingle(),
    supabase.rpc("get_my_github_status").maybeSingle(),
    // Kill switch (20260911000003) — gates only the LLM/worker-job side of
    // CV upload and GitHub connect, not the base file storage / OAuth
    // recording, so those stay reachable even while this is false.
    supabase.rpc("github_cv_ingestion_enabled"),
  ]);

  const profile = profileRes.data;
  const isAdmin = !!isAdminRes.data;
  if (!profile) redirect("/login");
  // Admins bypass the status gate so they can browse the user-facing UI for
  // diagnostics. Every non-approved status redirects (not just
  // pending_onboarding) — a member who is rejected or still in the review
  // queue mid-session must not keep landing on their editable profile.
  if (!isAdmin && profile.status !== "approved") redirect(destinationForStatus(profile.status));

  const [avatarUrl] = profile.avatar_path
    ? await signedImageUrls([profile.avatar_path], "profile_picture")
    : [null];

  const cvInfo = cvInfoRes.data as {
    cv_path: string | null;
    cv_original_filename: string | null;
    cv_uploaded_at: string | null;
  } | null;

  const githubStatus = githubStatusRes.data;
  const ingestionEnabled = !!ingestionEnabledRes.data;

  return (
    <AppShell
      active="settings"
      name={computeDisplayName(profile)}
      isApproved={profile.status === "approved"}
      isAdmin={isAdmin}
    >
      <div className="px-4 sm:px-8 py-10 sm:py-12">
        <div className="max-w-[640px] mx-auto">
          <Link
            href="/settings"
            className="inline-flex items-center text-[0.8rem] text-text-muted no-underline transition-colors duration-150 hover:text-text-secondary mb-6"
          >
            ← Settings
          </Link>
          <div className="mb-10 rule-draw pt-6">
            <p className="label-wide text-text-secondary mb-3">Your profile</p>
            <h1 className="font-display text-text-primary leading-[1.1] tracking-tight text-[clamp(1.75rem,3.5vw,2.5rem)]">
              Edit your details
            </h1>
            <p className="text-[0.875rem] text-text-muted mt-3 leading-relaxed">
              Changes are visible in the directory once you&apos;re approved.
            </p>
          </div>

          <ProfileForm
            role={profile.role}
            firstName={profile.first_name}
            surname={profile.surname}
            course={profile.course ?? ""}
            gradYear={profile.grad_year}
            linkedinUrl={profile.linkedin_url ?? ""}
            githubUrl={profile.github_url ?? ""}
            portfolioUrl={profile.portfolio_url ?? ""}
            preferredName={profile.preferred_name ?? ""}
            bioFocus={profile.bio_focus ?? ""}
            bioHobbies={profile.bio_hobbies ?? ""}
            avatarUrl={avatarUrl}
            cvOriginalFilename={cvInfo?.cv_original_filename ?? null}
            cvUploadedAt={cvInfo?.cv_uploaded_at ?? null}
            hasCv={!!cvInfo?.cv_path}
            githubUsername={githubStatus?.github_username ?? null}
            githubScanStatus={githubStatus?.scan_status ?? null}
            githubScanFailureReason={githubStatus?.scan_failure_reason ?? null}
            ingestionEnabled={ingestionEnabled}
            currentFocus={profile.current_focus ?? ""}
            ventureStage={profile.venture_stage ?? ""}
            ventureName={profile.venture_name ?? ""}
            ventureUrl={profile.venture_url ?? ""}
            ventureOneLiner={profile.venture_one_liner ?? ""}
            recruitingStatus={profile.recruiting_status ?? ""}
            intentUrgency={profile.intent_urgency ?? ""}
            availabilityHours={profile.availability_hours ?? ""}
            intents={selected.intents}
            academicInterests={selected.academicInterests}
            hobbies={selected.hobbies}
            skillTaxonomy={skillTaxonomy.map((t) => ({ id: t.id, name: t.name, category: t.category }))}
            sectors={sectors}
            selectedSkillIds={selected.skillIds}
            selectedCoreSkillIds={selected.coreSkillIds}
            selectedSectors={selected.sectorIds}
          />

          <div className="mt-8">
            <AffiliationSection role={profile.role} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
