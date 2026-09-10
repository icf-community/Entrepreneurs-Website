// ════════════════════════════════════════════════════════════════════
// Foundry · Intake form state
//
// One flat object rather than a dozen useState calls — screens read
// each other's answers ("You're in" greets by the preferred name given
// on the previous screen). The *_value fields below are the exact
// strings the CHECK constraints in 20260901000004/000005 accept; the
// label a member sees and the value that gets written are kept
// separate so copy can change without a migration.
// ════════════════════════════════════════════════════════════════════

export type IntakeState = {
  // Face & bio
  preferredName: string;
  photoBlob: Blob | null; // the cropped square, ready to upload
  photoPreview: string | null; // object URL for the cropped result
  bioFocus: string;
  bioHobbies: string;

  // CV
  cvFile: File | null;
  cvUploadedKey: string | null; // set once confirm_cv_upload has succeeded
  cvOriginalFilename: string | null;
  cvConsent: boolean;
  linkedin: string;

  // Skills — ids into the closed taxonomy, never free text
  skillIds: number[];
  coreSkillIds: number[];
  /** Suggested by the CV text match, shown as "found in your CV" chips
   *  until tapped. Never written unless the member adds them. */
  suggestedSkillIds: number[];
  /** Subset of skillIds that got there by the member tapping a CV
   *  suggestion, as opposed to searching for it themselves. Lets
   *  "Upload a different CV" (screens.tsx's SkillsScreen) discard only
   *  the skills the OLD CV contributed once a replacement is confirmed
   *  — anything the member typed in by hand survives untouched. */
  cvSkillIds: number[];

  // Interests
  sectorIds: number[];
  academicInterests: string[]; // free text
  hobbies: string[]; // free text

  // Where you're at
  currentFocus: string;
  ventureStage: string;
  ventureName: string;
  ventureUrl: string;
  ventureOneLiner: string;
  recruitingStatus: string;

  // What you want
  intents: string[]; // ranked, coded values, max 3
  intentUrgency: string;
  availabilityHours: string;
};

export const MAX_CORE_SKILLS = 3;
export const MIN_SKILLS = 3;
export const MAX_INTENTS = 3;
export const MAX_INTERESTS_PER_KIND = 12;

export function initialState(seed: {
  preferredName: string;
  /** A previously-confirmed avatar, signed for display. */
  photoPreview?: string | null;
  /** A previously-confirmed CV — its blob key and display filename. */
  cvUploadedKey?: string | null;
  cvOriginalFilename?: string | null;
  /** LinkedIn already on file (non-students give this at /onboarding). */
  linkedin?: string | null;
}): IntakeState {
  return {
    preferredName: seed.preferredName,
    photoBlob: null,
    photoPreview: seed.photoPreview ?? null,
    bioFocus: "",
    bioHobbies: "",

    cvFile: null,
    cvUploadedKey: seed.cvUploadedKey ?? null,
    cvOriginalFilename: seed.cvOriginalFilename ?? null,
    cvConsent: false,
    linkedin: seed.linkedin ?? "",

    skillIds: [],
    coreSkillIds: [],
    suggestedSkillIds: [],
    cvSkillIds: [],

    sectorIds: [],
    academicInterests: [],
    hobbies: [],

    currentFocus: "",
    ventureStage: "",
    ventureName: "",
    ventureUrl: "",
    ventureOneLiner: "",
    recruitingStatus: "",

    intents: [],
    intentUrgency: "",
    availabilityHours: "",
  };
}

/** What we call them on screens after the first. Falls back rather than greeting a blank. */
export function addressAs(preferredName: string, firstName: string): string {
  return preferredName.trim() || firstName.trim() || "there";
}

export const CURRENT_FOCUS: { value: string; label: string }[] = [
  { value: "studying", label: "Just studying" },
  { value: "studying_building", label: "Studying and building something" },
  { value: "building_full_time", label: "Building full-time" },
  { value: "employed", label: "Employed" },
  { value: "employed_building", label: "Employed and building on the side" },
  { value: "research_phd", label: "PhD or research" },
  { value: "paused_studies_to_build", label: "Paused studies to build" },
  { value: "job_hunting", label: "Job hunting" },
  { value: "between_things", label: "Between things" },
];

export const VENTURE_STAGES: { value: string; label: string }[] = [
  { value: "nothing_yet", label: "Nothing yet" },
  { value: "exploring_ideas", label: "Exploring ideas" },
  { value: "validating", label: "Validating it" },
  { value: "building_mvp", label: "Building an MVP" },
  { value: "launched_early_users", label: "Launched, early users" },
  { value: "generating_revenue", label: "Generating revenue" },
  { value: "raised_funding", label: "Raised funding" },
  { value: "founded_before_between", label: "Founded before, between ventures" },
  { value: "not_building_want_to_join", label: "Not building — want to join one" },
];

/** Stages after which "one line on what it does" and "recruiting?" make sense. */
export const VENTURE_STAGES_WITH_DETAIL = new Set([
  "exploring_ideas", "validating", "building_mvp", "launched_early_users",
  "generating_revenue", "raised_funding",
]);

export const RECRUITING_STATUSES: { value: string; label: string }[] = [
  { value: "not_right_now", label: "Not right now" },
  { value: "co_founder", label: "Co-founder" },
  { value: "first_hires", label: "First hires" },
  { value: "interns", label: "Interns" },
  { value: "advisors", label: "Advisors" },
];

export const INTENTS: { value: string; label: string }[] = [
  { value: "find_cofounder", label: "A co-founder" },
  { value: "first_hire", label: "A first hire" },
  { value: "investor_intros", label: "Intros to investors" },
  { value: "find_mentor", label: "A mentor" },
  { value: "technical_help", label: "Technical help" },
  { value: "customers", label: "Customers to talk to" },
  { value: "somewhere_to_start", label: "Somewhere to start" },
  { value: "just_curious", label: "Just curious" },
  { value: "taste_of_community", label: "A taste of the community" },
  { value: "meet_people", label: "Meet like-minded people" },
];

export const INTENT_URGENCIES: { value: string; label: string }[] = [
  { value: "open_not_urgent", label: "Just browsing" },
  { value: "next_few_months", label: "Next few months" },
  { value: "actively_looking", label: "Actively looking now" },
];

export const AVAILABILITY_HOURS: { value: string; label: string }[] = [
  { value: "under_5", label: "<5" },
  { value: "5_10", label: "5–10" },
  { value: "10_20", label: "10–20" },
  { value: "20_plus", label: "20+" },
  { value: "full_time", label: "Full-time" },
];
