// ════════════════════════════════════════════════════════════════════
// Foundry · Synthetic accounts (launch programme G8)
//
// Load-test and prod-window test accounts live on addresses nobody real
// can have: the RFC 2606 `.invalid` TLD (the E3 manifest uses
// @loadtest.foundry.invalid) and Resend's test inbox (delivered+n@resend.dev).
// Their traffic must never reach PostHog, and their Sentry events carry
// `synthetic=true` so alert rules can ignore them while every E5 run still
// reviews them.
// ════════════════════════════════════════════════════════════════════

export function isSyntheticEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return e.endsWith(".invalid") || e.endsWith("@resend.dev");
}
