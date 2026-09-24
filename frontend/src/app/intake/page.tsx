import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { throwIfAuthUnreachable, throwIfUnreachable } from "@/lib/supabase/unavailable";
import { listSkillsDetailed, listSectors } from "@/lib/data/taxonomy";
import { newestMembers } from "@/lib/data/directory";
import { signedImageUrls, signedCvUrl } from "@/lib/storage/blobRead";
import { destinationForStatus } from "@/lib/auth/status";
import IntakeFlow from "@/components/intake/IntakeFlow";

// ════════════════════════════════════════════════════════════════════
// Foundry · Post-approval intake
//
// Identity is already done — this only ever mounts for an approved
// member who hasn't completed it (profile_version < 2). Admins bypass
// both checks so they can preview the flow for diagnostics, matching
// every other status-gated page in the app.
// ════════════════════════════════════════════════════════════════════

export const metadata = { robots: { index: false, follow: false } };

export default async function IntakePage() {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  throwIfAuthUnreachable("session", authError);
  if (!user) redirect("/login");

  // cv_path and cv_original_filename are deliberately not in the profiles
  // table's SELECT grant (20260901000009) — a raw .select() naming them
  // fails the whole query with "permission denied for table profiles",
  // not just those two columns. get_my_cv_info() is the one legitimate
  // way back in, same as profile/page.tsx and mediaActions.ts use.
  const [profileRes, isAdminRes, cvInfoRes, githubRes, ingestionEnabledRes] = await Promise.all([
    supabase
      .from("profiles")
      // github_url is not one of the locked CV columns (20260901000009), so
      // it can be selected directly. It is what the GitHub screen names
      // back to the member ("we've got @handle from when you signed up").
      .select("status, profile_version, first_name, avatar_path, role, grad_year, linkedin_url, github_url")
      .eq("id", user.id)
      .single(),
    supabase.rpc("is_admin"),
    supabase.rpc("get_my_cv_info").maybeSingle(),
    supabase.rpc("get_my_github_status").maybeSingle(),
    // Kill switch (20260911000003) — gates only the LLM/worker-job side of
    // CV upload and GitHub connect, not the base file storage / OAuth
    // recording, so those stay reachable even while this is false.
    supabase.rpc("github_cv_ingestion_enabled"),
  ]);

  throwIfUnreachable("profile", profileRes);
  throwIfUnreachable("is_admin", isAdminRes);
  throwIfUnreachable("get_my_cv_info", cvInfoRes);
  throwIfUnreachable("get_my_github_status", githubRes);
  throwIfUnreachable("github_cv_ingestion_enabled", ingestionEnabledRes);
  const profile = profileRes.data;
  if (!profile) redirect("/login");
  const isAdmin = !!isAdminRes.data;
  const cvInfo = cvInfoRes.data;
  const ingestionEnabled = !!ingestionEnabledRes.data;

  if (!isAdmin) {
    if (profile.status !== "approved") redirect(destinationForStatus(profile.status));
    if ((profile.profile_version ?? 1) >= 2) redirect("/home");
  }

  // A member arriving here mid-flow (or after a refresh) has often already
  // uploaded an avatar and/or CV — confirm_avatar_upload/confirm_cv_upload
  // write those columns the moment the upload finishes, well before the
  // rest of the intake is submitted. Signing them here lets the flow open
  // already showing "uploaded" instead of blank, with no client-side cache
  // of the bytes needed at all.
  const [skillTaxonomy, sectors, newest, existingAvatarUrl, existingCvUrl] = await Promise.all([
    listSkillsDetailed(supabase),
    listSectors(supabase),
    // +1 and filtered below rather than a plain limit of 3: in a small (or
    // brand-new) community the member going through intake right now can
    // genuinely be among the newest themselves, and showing them their own
    // card here is worse than just showing one fewer — it's a preview of
    // *other* people, and their own copy is stale anyway (this whole flow
    // is one server-rendered load; an avatar uploaded two screens later on
    // Face & bio was never re-fetched into this list).
    newestMembers(supabase, 4),
    profile.avatar_path
      ? signedImageUrls([profile.avatar_path], "profile_picture").then((urls) => urls[0] ?? null)
      : null,
    cvInfo?.cv_path ? signedCvUrl(cvInfo.cv_path) : null,
  ]);
  const matches = newest.filter((m) => m.id !== user.id).slice(0, 3);

  return (
    <IntakeFlow
      memberId={user.id}
      firstName={profile.first_name}
      skillTaxonomy={skillTaxonomy.map((t) => ({ id: t.id, name: t.name, category: t.category }))}
      sectors={sectors}
      matches={matches}
      existingAvatarUrl={existingAvatarUrl}
      role={profile.role}
      gradYear={profile.grad_year}
      existingLinkedin={profile.linkedin_url}
      existingCv={
        cvInfo?.cv_path
          ? { blobKey: cvInfo.cv_path, filename: cvInfo.cv_original_filename ?? "Your CV", downloadUrl: existingCvUrl }
          : null
      }
      existingGithubUrl={profile.github_url}
      githubConnected={!!githubRes.data}
      ingestionEnabled={ingestionEnabled}
    />
  );
}
