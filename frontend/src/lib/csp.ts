// ════════════════════════════════════════════════════════════════════
// Content-Security-Policy — built per request in the middleware (proxy.ts)
// with a fresh nonce. The policy is derived from the SAME env the app uses
// (Supabase, PostHog, Sentry) so it can never drift from what actually
// loads, and no origin is hardcoded. Turnstile is a fixed Cloudflare host.
//
// Modern browsers enforce `'nonce-…' 'strict-dynamic'` for scripts; the
// `https:` and `'unsafe-inline'` tokens are ignored by CSP3 browsers when
// strict-dynamic is present and serve only as a fallback for older ones.
// ════════════════════════════════════════════════════════════════════

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

// Edge-runtime-safe nonce: Web Crypto + btoa (no Node Buffer).
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// The routes served a nonce-FREE policy from next.config, and skipped by
// the middleware entirely. Kept in one exported list so the header rule
// and the matcher can never drift apart — a route in one but not the
// other either loses its CSP or keeps paying for an Auth round trip.
//
// Membership here is deliberately narrow. A page qualifies only if it
// (a) is reachable while signed out, (b) needs no session, and (c)
// renders NO user-supplied content — so the weaker script-src below has
// nothing to be exploited through. /login and /contact are deliberately
// NOT on this list even though they are public: they take user input and
// are the highest-value phishing/XSS targets in the app, so they keep the
// strict nonce policy and the middleware.
//
// "/" joined the list on 2026-09-08 (C2 Finding 6). It is the app's
// most-requested route and measured its slowest — 12.3 s p95 at 500 VUs,
// all of it render cost, none of it data. Its whole component tree
// (Navbar, Hero, WhoWeAre, Community, Opportunities, Events, Apply,
// Footer) was checked against the three criteria above before adding it:
// no component reads a session or the database, and not one renders a
// form, an input, or a search param, so there is no path by which
// attacker-controlled bytes reach the HTML. Navbar is a client component
// holding nothing but scroll and menu-open state.
//
// This is the whole of what "static rendering" costs, and it is worth
// being explicit that the two are inseparable: a statically rendered page
// CANNOT carry a per-request nonce, and under `strict-dynamic` a script
// without a nonce is blocked even when it is our own bundle from 'self'
// (strict-dynamic drops host allowlists by design). So a route is either
// dynamic-with-strict-CSP or static-with-unsafe-inline. There is no third
// option short of hashing Next.js's per-build inline bootstrap, which
// changes every build. Anything rendering user content must therefore
// stay dynamic — which is why the listing pages are not here.
export const STATIC_CSP_ROUTES = ["/", "/privacy", "/terms", "/cookies"] as const;

export function buildCsp(nonce: string): string {
  const supabaseOrigin = originOf(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseWs = supabaseOrigin ? supabaseOrigin.replace(/^https:/, "wss:") : null;

  const posthogOrigin = originOf(process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com");
  // PostHog serves its JS bundle/array from a sibling "-assets" host.
  const posthogAssets = posthogOrigin ? posthogOrigin.replace(".i.posthog.com", "-assets.i.posthog.com") : null;

  const sentryOrigin = originOf(process.env.NEXT_PUBLIC_SENTRY_DSN);

  const turnstile = "https://challenges.cloudflare.com";

  // Community post images. Served straight from Azure Blob over a
  // short-expiry SAS, so the browser fetches them from the storage account
  // host rather than from us. Derived from the same env the URL signer
  // uses — a literal here would drift the moment the account is renamed.
  //
  // Built by hand rather than through originOf(): AZURE_STORAGE_ACCOUNT is
  // an account name, not a URL. This module runs in the edge runtime, so it
  // cannot import lib/storage/blobRead.ts (server-only, pulls in the SDK).
  const azureAccount = process.env.AZURE_STORAGE_ACCOUNT;
  const blobOrigin = azureAccount ? `https://${azureAccount}.blob.core.windows.net` : null;

  // The upload gateway belongs in connect-src, not img-src: the browser
  // POSTs image bytes to it and never renders anything from it.
  const gatewayOrigin = originOf(process.env.UPLOAD_GATEWAY_URL);

  const connectSrc = [
    "'self'", supabaseOrigin, supabaseWs, posthogOrigin, posthogAssets, sentryOrigin, turnstile, gatewayOrigin,
  ].filter(Boolean);
  const imgSrc = ["'self'", "data:", "blob:", supabaseOrigin, blobOrigin].filter(Boolean);

  // React uses eval() in development for richer error stacks; not needed in prod.
  const devEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'${devEval}`,
    // style-src has no nonce plumbing (Tailwind's inline `style=` usage is
    // app-wide and would all need it), so unlike script-src's unsafe-inline
    // above, this one isn't neutralized by strict-dynamic — it's a real
    // allowance. Accepted because nothing renders unsanitized HTML into
    // style anywhere in the app: no dangerouslySetInnerHTML touches styles,
    // no markdown renderer exists, and PostBody renders community post text
    // as text, never interpreted HTML.
    `style-src 'self' 'unsafe-inline'`,
    `img-src ${imgSrc.join(" ")}`,
    `font-src 'self' data:`,
    `connect-src ${connectSrc.join(" ")}`,
    `frame-src ${turnstile}`,
    `worker-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ];

  return directives.join("; ");
}

/**
 * Nonce-free CSP for STATIC_CSP_ROUTES.
 *
 * A per-request nonce is, by construction, per-request — which is what
 * forces those pages to be dynamically rendered and to pay for a
 * middleware invocation (and, before this, a Supabase Auth round trip)
 * on every anonymous hit. During a traffic spike, anonymous hits to
 * content pages are most of the traffic.
 *
 * The trade, stated plainly: `script-src` here is
 * `'self' 'unsafe-inline'` instead of `'nonce-…' 'strict-dynamic'`,
 * because Next.js emits inline bootstrap scripts that would otherwise be
 * blocked. That IS a weaker policy — an HTML injection on one of these
 * pages would execute. It is acceptable only because these pages render
 * no user-supplied content of any kind: they are static prose with no
 * form, no query-parameter echo, and no database read. The moment one of
 * them gains any of those, it must come off STATIC_CSP_ROUTES.
 *
 * Every other directive is identical to the strict policy, so the
 * framing, connect-src allow-list and frame-ancestors protections are
 * unchanged.
 */
export function buildStaticCsp(): string {
  return buildCsp("__static__")
    .split("; ")
    .map((directive) =>
      directive.startsWith("script-src ")
        ? `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`
        : directive,
    )
    .join("; ");
}
