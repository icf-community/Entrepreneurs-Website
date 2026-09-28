import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getSiteBanner } from "@/lib/data/banner";

// ════════════════════════════════════════════════════════════════════
// Foundry · The live incident banner, as JSON (launch programme F-x4)
//
// Read by <SiteBanner /> on every signed-in page and on /login. Public on
// purpose: people who can't sign in are who most need the message. It is
// excluded from the proxy matcher, so a banner check costs no Auth round
// trip, and the CDN holds it for 15 seconds, so 500 members browsing add
// almost nothing to the database. A publish shows up within seconds.
//
// A failed read answers "no banner" rather than an error: the banner is a
// courtesy, and a broken courtesy must not put an error on every page.
// ════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

export async function GET() {
  let banner = null;
  try {
    banner = await getSiteBanner();
  } catch (e) {
    Sentry.captureException(e, { tags: { surface: "site-banner" } });
  }
  return NextResponse.json(
    { banner },
    { headers: { "Cache-Control": "public, max-age=15, s-maxage=15, stale-while-revalidate=30" } },
  );
}
