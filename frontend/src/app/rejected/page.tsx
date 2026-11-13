import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/auth/currentUser";
import { throwIfAuthUnreachable, throwIfUnreachable } from "@/lib/supabase/unavailable";
import SignOutButton from "@/app/admin/SignOutButton";
import { PublicHeader } from "@/app/login/PublicHeader";
import { redirectAwayFrom } from "@/lib/auth/status";
import { SiteBanner } from "@/components/SiteBanner";
import { PageHead } from "@/components/ui/PageHead";
import { Disc } from "@/design-system/icons/Disc";
import { Icon } from "@/design-system/icons/Icon";

export default async function RejectedPage() {
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
    const away = redirectAwayFrom("/rejected", profile.status);
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
            title="Application not approved."
            lede="Thanks for your interest in Foundry. Unfortunately, we weren't able to approve your membership."
          />
          {/* The one thing to do is answer the email, so the email is what is drawn beside the sentence. */}
          <div className="mt-6 flex items-start gap-4">
            <Disc>
              <Icon name="mail" size={20} />
            </Disc>
            <p className="text-body text-text-muted">
              If you believe this was a mistake or your circumstances have changed,
              please reply to the email we sent and we&apos;ll take another look.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
