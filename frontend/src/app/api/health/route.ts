import "server-only";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createServiceClient } from "@/lib/supabase/service";

// ════════════════════════════════════════════════════════════════════
// Foundry · Health check for external uptime monitoring
//
// A plain "the Next.js process is up" check is useless here — Vercel
// itself already reports that. What an external monitor actually needs
// to catch is a paused/suspended Supabase project (the free-tier
// database goes to sleep after a week of no traffic), which looks
// identical to "the site is up" from outside unless something on this
// route actually touches the database. Unauthenticated by design: an
// uptime monitor has no credentials, and this leaks nothing beyond
// "the DB answered a trivial query". The failure body is just
// {ok:false}: DB error text can name tables or hosts, so the detail goes
// to Sentry, never to an anonymous caller.
// ════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const { error } = await createServiceClient()
      .from("app_config")
      .select("key")
      .limit(1);
    if (error) {
      Sentry.captureMessage("health check: database query failed", {
        level: "error",
        tags: { surface: "api-health" },
        extra: { code: error.code },
      });
      return NextResponse.json({ ok: false }, { status: 503 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    Sentry.captureException(e, { tags: { surface: "api-health" } });
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
