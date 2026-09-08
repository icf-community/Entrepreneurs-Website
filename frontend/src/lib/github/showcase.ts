// Types and constants for the member-chosen GitHub showcase.
//
// Deliberately NOT in profile/mediaActions.ts, even though that is where
// the actions live: that file carries "use server", and a "use server"
// module may only export async functions. A constant or a type exported
// from there fails the build the moment a client component imports it.
//
// See 20260907000004_github_showcase.sql for the server-side contract
// these mirror.

/** One repo as it appears in the picker. Metadata only — no README. */
export type AvailableRepo = {
  name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  url: string | null;
  pushed_at: string | null;
};

/** A repo the member has chosen, with their own one-line blurb. */
export type ShowcaseRepo = AvailableRepo & { blurb: string | null };

export type GithubShowcase = {
  availableRepos: AvailableRepo[];
  /** null = never opened the picker. [] = opened it and chose none. */
  showcaseRepos: ShowcaseRepo[] | null;
  /** The LLM's suggestions — a starting point, never an authority. */
  suggestedRepos: AvailableRepo[];
  /** Names already shown to this member; anything else gets a "New" chip. */
  seenRepos: string[];
};

/** Client-side blurb cap. set_my_github_showcase truncates at the same
 *  length server-side — that one is the enforcement, this one is so the
 *  member can see the limit while typing. */
export const SHOWCASE_BLURB_MAX = 140;

/** Matches the github_connections_showcase_repos_len CHECK constraint. */
export const SHOWCASE_MAX_PICKS = 3;
