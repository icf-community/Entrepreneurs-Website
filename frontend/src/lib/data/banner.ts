import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.overrides";
import { cached } from "@/lib/cache";

// The incident banner (launch programme F-x4). One small public read,
// shared by every visitor, so it goes through the cache and a CDN-cached
// route rather than a query per page view.

export type SiteBanner = {
  message: string;
  severity: "info" | "warning" | "critical";
  linkUrl: string | null;
  version: number;
};

/**
 * The live banner, or null. Uses a session-less anon client: the RPC is
 * public by design (the login page shows it), so no member's session or
 * the service key is needed. Throws on failure; the route decides what an
 * unreadable banner means (nothing is shown).
 */
export async function getSiteBanner(): Promise<SiteBanner | null> {
  const { banner } = await cached("siteBanner", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Supabase is not configured");
    const db = createSupabaseClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.rpc("get_site_banner");
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : null;
    return {
      banner: row
        ? {
            message: row.message,
            severity: row.severity as SiteBanner["severity"],
            linkUrl: row.link_url,
            version: row.version,
          }
        : null,
    };
  });
  return banner;
}
