// Site identity constants and the Organization/WebSite JSON-LD graph.
//
// Extracted from app/layout.tsx on 2026-09-08 (C2 Finding 6). The graph
// used to be emitted from the root layout, which meant reading the
// per-request CSP nonce with headers() — and a dynamic API in the root
// layout opts EVERY route in the app out of static rendering. Pulling it
// into its own module lets the layout keep the constants for its
// metadata while app/page.tsx renders the tag, so nothing in the layout
// touches a request-scoped API any more.
//
// NOTE: SITE_URL is hardcoded here, whereas lib/siteUrl.ts derives its
// base from NEXT_PUBLIC_SITE_URL. That divergence predates this change
// and is deliberate for now — structured data and canonical metadata must
// name the real production identity even when a preview deployment is
// serving from a vercel.app host, or every preview would advertise itself
// to search engines as the canonical site. Left as-is rather than
// "tidied" into one constant, which would break that property.

export const SITE_URL = "https://www.imperialentrepreneurs.com";
export const SITE_NAME = "Imperial Entrepreneurs";

/**
 * Serialise the JSON-LD graph for embedding in a <script> tag.
 *
 * On dangerouslySetInnerHTML: it is unavoidable here and it is not an XSS
 * risk in this specific use, but the reasoning matters more than the
 * conclusion, because the conclusion stops holding the moment the input
 * changes.
 *
 * Why it is unavoidable: React escapes text children as HTML, so
 * `<script>{JSON.stringify(x)}</script>` emits `&quot;` where the JSON
 * needs `"` and produces a structured-data block no crawler can parse.
 * A <script> body is not HTML, so the only way to write one from React is
 * to bypass HTML escaping. Next.js's own documentation prescribes exactly
 * this pattern for JSON-LD.
 *
 * Why it is safe HERE: the only thing ever passed in is the module-level
 * constant below. It is hardcoded, contains no interpolation, and no
 * database value, request parameter or member-supplied string reaches it.
 * There is no attacker-controlled byte anywhere in the input, so there is
 * nothing to inject. (It is also the ONLY dangerouslySetInnerHTML in the
 * codebase — PostBody.tsx and csp.ts both carry comments forbidding
 * another, and community post text is rendered as text, never as HTML.)
 *
 * Why it is escaped anyway: the real, well-documented failure mode for
 * JSON-LD is not script injection through the value, it is the two-byte
 * sequence `</` inside any string closing the <script> element early —
 * everything after it is then parsed as markup. JSON.stringify does not
 * escape `<`, because it is a perfectly legal JSON character. Today no
 * string in the graph contains one; the danger is the future edit that
 * adds an organisation description or an event name pulled from the
 * database and quietly turns a safe call into an injection point.
 * Replacing `<` with its `<` escape costs nothing, is invisible to
 * every JSON parser, and makes that class of bug impossible rather than
 * merely absent — so the safety no longer depends on remembering this.
 */
export function serialiseJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

// Organization + WebSite structured data. This is the primary signal that the
// site *is* the entity "Imperial Entrepreneurs" (knowledge panel / sitelinks /
// branded-search recognition). alternateName carries the "Foundry" product brand.
export const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      alternateName: "Foundry",
      url: SITE_URL,
      // Square mark, not the banner lockup: this slot is cropped to a
      // square in knowledge panels and chat unfurls, and is also served raw.
      logo: `${SITE_URL}/logo-square.png`,
      description:
        "The founder community at Imperial College London, connecting student founders, alumni, mentors, and investors through Foundry.",
      sameAs: [
        "https://www.linkedin.com/company/imperial-entrepreneurs/",
        "https://www.instagram.com/imperialentrepreneurs/",
      ],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: SITE_NAME,
      alternateName: "Foundry",
      url: SITE_URL,
      publisher: { "@id": `${SITE_URL}/#organization` },
      inLanguage: "en-GB",
    },
  ],
};
