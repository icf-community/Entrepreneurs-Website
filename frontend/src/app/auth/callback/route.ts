import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { destinationForStatus } from "@/lib/auth/status";

// Handles three paths, all via the same ?code= exchange:
//   1. Google OAuth (alumni).
//   2. Magic-link verification (students).
//   3. Password recovery (alumni) — distinguished by ?next=/reset-password,
//      which we shuttle to the reset page instead of routing into the app.
//
// Imperial domain enforcement for student magic-link signups lives in the
// DB trigger (see migration 20260529000001); we just relay any failure
// message back to /login.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);

  const providerError =
    searchParams.get("error_description") || searchParams.get("error");
  if (providerError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(providerError)}`,
    );
  }

  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { data, error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError || !data?.user) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(exchangeError?.message ?? "exchange_failed")}`,
    );
  }

  // Password recovery: honor `next` ONLY for the exact reset path (strict
  // allowlist — never an open redirect). Drop a short-lived httpOnly marker so
  // /reset-password can tell a genuine recovery click from a normal logged-in
  // user navigating there directly — otherwise the reset page would be a way to
  // change a password with no current-password check (bypassing settings reauth).
  // react-doctor-disable-next-line url-prefilled-privileged-action -- URL param does not directly trigger the privileged action; `next` only selects the redirect destination via a strict equality check against the single allowed value (/reset-password), not an open redirect
  if (searchParams.get("next") === "/reset-password") {
    const res = NextResponse.redirect(`${origin}/reset-password`);
    res.cookies.set("pw-recovery", "1", {
      httpOnly: true,
      secure: origin.startsWith("https"),
      sameSite: "lax",
      path: "/reset-password",
      maxAge: 600, // 10 minutes
    });
    return res;
  }

  // Admins always go to /admin regardless of profile status.
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin) return NextResponse.redirect(`${origin}/admin`);

  // Everyone else routes by their onboarding/review status.
  const { data: profile } = await supabase
    .from("profiles")
    .select("status")
    .eq("id", data.user.id)
    .single();

  return NextResponse.redirect(`${origin}${destinationForStatus(profile?.status)}`);
}
