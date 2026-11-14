import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/auth/currentUser";
import { throwIfAuthUnreachable, throwIfUnreachable } from "@/lib/supabase/unavailable";
import SignOutButton from "@/app/admin/SignOutButton";
import { PublicHeader } from "@/app/login/PublicHeader";
import { redirectAwayFrom } from "@/lib/auth/status";
import { SiteBanner } from "@/components/SiteBanner";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { PageHead } from "@/components/ui/PageHead";
import { StepDots, type StepItem } from "@/components/ui/StepDots";

export const metadata: Metadata = { title: "Application received" };

// Where an application stands, drawn: it was sent (lit), it is being read by a person (the ring), and the answer comes by email (still to come).
// The words are read by a screen reader, not drawn, and say nothing the page does not already say.
const STEPS: readonly StepItem[] = [
  { id: "sent", label: "Application sent" },
  { id: "review", label: "Manual review" },
  { id: "decision", label: "Decision by email" },
];

export default async function PendingPage() {
  const supabase = await createClient();

  const { user, error: authError } = await currentUser(supabase);
  throwIfAuthUnreachable("session", authError);
  if (!user) redirect("/login");

  const adminRes = await supabase.rpc("is_admin");
  throwIfUnreachable("is_admin", adminRes);
  const isAdmin = adminRes.data;

  const profileRes = await supabase
    .from("profiles")
    .select("status, first_name")
    .eq("id", user.id)
    .single();
  throwIfUnreachable("profile", profileRes);
  const profile = profileRes.data;

  if (!profile) redirect("/login");
  // Admins bypass status gates so they can preview the page for diagnostics.
  if (!isAdmin) {
    const away = redirectAwayFrom("/pending", profile.status);
    if (away) redirect(away);
  }

  // No background of its own: the atmosphere is the night behind every page.
  return (
    <div className="relative flex min-h-screen flex-col">
      <SiteBanner />
      <PublicHeader>
        <SignOutButton />
      </PublicHeader>

      <main id="main-content" tabIndex={-1} className="flex flex-1 items-center justify-center px-[var(--gutter)] py-12">
        <div className="w-full max-w-[520px]">
          <PageHead
            context="Application received"
            title={`Thanks, ${profile.first_name || "there"}.`}
            lede="We've received your application and our team will review it manually."
          />
          <div className="mt-6 grid justify-items-start gap-6">
            <StepDots steps={STEPS} current="review" label="Application progress" />
            <p className="text-body text-text-muted">
              Review isn&apos;t instant — we&apos;ll email you when there&apos;s an update.
              You can edit your profile in the meantime.
            </p>
            <ButtonLink href="/profile" lit>
              Edit your profile
            </ButtonLink>
          </div>
        </div>
      </main>
    </div>
  );
}
