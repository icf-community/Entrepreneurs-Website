import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/auth/guard";

// ════════════════════════════════════════════════════════════════════
// Foundry · /admin/community → /admin/members
//
// This route was the admin view of the member directory. With a
// member-facing post feed now living at /community, the name meant two
// different things depending on whether it had /admin in front of it —
// so it has moved to /admin/members, matching the /members it manages.
//
// 307, not 308, matching the redirect /community itself used while it was
// waiting for the feed: a permanent redirect gets cached by browsers and
// intermediaries, and an admin who visited the old path once would be
// stuck with a cached hop long after this file is deleted.
//
// The query string is carried across because the directory's filters live
// in the URL, and admins have those links saved.
// ════════════════════════════════════════════════════════════════════

export default async function AdminCommunityRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage();
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) {
      for (const v of value) qs.append(key, v);
    } else if (value !== undefined) {
      qs.set(key, value);
    }
  }
  const query = qs.toString();
  redirect(query ? `/admin/members?${query}` : "/admin/members");
}
