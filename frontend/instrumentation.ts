import * as Sentry from "@sentry/nextjs";

// Next.js instrumentation hook. Loads the right Sentry config per runtime.
// Both configs are inert unless NEXT_PUBLIC_SENTRY_DSN is set.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    assertProductionAbuseControls();
    warnIfCacheSharesRateLimitDb();
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Rate limiting (Upstash) and bot protection (Turnstile) fail OPEN in local /
// CI / preview when their env vars are absent — deliberate, so those
// environments run unprotected without ceremony. On a real production
// deploy, lib/ratelimit.ts and lib/turnstile.ts now also fail CLOSED for
// the sensitive paths when the vars are missing; this boot check still
// logs loudly so a dropped Vercel env var is visible in Sentry, not only
// as refused form submissions.
//
// Non-fatal on purpose: an abuse-control gap must never pass unnoticed, but it
// also shouldn't take the whole site down at boot.
function assertProductionAbuseControls() {
  if (process.env.NODE_ENV !== "production") return;
  // Vercel preview deploys also run with NODE_ENV=production but deliberately
  // don't carry the production abuse-control secrets — skip them so they don't
  // false-alarm. Only the real production deployment should be loud. When
  // VERCEL_ENV is unset (e.g. self-hosted prod) we keep the original behaviour.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return;

  const missing: string[] = [];
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    missing.push("rate limiting (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)");
  }
  if (!process.env.TURNSTILE_SECRET_KEY) {
    missing.push("bot protection (TURNSTILE_SECRET_KEY)");
  }
  if (missing.length === 0) return;

  const message =
    `[startup] Production abuse controls are FAIL-OPEN — disabled: ${missing.join("; ")}. ` +
    `These layers are no-ops until their env vars are set in Vercel.`;
  console.error(message);
  // Surfaces in Sentry if a DSN is configured; no-op otherwise.
  Sentry.captureMessage(message, "error");
}

// The read-through cache (lib/cache.ts) falls back to the rate limiter's
// Upstash database when it has none of its own. That works, but the two then
// share one command quota — and the `submit` rate-limit bucket fails CLOSED,
// so cache traffic exhausting the quota would start refusing submissions.
//
// Splitting them needs a second Upstash database, which the free tier does
// not allow (one database, 500K commands a month). So this is a warning about
// a state the project may deliberately be sitting in, not a misconfiguration
// — it stays at warn level, and it names the quota to watch rather than only
// the fix.
function warnIfCacheSharesRateLimitDb() {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return;

  const hasRateLimitDb = Boolean(process.env.UPSTASH_REDIS_REST_URL);
  const hasOwnCacheDb = Boolean(process.env.UPSTASH_CACHE_REDIS_REST_URL);
  if (!hasRateLimitDb || hasOwnCacheDb) return;

  console.warn(
    "[startup] The response cache is sharing the rate limiter's Upstash database. " +
      "They draw on one command quota, and the `submit` rate-limit bucket fails CLOSED — " +
      "so exhausting it with cache traffic would start refusing submissions and contact " +
      "messages. Watch the command count in the Upstash console; separating them means a " +
      "second database (pay-as-you-go — the free tier allows one) and setting " +
      "UPSTASH_CACHE_REDIS_REST_URL / UPSTASH_CACHE_REDIS_REST_TOKEN.",
  );
}

export { captureRequestError as onRequestError } from "@sentry/nextjs";
