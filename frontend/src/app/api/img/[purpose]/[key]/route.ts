import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/auth/currentUser";
import { signedImageUrls, type BlobPurpose } from "@/lib/storage/blobRead";

// ════════════════════════════════════════════════════════════════════
// Foundry · Stable image redirect
//
// signedImageUrls mints a SAS URL that expires within the hour — fine for
// a page rendered fresh per request, but useless as a cacheable <img src>:
// a CDN or browser cache holding the URL past expiry serves a dead link.
// This route is the fix — a URL that never changes, redirecting to a
// freshly-minted SAS on every hit. The redirect response itself isn't
// cached (a plain 302, no Cache-Control set here); only the underlying
// blob bytes are, by whatever caches the final Azure response.
//
// Allow-listed to profile_picture only. Previously this route did no
// caller check because /committee showed avatars to signed-out visitors.
// /committee now requires an approved session, and list_committee_cards
// is revoked from anon, so the unauthenticated justification no longer
// holds. An approved member who already knows another member's avatar
// key must not be able to mint a permanent public read URL by logging
// out and hitting this path. Require an approved session before signing.
// ════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_PURPOSES: readonly BlobPurpose[] = ["profile_picture"];

const IMAGE_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ purpose: string; key: string }> },
) {
  const { purpose, key } = await params;

  if (!ALLOWED_PURPOSES.includes(purpose as BlobPurpose)) {
    return NextResponse.json({ error: "Unknown image purpose" }, { status: 404 });
  }
  if (!IMAGE_KEY.test(key)) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const { user } = await currentUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const { data: approved, error: gateError } = await supabase.rpc("is_approved");
  if (gateError || approved !== true) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const [url] = await signedImageUrls([key], purpose as BlobPurpose);
  if (!url) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  return NextResponse.redirect(url, { status: 302 });
}
