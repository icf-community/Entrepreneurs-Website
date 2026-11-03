"use server";

import * as Sentry from "@sentry/nextjs";
import type { EmailOtpType } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { check, clientIp } from "@/lib/ratelimit";
import { createClient } from "@/lib/supabase/server";
import { ok, err, type Result } from "@/lib/result";

// Pre-check gate, kept internal to this module now — see
// verifyOtpServerSide below for why calling this on its own in front of a
// *client-side* verifyOtp() is not enough on its own.
async function checkOtpVerifyRateLimit(email: string): Promise<Result> {
  const key = email.trim().toLowerCase();
  if (!key) return err("Enter your email first.");

  // Two buckets, asked in this order. First the caller's own allowance for this address
  // (email + IP): somebody sending wrong codes for a victim's address from their own IP
  // spends only their own tries, so they cannot lock the victim out. Only a request that
  // passes it is then counted against the address-wide ceiling, which is what bounds
  // guessing spread over many IPs.
  const ip = clientIp(await headers());
  for (const [bucket, id] of [["otpVerify", `${key}|${ip}`], ["otpVerifyEmail", key]] as const) {
    const decision = await check(bucket, id);
    if (decision === "limited") {
      return err("Too many attempts. Please wait a few minutes and try again.");
    }
    if (decision === "unavailable") {
      // Both buckets fail closed, like `submit` and the upload buckets — an
      // outage must not become a way to bypass the guess limit.
      Sentry.captureMessage(
        `${bucket} rate-limit bucket unreachable — code verification is being refused (fail-closed)`,
        { level: "error", tags: { bucket, surface: "verifyOtpGate" } },
      );
      return err("We can't verify codes right now. Please try again in a few minutes.");
    }
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
// already uses for the token_hash link flow — makes THIS APP'S OWN flow
// go through the gate every time, instead of leaving a client-side path
// that happens to skip it.
//
// CORRECTED (2026-10-25 follow-up audit, F1): this does NOT make the gate
// authoritative against a real attacker. NEXT_PUBLIC_SUPABASE_ANON_KEY is
// public by design, so /auth/v1/verify was always, and still is, directly
// callable by anyone who skips this app entirely — moving our own call
// server-side closes nothing for that attacker, it only stops our own UI
// from being a second, redundant bypass of our own bucket. The actual
// control against direct brute-forcing is Supabase Auth's own dashboard
// rate limits (Authentication → Rate Limits: token verifications per IP,
// OTP expiry) — verify those are tuned, don't rely on this file for it.
// Separately, moving the call server-side means every verify now reaches
// GoTrue from Vercel's shared egress IPs instead of each user's own IP;
// if Supabase's limit is per-source-IP, confirm it won't let one abusive
// burst (many distinct emails, since our own bucket here is per-email)
// degrade sign-in for everyone sharing that egress IP — needs_validation,
// not re-creatable from source.
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
