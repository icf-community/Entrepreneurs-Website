import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request, request.nextUrl.pathname + request.nextUrl.search);
}

export const config = {
  matcher: [
    // Run on every request except static assets and image optimisation.
    // Skipping fonts/css/js too — they don't need a session refresh and
    // running getUser() on every font request is wasted DB chatter.
    //
    // Also skipped: the pure-content public pages in csp.ts's
    // STATIC_CSP_ROUTES (/privacy, /terms, /cookies). They need neither a
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
    "/((?!_next/static|_next/image|favicon.ico|privacy|terms|cookies|$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|otf|css|js)$).*)",
  ],
};
