import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.overrides";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Realtime bills peak concurrent connections. realtime-js keeps the
      // socket open 50 s after the last channel leaves (2 × heartbeat); 5 s
      // still absorbs a dialog remounting, then frees the connection.
      realtime: { disconnectOnEmptyChannelsAfterMs: 5_000 },
    },
  );
}
