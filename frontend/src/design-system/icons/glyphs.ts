// The names and the mappings of Lumen's identity glyphs (the Phase-1 family, design/phase-2/kit/icons.js). Data only: the drawings are in Glyph.tsx.
//
// The labels below are CONTENT, copied verbatim from the kit (kit/icons.js and kit/content.js). A page may set them, hide them behind a
// caption slot or put them in an aria-label, but it may not reword them. Where the product already has its own wording for the same thing
// (lib/intake/steps.ts AFFILIATIONS says "Recent graduate" and "Staff or faculty"), the page keeps the product's visible string and uses
// this table only to pick the drawing.

export const GLYPH_NAMES = [
  // audiences: who is in Foundry
  "book", "cap", "sprout", "lighthouse", "wings", "flask",
  // listing types
  "briefcase", "calendar", "coin",
  // sign-up steps
  "badge", "chips", "eye",
  // status
  "tick",
  // event types and the scroll cue
  "network", "stage", "chip", "talk", "down",
] as const;
export type GlyphName = (typeof GLYPH_NAMES)[number];

/** The smallest a glyph is drawn: below this the slits (1.9 units on the 48 grid) fall under a pixel. */
export const GLYPH_MIN_SIZE = 28;

/** The six audiences. `affiliation` is the app's own value (lib/intake/steps.ts `Affiliation`), so a member's role maps straight to a drawing. */
export const AUDIENCES = [
  { id: "students", glyph: "book", name: "Students", full: "Current students", affiliation: "student" },
  { id: "grads", glyph: "cap", name: "Grads", full: "Recent grads", affiliation: "recent_grad" },
  { id: "founders", glyph: "sprout", name: "Founders", full: "Alumni founders", affiliation: "alum" },
  { id: "mentors", glyph: "lighthouse", name: "Mentors", full: "Mentors", affiliation: "mentor" },
  { id: "angels", glyph: "wings", name: "Angels", full: "Angel investors", affiliation: "angel" },
  { id: "faculty", glyph: "flask", name: "Faculty", full: "Staff & faculty", affiliation: "staff_faculty" },
] as const satisfies readonly { id: string; glyph: GlyphName; name: string; full: string; affiliation: string }[];
export type AudienceId = (typeof AUDIENCES)[number]["id"];
export type AudienceAffiliation = (typeof AUDIENCES)[number]["affiliation"];

/**
 * The three listing types (the three plumes). `kind` is the app's own `ListingKind` (lib/listings/registry.ts), `icon` the UI icon the
 * compact forms use (a calendar cell, a dense row) where a glyph at 28 px or more would be too big.
 */
export const LISTING_KINDS = [
  { id: "opportunities", glyph: "briefcase", name: "Opportunities", kind: "opportunity", icon: "opportunities" },
  { id: "events", glyph: "calendar", name: "Events", kind: "event", icon: "events" },
  { id: "funding", glyph: "coin", name: "Funding", kind: "vc_grant", icon: "vcs" },
] as const satisfies readonly { id: string; glyph: GlyphName; name: string; kind: "opportunity" | "event" | "vc_grant"; icon: string }[];
export type ListingTypeId = (typeof LISTING_KINDS)[number]["id"];

/** The four event types of the Events cards (Phase 2). */
export const EVENT_TYPES = [
  { id: "networking", glyph: "network", name: "Networking" },
  { id: "demo", glyph: "stage", name: "Demo" },
  { id: "hackathon", glyph: "chip", name: "Hackathon" },
  { id: "office-hours", glyph: "talk", name: "Office Hours" },
] as const satisfies readonly { id: string; glyph: GlyphName; name: string }[];
export type EventTypeId = (typeof EVENT_TYPES)[number]["id"];

/** The three sign-up steps. */
export const SIGNUP_STEPS = [
  { id: "identity", glyph: "badge", name: "Identity" },
  { id: "work", glyph: "chips", name: "Your work" },
  { id: "visibility", glyph: "eye", name: "Visibility" },
] as const satisfies readonly { id: string; glyph: GlyphName; name: string }[];
export type SignupStepId = (typeof SIGNUP_STEPS)[number]["id"];

/** `tick` is the verified mark; `down` is the "Learn more" scroll cue. Neither belongs to a family above. */
export const STATUS_GLYPHS = { verified: "tick", learnMore: "down" } as const satisfies Record<string, GlyphName>;
