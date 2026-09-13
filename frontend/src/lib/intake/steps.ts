// ════════════════════════════════════════════════════════════════════
// Foundry · Post-approval intake step model
//
// Identity (affiliation, name, course, grad year) is collected earlier,
// at /onboarding, and feeds the admin review queue before this flow
// ever runs — see 20260901000006's header comment for why the split
// happened. Everything here runs only once a member is approved, and
// writes through submit_intake once, then update_profile from then on.
//
// Most of it is skippable, but the CV screen isn't unconditionally so:
// a student must provide a CV and everyone must provide LinkedIn before
// "Skip for now" (or Finish) becomes available at all — see
// 20260901000013's header comment. Every other screen stays optional,
// GitHub included.
//
// GitHub gets its OWN screen, after the CV rather than on it: connecting
// navigates out to github.com and back, and useIntakeDraft deliberately
// excludes cvFile (a File) from the localStorage draft, so a member who
// chose a CV and then hit Connect would silently lose it. By the time
// this screen is reached the CV is already uploaded.
//
// "You're in" is a result screen, not a question — it carries no field
// and does not advance completeness. Termly refresh (screen 08 of the
// original nine-screen prototype) stays unrouted; see components/intake
// screens.tsx's RefreshScreen for why.
// ════════════════════════════════════════════════════════════════════

export type StepId = "face" | "youre-in" | "cv" | "github" | "skills" | "interests" | "where" | "want";

export type Step = {
  id: StepId;
  /** Sidebar number. null for screens that aren't a question. */
  num: string | null;
  /** Sidebar label — short. */
  label: string;
  /** Eyebrow above the heading. */
  eyebrow: string;
  /** The screen's own heading. */
  title: string;
};

export type Group = {
  label: string;
  /** Shown under the group label in the rail. */
  note: string;
  steps: StepId[];
};

export const STEPS: Record<StepId, Step> = {
  face: {
    id: "face",
    num: "01",
    label: "Face & bio",
    eyebrow: "Who you are",
    title: "Put a face to it",
  },
  "youre-in": {
    id: "youre-in",
    num: null,
    label: "You're in",
    eyebrow: "Welcome",
    title: "You're in",
  },
  cv: {
    id: "cv",
    num: "02",
    label: "CV",
    eyebrow: "Unlock your matches",
    title: "Your CV, if you have one",
  },
  github: {
    id: "github",
    num: "03",
    label: "GitHub",
    eyebrow: "Unlock your matches",
    title: "Your code, if you write any",
  },
  skills: {
    id: "skills",
    num: "04",
    label: "Skills",
    eyebrow: "Unlock your matches",
    title: "What are you actually good at?",
  },
  interests: {
    id: "interests",
    num: "05",
    label: "Interests",
    eyebrow: "Unlock your matches",
    title: "What you're into",
  },
  where: {
    id: "where",
    num: "06",
    label: "Where you're at",
    eyebrow: "Where you're at",
    title: "Where are you at?",
  },
  want: {
    id: "want",
    num: "07",
    label: "What you want",
    eyebrow: "Where you're at",
    title: "What do you want from this?",
  },
};

export const GROUPS: Group[] = [
  { label: "Who you are", note: "A face and a couple of lines.", steps: ["face", "youre-in"] },
  { label: "Unlock your matches", note: "Skip the whole thing if you're not ready yet.", steps: ["cv", "github", "skills", "interests"] },
  { label: "Where you're at", note: "Changes often — you can always update it.", steps: ["where", "want"] },
];

/** Flat running order. */
export const ORDER: StepId[] = GROUPS.flatMap((g) => g.steps);

export const TOTAL_SCREENS = ORDER.length;

export const indexOf = (id: StepId): number => ORDER.indexOf(id);

/** The real questions — "You're in" is a result, and doesn't advance this. */
const QUESTION_ORDER: StepId[] = ["face", "cv", "github", "skills", "interests", "where", "want"];

/**
 * Profile completeness, as a percentage, spread evenly over the
 * question screens. "You're in" reports the same value as "face" — it
 * hasn't asked anything new yet. Derived from QUESTION_ORDER.length, so
 * inserting a screen rescales it rather than needing a constant edited.
 */
export function completeness(id: StepId): number {
  const base = id === "youre-in" ? "face" : id;
  const i = QUESTION_ORDER.indexOf(base);
  return Math.round(((i + 1) / QUESTION_ORDER.length) * 100);
}

// ─── Affiliation ─────────────────────────────────────────────────────
// Six, per PRODUCT.md's six audiences. `student` and `alum` are the two
// values already in the user_role enum and carry live rows; the other four
// are added by migration before this can be submitted.
//
// Only `student` auto-approves, and only against a verified Imperial
// address. Every other value goes to the manual review queue — the mapping
// lives in submit_onboarding, not here.

export type Affiliation =
  | "student"
  | "recent_grad"
  | "alum"
  | "mentor"
  | "angel"
  | "staff_faculty";

export const AFFILIATIONS: { value: Affiliation; label: string; blurb: string }[] = [
  { value: "student", label: "Current student", blurb: "Undergrad, postgrad or PhD, building while you study." },
  { value: "recent_grad", label: "Recent graduate", blurb: "Within three years of graduating." },
  { value: "alum", label: "Alumni founder", blurb: "Imperial alum who has been through it." },
  { value: "mentor", label: "Mentor", blurb: "An operator or expert making time for the community." },
  { value: "angel", label: "Angel investor", blurb: "Looking at early-stage Imperial-connected startups." },
  { value: "staff_faculty", label: "Staff or faculty", blurb: "Researcher or professor bridging academia and startups." },
];

/**
 * Everyone who is not a current student.
 *
 * The two groups differ by how they get in, not by how they describe
 * themselves: a student is auto-approved off a verified Imperial address,
 * and every one of these five lands in pending_review for an admin (the
 * status map in migration 20260603000001). /login offers that split as its
 * two front doors and this list as the dropdown behind the second; /profile
 * offers it as the set a member may move between.
 */
export const NON_STUDENT_AFFILIATIONS = AFFILIATIONS.filter((a) => a.value !== "student");

/** Graduation year is meaningless for these three. */
export const NO_GRAD_YEAR: Affiliation[] = ["mentor", "angel", "staff_faculty"];

/** Whether this affiliation graduated already (past bound) or hasn't (future bound). */
export const HAS_GRADUATED: Affiliation[] = ["recent_grad", "alum"];
