import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.overrides";
import { cookies, headers } from "next/headers";
import { fetchWithTimeout } from "@/lib/supabase/unavailable";
import { perfEnabled, withPerf } from "@/lib/perf/metrics";

// A stalled Supabase connection must fail, not hang: without a timeout a
// page waits until the platform kills the function and never reaches the
// error page (see lib/supabase/unavailable.ts). 25s is far above measured
// p99; the service client is deliberately left without one.
const REQUEST_TIMEOUT_MS = 25_000;

export async function createClient() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (!anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set");

  // Local load testing only (E1c): time every DB/Auth call by route. The
  // header read happens only when PERF_METRICS=1, never in prod.
  const route = perfEnabled() ? (await headers()).get("x-pathname") : null;

  return createServerClient<Database>(
    url,
    anonKey,
    {
      global: { fetch: withPerf(fetchWithTimeout(REQUEST_TIMEOUT_MS), route) },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component — cookies can't be set here.
            // src/proxy.ts refreshes the session on every request, so the
            // refreshed cookies are written there instead.
          }
        },
      },
    },
  );
}
