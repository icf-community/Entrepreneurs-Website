import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { throwIfAuthUnreachable, throwIfUnreachable } from "@/lib/supabase/unavailable";

// Server-side admin gate. notFound() renders the same 404 page as any
// non-existent route, so non-admins can't even tell the route exists.
// This is defense in depth — the database (RLS + is_admin checks inside
// every admin RPC function) is the actual security boundary.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  // An outage must reach the error page, not a 404 telling an admin their
  // own panel does not exist.
  throwIfAuthUnreachable("session", authError);
  if (!user) notFound();

  const adminRes = await supabase.rpc("is_admin");
  throwIfUnreachable("is_admin", adminRes);
  if (!adminRes.data) notFound();

  return <>{children}</>;
}
