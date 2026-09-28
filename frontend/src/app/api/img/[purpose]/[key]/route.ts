import "server-only";
import { NextResponse, type NextRequest } from "next/server";
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
// Allow-listed to profile_picture only, and this is the whole of the
// access control here — this route does NO caller-identity check.
// Every other caller of signedImageUrls gates on membership/ownership
// before minting a URL (see blobRead.ts's own module docstring); this
// route by design cannot, so post_image and cv must never be reachable
// through it. profile_picture is safe specifically because /committee is
// the one page in the app that shows an avatar to a signed-out visitor by
// design — nothing else needs an unauthenticated image redirect today.
// ════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_PURPOSES: readonly BlobPurpose[] = ["profile_picture"];

// The only key shape the upload pipeline generates for an image: uuid4 +
// ".webp" (issue_upload_ticket; the gateway's is_valid_key enforces the
// same). The key is the one input this unauthenticated route trusts, so
// nothing else reaches the signer. No per-IP limit on purpose: GET traffic
// is left to Cloudflare (see ratelimit.ts), and campus NAT would make an IP
// bucket a whole-university bucket for /committee.
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

  const [url] = await signedImageUrls([key], purpose as BlobPurpose);
  if (!url) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  return NextResponse.redirect(url, { status: 302 });
}
