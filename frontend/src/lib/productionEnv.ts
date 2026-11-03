// Shared predicate for "this is a real production deploy, not local /
// CI / Vercel preview". Mirrors instrumentation.ts assertProductionAbuseControls
// so ratelimit / Turnstile fail-closed the same way the boot check warns.

export function isProductionDeploy(): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  // Preview deploys also run NODE_ENV=production but intentionally omit
  // production abuse secrets — treat them like non-prod.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return false;
  return true;
}
