"use server";

import * as Sentry from "@sentry/nextjs";
import type { EmailOtpType } from "@supabase/supabase-js";
import { check } from "@/lib/ratelimit";
import { createClient } from "@/lib/supabase/server";
import { ok, err, type Result } from "@/lib/result";

// Pre-check gate, kept internal to this module now — see
// verifyOtpServerSide below for why calling this on its own in front of a
// *client-side* verifyOtp() is not enough on its own.
async function checkOtpVerifyRateLimit(email: string): Promise<Result> {
  const key = email.trim().toLowerCase();
  if (!key) return err("Enter your email first.");

  const decision = await check("otpVerify", key);
  if (decision === "limited") {
    return err("Too many attempts. Please wait a few minutes and try again.");
  }
  if (decision === "unavailable") {
    // otpVerify fails closed, like `submit` and the upload buckets — an
    // outage must not become a way to bypass the per-email guess limit.
    Sentry.captureMessage(
      "otpVerify rate-limit bucket unreachable — code verification is being refused (fail-closed)",
      { level: "error", tags: { bucket: "otpVerify", surface: "verifyOtpGate" } },
    );
    return err("We can't verify codes right now. Please try again in a few minutes.");
  }
  return ok();
}

type VerifiedOtp = {
  // Present whenever GoTrue actually returns a session — every type except
  // the email_change "confirm the other inbox too" single-confirmation
  // response, which is a *successful* call (error is null) with neither a
  // session nor a user. Callers that always expect a session (student/alum
  // sign-in) should treat a null session here as a failure themselves;
  // EmailChangeForm's two-code flow is the one caller for which this is
  // normal and expected.
  session: { accessToken: string; refreshToken: string } | null;
  userEmail: string | null;
};

// Runs the rate-limit gate and the actual verifyOtp call together, inside
// one trusted server boundary, instead of as two separate steps where only
// the first is under our control.
//
// Previously the gate above ran as its own server action, and the real
// supabase.auth.verifyOtp() call ran straight on the *browser* Supabase
// client — because that's what sets the session cookie. But that means it
// hits GoTrue's public /auth/v1/verify endpoint directly with the public
// anon key, which nothing stops a script from calling straight past our
// gate: an attacker who scripts a POST to that endpoint with a harvested
// email and brute-forces the 6-digit token never calls this file at all.
//
// Running verifyOtp here instead — via the cookie-writing server client
// from lib/supabase/server.ts, same helper src/app/auth/confirm/route.ts
// already uses for the token_hash link flow — makes the gate authoritative:
// there is no other path to GoTrue's verify endpoint that this app exposes.
//
// Returns the new session's tokens so the caller can sync them into the
// *browser* client via supabase.auth.setSession() — the server sets the
// cookies, but the already-initialized browser GoTrueClient instance has
// its own in-memory session state that won't notice a Set-Cookie header on
// its own.
export async function verifyOtpServerSide(
  email: string,
  token: string,
  type: EmailOtpType,
): Promise<Result<VerifiedOtp>> {
  const gate = await checkOtpVerifyRateLimit(email);
  if (!gate.ok) return err(gate.error);

  const supabase = await createClient();
  const { data, error: verifyError } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type,
  });
  if (verifyError) return err(verifyError.message);

  return ok({
    session: data.session
      ? { accessToken: data.session.access_token, refreshToken: data.session.refresh_token }
      : null,
    userEmail: data.user?.email ?? null,
  });
}
