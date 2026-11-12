// Product features that exist in code but are switched off. Build-time, not
// a runtime flag: turning one on is a deliberate release, not a toggle.

/**
 * Messaging is not built yet. Hidden from navigation and /messaging
 * redirects to /home until it is (owner, 2026-09-28, launch programme B18).
 * The placeholder page is kept so restoring it is this one line.
 */
export const MESSAGING_ENABLED = false;
