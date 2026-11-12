// Shared tracesSampler for all three Sentry runtimes (server, edge,
// client). Kept in one place so they can't drift.
//
// Free-tier budget: tracesSampleRate was 0 everywhere, by design, to stay
// inside Sentry's error quota without touching the separate performance
// one (see sentry.server.config.ts's old comment, and docs/observability.md).
// This turns on a SMALL trace sample, but only for authenticated routes —
// anonymous browsing and static assets stay at 0 — so the few spans this
// produces go toward understanding exactly the kind of auth-route latency
// the 2026-10-26 k6 load test spent a session diagnosing, instead of being
// spent on traffic that was never the question.
//
// Same prefix set the k6 harness (scripts/loadtest.js) already treats as
// "authenticated" routes.
export const AUTH_ROUTE_PREFIXES = [
  "/home", "/connections", "/opportunities", "/events", "/vcs",
  "/admin", "/profile", "/settings", "/foundry-ai",
] as const;

/** 1 in 20 authenticated-route transactions. Nothing documents an exact
 * numeric quota for this Sentry plan (docs/audits/D8-cost.md just notes
 * "Spike protection ON" as the real backstop) — this is deliberately
 * conservative rather than tuned against one. */
const AUTH_SAMPLE_RATE = 0.05;

type MinimalSamplingContext = {
  normalizedRequest?: { url?: string };
  location?: { pathname?: string };
};

function pathFrom(ctx: MinimalSamplingContext): string | null {
  const url = ctx.normalizedRequest?.url;
  if (url) {
    try {
      return new URL(url).pathname;
    } catch {
      return null;
    }
  }
  return ctx.location?.pathname ?? null;
}

/**
 * `enabled: NODE_ENV === "production"` on every Sentry.init() call already
 * makes the SDK fully inert outside production, so this never needs its
 * own environment check — it only ever runs when Sentry is live.
 */
export function tracesSampler(ctx: MinimalSamplingContext): number {
  const path = pathFrom(ctx);
  if (!path) return 0;
  return AUTH_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix)) ? AUTH_SAMPLE_RATE : 0;
}
