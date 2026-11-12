import "server-only";
import { rows, rowsOrThrow, type Db } from "./query";
import { cached } from "@/lib/cache";

// ════════════════════════════════════════════════════════════════════
// Foundry · Skills and sectors
//
// These two selects were written out verbatim in five files —
// onboarding, profile, opportunities/new, admin/opportunities/new and
// opportunities/[id]/edit — because every form that renders a chip
// picker needs the same reference data:
//
//   supabase.from("skills").select("id, name").order("name")
//   supabase.from("sectors").select("id, name").order("name")
//
// None of the five went through reportIfCapped. That is the failure this
// module is really about: skills and sectors are seeded lists that a
// human adds to by hand, so nobody thinks of them as growing — but the
// cap does not care why a table got long, and a truncated picker would
// just quietly stop offering the last skill in the alphabet. Routing
// them through rows() applies the check without anyone remembering to.
//
// Having one home also makes the obvious next move — wrapping these in
// cached(), since they change maybe once a year — a change to one file
// rather than to five.
// ════════════════════════════════════════════════════════════════════

/**
 * A row from `skills` or `sectors`.
 *
 * Structurally identical to `ChipItem` in components/forms/ChipGroup,
 * which is what consumes it. Declared separately rather than imported
 * because lib/data is `server-only` and must not depend on a component;
 * TypeScript matches them structurally, so no conversion is needed.
 */
export type Taxon = { id: number; name: string };

export async function listSkills(db: Db): Promise<Taxon[]> {
  return cached(
    "skills",
    () => rows("skills", () => db.from("skills").select("id, name").order("name")),
    { isCacheable: (v) => v.length > 0 },
  );
}

/** A skill row plus the fields the closed-taxonomy picker and the
 *  deterministic CV matcher need: `category` for grouping the picker,
 *  `aliases` for matching a CV's own vocabulary onto our skill ids. */
export type SkillDetail = { id: number; name: string; category: string | null; aliases: string[] };

export async function listSkillsDetailed(db: Db): Promise<SkillDetail[]> {
  return cached(
    "skillsDetailed",
    () =>
      rows("skills", () =>
        db.from("skills").select("id, name, category, aliases").order("category").order("name"),
      ) as unknown as Promise<SkillDetail[]>,
    { isCacheable: (v) => v.length > 0 },
  );
}

export async function listSectors(db: Db): Promise<Taxon[]> {
  return cached(
    "sectors",
    () => rows("sectors", () => db.from("sectors").select("id, name").order("name")),
    { isCacheable: (v) => v.length > 0 },
  );
}

/**
 * Both pickers at once. Every caller needs both, and running them as a
 * pair here keeps them concurrent even when the page has already put
 * this call inside a wider Promise.all.
 */
export async function listTaxonomy(db: Db): Promise<{ skills: Taxon[]; sectors: Taxon[] }> {
  const [skills, sectors] = await Promise.all([listSkills(db), listSectors(db)]);
  return { skills, sectors };
}

// D3: the reads below prefill edit forms, and every save of those forms
// REPLACES the rows (update_profile/_apply_intake_fields and the listing
// update RPCs delete then re-insert). So a read that failed must not look
// like "none selected": saving that form would erase the member's skills,
// sectors, interests and intents. They throw to the segment's error page
// instead of degrading to [] like rows().

/** The ids a chip picker should start with, for the two junction shapes. */
export type SelectedTaxonomy = { skillIds: number[]; sectorIds: number[] };

/** Which skills and sectors a member has on their profile. */
export async function profileTaxonomy(db: Db, profileId: string): Promise<SelectedTaxonomy> {
  const [skills, sectors] = await Promise.all([
    rowsOrThrow("profile_skills", () => db.from("profile_skills").select("skill_id").eq("profile_id", profileId)),
    rowsOrThrow("profile_sectors", () => db.from("profile_sectors").select("sector_id").eq("profile_id", profileId)),
  ]);
  return {
    skillIds:  skills.map((r) => r.skill_id),
    sectorIds: sectors.map((r) => r.sector_id),
  };
}

/** Everything /intake and /profile write beyond identity and sectors —
 *  core-starred skills, free-text interests/hobbies, and ranked intents. */
export type ProfileIntakeData = {
  skillIds: number[];
  coreSkillIds: number[];
  sectorIds: number[];
  academicInterests: string[];
  hobbies: string[];
  intents: string[];
};

export async function profileIntakeData(db: Db, profileId: string): Promise<ProfileIntakeData> {
  const [skills, sectors, interests, intents] = await Promise.all([
    rowsOrThrow("profile_skills", () =>
      db.from("profile_skills").select("skill_id, is_core").eq("profile_id", profileId),
    ),
    rowsOrThrow("profile_sectors", () => db.from("profile_sectors").select("sector_id").eq("profile_id", profileId)),
    rowsOrThrow("profile_interests", () =>
      db.from("profile_interests").select("kind, label").eq("profile_id", profileId),
    ),
    rowsOrThrow("profile_intents", () =>
      db.from("profile_intents").select("intent, rank").eq("profile_id", profileId).order("rank"),
    ),
  ]);

  return {
    skillIds: skills.map((r) => r.skill_id),
    coreSkillIds: skills.filter((r) => r.is_core).map((r) => r.skill_id),
    sectorIds: sectors.map((r) => r.sector_id),
    academicInterests: interests.filter((r) => r.kind === "academic").map((r) => r.label),
    hobbies: interests.filter((r) => r.kind === "hobby").map((r) => r.label),
    intents: intents.map((r) => r.intent),
  };
}

/** Which skills and sectors are tagged on one opportunity. */
export async function opportunityTaxonomy(db: Db, opportunityId: string): Promise<SelectedTaxonomy> {
  const [skills, sectors] = await Promise.all([
    rowsOrThrow("opportunity_skills", () => db.from("opportunity_skills").select("skill_id").eq("opportunity_id", opportunityId)),
    rowsOrThrow("opportunity_sectors", () => db.from("opportunity_sectors").select("sector_id").eq("opportunity_id", opportunityId)),
  ]);
  return {
    skillIds:  skills.map((r) => r.skill_id),
    sectorIds: sectors.map((r) => r.sector_id),
  };
}
