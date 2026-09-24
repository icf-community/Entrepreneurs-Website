import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { throwIfAuthUnreachable } from "@/lib/supabase/unavailable";
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

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-bg-primary flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="rounded-2xl bg-bg-card border border-border p-8">
          <div className="mb-6">
            <h1 className="font-display text-[1.4rem] text-text-primary leading-tight">Set a new password</h1>
            <p className="text-[0.8rem] text-text-muted mt-2 leading-relaxed">
              Choose a new password for <span className="text-text-secondary">{user.email}</span>. For security,
              you&apos;ll be signed out everywhere and asked to sign in again.
            </p>
          </div>
          <ResetPasswordForm />
        </div>
      </div>
    </main>
  );
}
