// Shared between mediaActions.ts's requestGithubConnectUrl (sets this
// cookie before redirecting to GitHub) and the
// /auth/github-connect/callback route (reads and clears it) — a single
// source of truth for the cookie name so a rename in one place can't
// silently break the other.
export const GITHUB_OAUTH_STATE_COOKIE = "github_oauth_state";

// Where to send the member back to after GitHub redirects. Connecting can
// now start from two places — the profile page and the intake flow's
// GitHub screen — and they must land back where they started or the
// intake flow silently drops someone mid-signup.
//
// A COOKIE rather than a query parameter, and a two-value allow-list
// rather than a path: a redirect destination that came from the URL would
// be an open redirect, and one that came from a cookie but was used
// verbatim would be no better. The callback maps this to a hardcoded path
// and defaults to the profile on anything unrecognised.
export const GITHUB_OAUTH_RETURN_COOKIE = "github_oauth_return";

export type GithubConnectReturnTo = "profile" | "intake";

export function githubConnectReturnPath(raw: string | undefined): string {
  return raw === "intake" ? "/intake" : "/profile";
}
