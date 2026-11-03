// ════════════════════════════════════════════════════════════════════
// Foundry · Validating a post-login "?next=" redirect target
//
// guard.ts sends a bounced-to-login member here with ?next=<path they
// were on>, built server-side from a request header — never from
// anything a client sent. This function is nonetheless the side that
// has to validate it: a member can be handed a DIRECT link with an
// arbitrary "?next=" on it, bypassing guard.ts entirely, so this has to
// be as strict as if the whole thing were attacker-controlled — because
// it is.
//
// A string-heuristic check (reject anything starting with "//" or
// containing "://") is NOT enough: the WHATWG URL parser that both the
// browser and Next.js's own router use treats a LEADING BACKSLASH as a
// path separator for special schemes, and strips embedded tab/newline
// characters before parsing. "/\evil.example" and "/\t/evil.example" (a
// real tab byte) both pass a startsWith("/")-only check yet resolve to
// "https://evil.example/" the moment anything actually parses them as a
// URL — which router.replace() does. So: parse it the same way the
// router will, and compare origins, rather than pattern-matching
// spellings of "off this site" and hoping the list is complete.
export function safeNextPath(raw: string | null | undefined, origin: string): string | null {
  if (!raw) return null;
  try {
    const resolved = new URL(raw, origin);
    if (resolved.origin !== origin) return null;
    // Dot-segment normalisation can turn "/.//evil.example" into a
    // pathname of "//evil.example". The first parse stays same-origin,
    // but Next's router (and location.replace) treat a leading "//" as
    // scheme-relative and navigate off-site. Reject that shape, then
    // re-parse the string we are about to return so a second pass cannot
    // change the origin either.
    const next = resolved.pathname + resolved.search + resolved.hash;
    if (next.startsWith("//") || resolved.pathname.startsWith("//")) return null;
    const again = new URL(next, origin);
    if (again.origin !== origin) return null;
    if (again.pathname.startsWith("//")) return null;
    return again.pathname + again.search + again.hash;
  } catch {
    return null;
  }
}
