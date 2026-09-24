// Seeded E2E identities + where their storage states live. Shared by
// global-setup (which creates them) and the specs (which assert as them).
// These only ever exist in the ephemeral CI Supabase, never prod.

export type Role =
  | "student" | "admin" | "reauth" | "emailchange"
  | "connector" | "connectee";

export type SeedUser = {
  role: Role;
  email: string;
  password: string;
  firstName: string;
  surname: string;
  isAdmin: boolean;
  /**
   * Seed this account as having completed intake.
   *
   * `send_connection_request` requires `profile_version >= 2` — an empty
   * profile card gives the recipient nothing to decide on, so completed
   * intake is required to SEND (though not to receive). The other seeded
   * users stay at version 1 with `intake_deferred_at` set, which is what
   * the rest of the suite asserts against; only the connections pair
   * needs this.
   */
  intakeComplete?: boolean;
};

// Student emails must be @imperial.ac.uk (the signup-domain trigger enforces it).
export const USERS: Record<Role, SeedUser> = {
  student: {
    role: "student",
    email: "e2e-student@imperial.ac.uk",
    password: "E2e-Student-Pw-123!",
    firstName: "Eve",
    surname: "Student",
    isAdmin: false,
  },
  admin: {
    role: "admin",
    email: "e2e-admin@imperial.ac.uk",
    password: "E2e-Admin-Pw-123!",
    firstName: "Ada",
    surname: "Admin",
    isAdmin: true,
  },
  // Dedicated to the settings password-change test: changing the password
  // calls signOut({ scope: "others" }), which revokes the seeded session.
  // Keeping it on its own throwaway user means that revocation can't break
  // any other member spec that reuses the student session.
  // Dedicated to the settings email-change test: the test changes this
  // account's address, so it must not be one another spec signs in as.
  // Both addresses stay on an Imperial domain because the seeded role is
  // student and the on_auth_user_email_change trigger pins students there.
  emailchange: {
    role: "emailchange",
    email: "e2e-emailchange@imperial.ac.uk",
    password: "E2e-Emailchange-Pw-123!",
    firstName: "Mia",
    surname: "Mailchange",
    isAdmin: false,
  },
  reauth: {
    role: "reauth",
    email: "e2e-reauth@imperial.ac.uk",
    password: "E2e-Reauth-Pw-123!",
    firstName: "Rhea",
    surname: "Reauth",
    isAdmin: false,
  },
  // A dedicated pair for connections.spec.ts. Two accounts rather than
  // reusing `student`, for two reasons: the round trip needs both ends of
  // a handshake simultaneously, and it mutates state that persists for
  // the life of the run (a connection, then a 21-day cooldown on removal)
  // — which no other spec should have to reason about.
  connector: {
    role: "connector",
    email: "e2e-connector@imperial.ac.uk",
    password: "E2e-Connector-Pw-123!",
    firstName: "Cora",
    surname: "Connector",
    isAdmin: false,
    intakeComplete: true,
  },
  connectee: {
    role: "connectee",
    email: "e2e-connectee@imperial.ac.uk",
    password: "E2e-Connectee-Pw-123!",
    firstName: "Dev",
    surname: "Connectee",
    isAdmin: false,
    intakeComplete: true,
  },
};

export const storageStatePath = (role: Role): string => `e2e/.auth/${role}.json`;

/**
 * Enter the non-student signup flow and declare an affiliation.
 *
 * The chooser used to be six buttons, one per affiliation, so a spec just
 * clicked "Alumni founder". It is now two doors — student, and everyone
 * else — with the affiliation as a dropdown on the form behind the second,
 * because on this page the five non-student roles all take the identical
 * password-plus-admin-review path.
 *
 * Note the affiliation is required before the form's other client-side
 * validation runs, so a spec asserting on a password error still has to
 * come through here first.
 */
export async function startNonStudentSignup(
  page: import("@playwright/test").Page,
  affiliation = "alum",
): Promise<void> {
  await openNonStudentDoor(page);
  await page.locator("#affiliation").selectOption(affiliation);
}

/**
 * The same door, in sign-in mode.
 *
 * Separate from the signup helper because there is no affiliation field
 * here, deliberately: signing in cares only that you use a password, not
 * which of the five you are. Waiting for #affiliation on this path is what
 * a single shared helper did, and it hung until the test timed out.
 */
export async function openNonStudentSignIn(
  page: import("@playwright/test").Page,
): Promise<void> {
  await openNonStudentDoor(page);
}

async function openNonStudentDoor(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: /Alum, mentor, investor or staff/i }).click();
}
