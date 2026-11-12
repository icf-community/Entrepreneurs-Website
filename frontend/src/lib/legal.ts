// The version of the Terms a new member accepts at signup, recorded in
// their auth metadata alongside the 18+ confirmation (see SignupDisclosures).
// Bump it whenever /terms changes materially, matching its LAST_UPDATED.
export const TERMS_VERSION = "2026-11-12";

/** Metadata recorded on signup: who agreed to which Terms, and when. */
export function signupConsentRecord() {
  return { terms_version: TERMS_VERSION, terms_accepted_at: new Date().toISOString(), age_18_confirmed: true };
}
