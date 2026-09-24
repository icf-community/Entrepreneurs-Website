import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { allow, clientIp } from "@/lib/ratelimit";
import { buildCsp, generateNonce } from "@/lib/csp";
import type { Database } from "@/lib/database.overrides";
import { fetchWithTimeout } from "@/lib/supabase/unavailable";

export async function updateSession(request: NextRequest, pathname?: string) {
  // Per-request CSP nonce. Carried on the *request* headers so Next.js stamps
  // it onto its own inline scripts, and echoed on the *response* so the
  // browser enforces the policy. Built before createServerClient so nothing
  // runs between that and getUser() (the @supabase/ssr auth race rule).
  const nonce = generateNonce();
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  // Read by guard.ts to send a member bounced to /login back to the page
  // they were on. Only ever set from request.nextUrl here, server-side —
  // never take this value from anything a client could pass in, or a
  // "?next=" open-redirect becomes a header-smuggling one instead.
  if (pathname) requestHeaders.set("x-pathname", pathname);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Runs on EVERY request, public pages included, so a hung Auth must
      // not freeze the site. On timeout getUser() just yields no user —
      // the same as any other error here; the proxy never redirects on it.
      global: { fetch: fetchWithTimeout(8_000) },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Touching getUser() here causes @supabase/ssr to refresh the session
  // cookie if it's near expiry. Do not run code between createServerClient
  // and getUser() — it's a known auth race condition.
  const { data: { user } } = await supabase.auth.getUser();

  // Backstop on mutations (Next server actions are POSTs). No-op unless
  // Upstash is configured; reads (GET/HEAD) never hit Redis. Cloudflare
  // absorbs real floods at the edge — this is defence in depth.
  //
  // Keyed on the account where there is one. Imperial students on campus
  // share a public IP, so an IP key is a campus key: onboarding is a server
  // action, and a signup wave after an announcement would spend one shared
  // 60/min budget between everyone — handing legitimate students a 429 that
  // reads as the site being broken, on the day it matters most.
  if (request.method !== "GET" && request.method !== "HEAD") {
    const allowed = user
      ? await allow("mutations", `u:${user.id}`)
      : await allow("anonMutations", `ip:${clientIp(request.headers)}`);
    if (!allowed) {
      return new NextResponse("Too many requests. Please slow down and try again shortly.", { status: 429 });
    }
  }

  response.headers.set("content-security-policy", csp);
  return response;
}
