// The first path segment of every route the app serves.
//
// Why this exists: the global 404 is prerendered, so it cannot carry a
// per-request CSP nonce, and the strict nonce + strict-dynamic policy then
// blocks its own bundle (the page paints but never hydrates). A 404 can be
// any URL, so it cannot be listed in csp.ts's STATIC_CSP_ROUTES. Instead the
// proxy asks "is this a real route?" and, if not, serves the nonce-free
// static policy; the only thing such a path can render is the 404.
//
// This list is therefore security-relevant: a real route that is missing from
// it would be served the WEAKER policy (script-src 'unsafe-inline') and skip
// the session refresh. knownRoutes.test.ts reads src/app and fails the build
// if a route folder is not listed, so that cannot happen silently.
//
// Only the first segment matters. /events/x/y/z (unmatched, under a known
// prefix) keeps the strict policy, which is harmless: it just leaves that
// one 404 without its animation.
const KNOWN_ROUTE_SEGMENTS: ReadonlySet<string> = new Set([
  // App route folders (src/app/*).
  "admin", "ai-notice", "api", "auth", "calendar", "committee", "community", "connections",
  "contact", "cookies", "events", "foundry-ai", "home", "intake", "login", "members",
  "messaging", "my-activity", "my-bookmarks", "my-submissions", "notifications",
  "onboarding", "opportunities", "pending", "privacy", "profile", "rejected",
  "reset-password", "settings", "terms", "vcs",
  // Next internals that reach the proxy (static/image are excluded by the
  // matcher, the rest keep the strict policy exactly as before).
  "_next",
  // Routes generated from files in src/app (metadata conventions).
  "robots.txt", "sitemap.xml", "manifest.webmanifest", "icon.png", "apple-icon.png", "favicon.ico",
]);

// Is this path (possibly) one of ours?
//
// The answer decides whether a request gets the WEAKER policy, so it errs
// hard towards "yes": Next decodes and normalises the path before routing, so
// `/%65vents`, `/Events`, `//events`, `/./events` and `/foo/../events` can all
// reach the real /events page, and a check that only compared the raw first
// segment would have served that page the weak policy. Therefore the path is
// decoded (repeatedly, to defeat double encoding), split on both slash kinds,
// and anything unreadable, dotted or containing control characters counts as
// known. Only a path that is clearly junk is "unknown".
export function isKnownRoute(pathname: string): boolean {
  if (pathname === "/") return true;

  let p = pathname;
  for (let i = 0; i < 3; i++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(p);
    } catch {
      return true; // malformed escape: cannot be read, so do not relax anything
    }
    if (decoded === p) break;
    p = decoded;
  }
  if (/[\u0000-\u001f\u007f]/.test(p)) return true;

  const segments = p.split(/[/\\]+/).filter(Boolean);
  if (segments.length === 0 || segments.some((s) => s === "." || s === "..")) return true;
  return KNOWN_ROUTE_SEGMENTS.has(segments[0].toLowerCase());
}
