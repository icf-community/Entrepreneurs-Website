import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { throwIfAuthUnreachable } from "@/lib/supabase/unavailable";
import { PageHead } from "@/components/ui/PageHead";
import { Roundel } from "@/design-system/logo/Roundel";
import ResetPasswordForm from "./ResetPasswordForm";

// Reached only via the recovery link: /auth/callback exchanges the PKCE code
// for a session and sets the `pw-recovery` marker, then redirects here. We
// require BOTH a session AND the marker — the marker is what stops a normally
// logged-in user from using this page to change a password with no current
// password (which would bypass the settings-page reauth).
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  throwIfAuthUnreachable("session", authError);

  const cookieStore = await cookies();
  const hasMarker = cookieStore.get("pw-recovery")?.value === "1";

  if (!user || !hasMarker) redirect("/login");

  // No background of its own: the atmosphere is the night behind every page.
  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-screen items-center justify-center px-[var(--gutter)] py-10">
      <div className="w-full max-w-[460px]">
        {/* a quarter of the mark's height clear below it, so the masthead's rule does not crowd the logo */}
        <Link href="/" className="mb-4 inline-block no-underline">
          <Roundel size={56} label="Imperial Entrepreneurs" className="text-star" />
        </Link>
        <PageHead
          title="Set a new password"
          lede={
            <>
              Choose a new password for <span className="text-text-primary">{user.email}</span>. For security,
              you&apos;ll be signed out everywhere and asked to sign in again.
            </>
          }
        />
        <div className="mt-6">
          <ResetPasswordForm />
        </div>
      </div>
    </main>
  );
}
