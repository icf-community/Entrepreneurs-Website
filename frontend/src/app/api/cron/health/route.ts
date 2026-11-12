import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { createServiceClient } from "@/lib/supabase/service";

// ════════════════════════════════════════════════════════════════════
// Foundry · Health check (launch programme G3/G4)
//
// Invoked by pg_cron every 10 minutes via pg_net (cron_health_check in
// 20260928000006). Two jobs:
//
//   1. Check in with the Sentry cron monitor "app-health". The whole chain
//      (pg_cron, pg_net, app_config's health_url and cron_secret, this
//      route, Sentry) has to work for a check-in to arrive, so a missed
//      one means something in it broke.
//   2. Report every failing check from app_health_snapshot() to Sentry as
//      its own issue. The snapshot decides when to report (first failure,
//      then hourly), so this route holds no state.
//
// Same shared-secret bearer auth as the other cron routes. A request
// without it never checks in: a stranger's call must not be able to mark
// the monitor healthy.
// ════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type Check = { check: string; ok: boolean; report: boolean; detail: unknown; failing_since: string | null };

export async function POST(req: NextRequest) { return health(req); }
// GET for manual testing from cURL; the bearer check still applies.
export async function GET(req: NextRequest) { return health(req); }

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

async function health(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    Sentry.captureMessage("health: CRON_SECRET is not configured", {
      level: "error", tags: { surface: "cron", path: "health" },
    });
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const failing = await Sentry.withMonitor(
      "app-health",
      async () => {
        const { data, error } = await createServiceClient().rpc("app_health_snapshot");
        // Throwing marks the check-in failed, which alerts on its own.
        if (error) throw new Error(`app_health_snapshot failed: ${error.code ?? "unknown"}`);
        const checks = (data ?? []) as Check[];
        for (const c of checks) {
          if (c.ok || !c.report) continue;
          Sentry.captureMessage(`health: ${c.check}`, {
            level: "error",
            fingerprint: ["app-health", c.check],
            tags: { surface: "health", check: c.check },
            extra: { detail: c.detail, failing_since: c.failing_since },
          });
        }
        return checks.filter((c) => !c.ok).map((c) => c.check);
      },
      {
        schedule: { type: "crontab", value: "*/10 * * * *" },
        checkinMargin: 5,
        maxRuntime: 2,
        timezone: "Etc/UTC",
      },
    );
    return NextResponse.json({ ok: failing.length === 0, failing });
  } catch (e) {
    Sentry.captureException(e, { tags: { surface: "cron", path: "health" } });
    return NextResponse.json({ error: "health snapshot failed" }, { status: 500 });
  } finally {
    // Serverless: the check-in and messages must leave before the
    // function is frozen.
    await Sentry.flush(2000);
  }
}
