import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { throwIfAuthUnreachable, throwIfUnreachable } from "@/lib/supabase/unavailable";
import SignOutButton from "@/app/admin/SignOutButton";
import { BrandLogo } from "@/components/BrandLogo";
import { redirectAwayFrom } from "@/lib/auth/status";

export default async function PendingPage() {
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
    const away = redirectAwayFrom("/pending", profile.status);
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
          <p className="label-wide text-text-secondary mb-3">Application received</p>
          <h1 className="font-display text-text-primary leading-[1.1] tracking-tight mb-6 text-[clamp(2rem,4vw,2.75rem)]">
            Thanks, {profile.first_name || "there"}.
          </h1>
          <p className="text-[0.95rem] text-text-secondary leading-[1.7] mb-3">
            We&apos;ve received your application and our team will review it manually.
          </p>
          <p className="text-[0.875rem] text-text-muted leading-[1.7]">
            Review isn&apos;t instant — we&apos;ll email you when there&apos;s an update.
            You can edit your profile in the meantime.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              href="/profile"
              className="px-5 py-2.5 rounded-xl bg-accent text-bg-primary text-[0.85rem] font-medium no-underline transition-colors duration-150 hover:bg-accent-light"
            >
              Edit your profile
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
