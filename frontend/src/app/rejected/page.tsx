import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { throwIfAuthUnreachable, throwIfUnreachable } from "@/lib/supabase/unavailable";
import SignOutButton from "@/app/admin/SignOutButton";
import { BrandLogo } from "@/components/BrandLogo";
import { redirectAwayFrom } from "@/lib/auth/status";

export default async function RejectedPage() {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
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

  return (
    <div className="relative min-h-screen bg-bg-primary flex flex-col">
      <header className="sticky top-0 z-40 px-8 py-5 bg-bg-primary/90 backdrop-blur-md border-b border-border-subtle">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between">
          <Link href="/" className="no-underline">
            <BrandLogo size="sm" />
          </Link>
          <SignOutButton />
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1 flex items-center justify-center px-8 py-12">
        <div className="w-full max-w-[520px] text-center">
          <h1 className="font-display text-text-primary leading-[1.1] tracking-tight mb-6 text-[clamp(2rem,4vw,2.75rem)]">
            Application not approved.
          </h1>
          <p className="text-[0.95rem] text-text-secondary leading-[1.7] mb-3">
            Thanks for your interest in Foundry. Unfortunately, we weren&apos;t able to approve your membership.
          </p>
          <p className="text-[0.875rem] text-text-muted leading-[1.7]">
            If you believe this was a mistake or your circumstances have changed,
            please reply to the email we sent and we&apos;ll take another look.
          </p>
        </div>
      </main>
    </div>
  );
}
