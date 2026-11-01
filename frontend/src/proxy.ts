import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { buildStaticCsp } from "@/lib/csp";
import { isKnownRoute } from "@/lib/knownRoutes";

export async function proxy(request: NextRequest) {
  // A GET/HEAD to a path the app has no route for can only render the
  // prerendered 404. That page cannot carry a nonce, so give it the
  // nonce-free static policy (otherwise its scripts are blocked and the
  // starfield never starts) and skip the session round trip a 404 does not
  // need. Mutations still take the full path below: that is where the
  // rate-limit backstop lives. See knownRoutes.ts for why this list is
  // guarded by a test.
  if ((request.method === "GET" || request.method === "HEAD") && !isKnownRoute(request.nextUrl.pathname)) {
    const res = NextResponse.next();
    res.headers.set("content-security-policy", buildStaticCsp());
    return res;
  }
  return await updateSession(request, request.nextUrl.pathname + request.nextUrl.search);
}

export const config = {
  matcher: [
    // Run on every request except static assets and image optimisation.
    // Skipping fonts/css/js too — they don't need a session refresh and
    // running getUser() on every font request is wasted DB chatter.
    //
    // Also skipped: the pure-content public pages in csp.ts's
    // STATIC_CSP_ROUTES (/privacy, /terms, /cookies, /ai-notice). They need neither a
    // session nor a nonce, and during a traffic spike anonymous hits to
    // content pages are a large share of the load — each one was costing
    // a middleware invocation plus a Supabase Auth round trip for
    // nothing. next.config.ts serves them their CSP header instead.
    //
    // Kept as a literal rather than interpolated from STATIC_CSP_ROUTES:
    // Next.js requires this matcher to be statically analysable at build
    // time. csp.test.ts asserts the two stay in sync.
    // The `$` alternative in the lookahead is how "/" itself is excluded:
    // at the position just after the leading slash, an empty remainder
    // matches `$`, the negative lookahead fails, and the homepage is
    // skipped. Any other path has characters left, so `$` cannot match
    // there and nothing else is affected.
    //
    // privacy/terms/cookies are each anchored with (?:$|/) — without it,
    // the bare alternative "privacy" matches as a PREFIX, so a future
    // route like /privacy-settings would also be silently excluded from
    // session refresh (audit follow-up: confirmed with a direct regex
    // test against /privacy-settings, /termsofservice-x, /cookiesmonster
    // — all three matched the unanchored version before this fix, none of
    // the three are real routes today, so this was dormant, not live).
    //
    // Also skipped: /api/banner (F-x4). It reads no session and is CDN
    // cached, so the proxy's getUser() would be an Auth round trip per
    // page view for nothing.
    "/((?!_next/static|_next/image|favicon.ico|privacy(?:$|/)|terms(?:$|/)|cookies(?:$|/)|ai-notice(?:$|/)|api/banner$|$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|otf|css|js)$).*)",
  ],
};
