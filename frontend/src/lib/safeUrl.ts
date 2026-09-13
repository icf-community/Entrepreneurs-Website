// ════════════════════════════════════════════════════════════════════
// Foundry · Render-time gate for stored URLs
//
// Every member-supplied URL in this app is already validated twice on the
// way IN: a Zod `httpUrl` schema in lib/validation/listings.ts, and a
// CHECK constraint in the database (e.g. `events_luma_link_format`,
// `profiles_github_url_format`). This module is the third check, on the
// way OUT, and it exists for three reasons:
//
//   1. Neither of those guarantees is visible at the render site. A
//      reviewer reading `<a href={ev.lumaLink}>` cannot tell whether the
//      value was ever checked, and neither can CodeQL — which is exactly
//      why it flags this shape as js/xss-through-dom. Making the check
//      local to the render makes the safety readable where it matters.
//   2. The write-time guarantees are per-column. A column added later
//      without a CHECK, or a value written by an admin path or a raw SQL
//      fix, reaches the same anchors with nothing in front of it.
//   3. `javascript:` in an href executes on click. That is not a
//      theoretical XSS: it is a one-field, no-console attack on any
//      surface where one member's text becomes another member's link.
//
// The rule is the same one lib/validation/posts.ts already states for
// post bodies, and it is stated once more here so the two cannot drift:
// **http and https only, checked by `new URL` rather than by a regex,
// because `new URL` is what the browser will act on.** Anything else
// fails to `undefined`, which makes React omit the attribute entirely
// and renders inert text instead of a link. Failing to a non-link is
// always safe; failing to a link is not.
//
// NOT for internal paths. `new URL` throws on "/events/123", so a
// relative href passed here would silently vanish. App-constructed hrefs
// (nav, back links, mailto:, the Google Calendar/ICS links we build
// ourselves) are not member input and must not be routed through this.
// ════════════════════════════════════════════════════════════════════

/**
 * Return `value` if it is an absolute http(s) URL, otherwise `undefined`.
 *
 * The returned string is the parsed URL's normalised form, not the raw
 * input — so what the anchor carries is exactly what `new URL` resolved
 * and interrogated, with no room for the two to differ.
 */
export function externalHref(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch {
    // Not a parseable absolute URL. Fall through to undefined.
  }
  return undefined;
}
