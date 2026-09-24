import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.overrides";
import { cookies } from "next/headers";
import { fetchWithTimeout } from "@/lib/supabase/unavailable";

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

  return createServerClient<Database>(
    url,
    anonKey,
    {
      global: { fetch: fetchWithTimeout(REQUEST_TIMEOUT_MS) },
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
