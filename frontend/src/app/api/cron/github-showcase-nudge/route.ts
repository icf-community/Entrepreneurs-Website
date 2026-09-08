import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { createServiceClient } from "@/lib/supabase/service";
import { enqueueEmailsBulk, renderShowcaseNudgeEmail } from "@/lib/email";
import { emailBaseUrl } from "@/lib/siteUrl";

// ════════════════════════════════════════════════════════════════════
// Foundry · GitHub showcase nudge
//
// Invoked by pg_cron weekly (Monday 09:30) via pg_net — see
// cron_github_showcase_nudge in 20260907000004_github_showcase.sql. Same
// shared-secret bearer auth and service-client shape as
// api/cron/drain-email.
//
// This route does NOT send anything. It renders and hands rows to the
// existing outbound_email outbox, which owns delivery, retries, and the
// provider's rate limits. That separation is why a nudge batch can never
// stall a rejection notice or a contact ticket.
//
// Two throttles, both server-side, neither of them here:
//   * due_github_showcase_nudges only returns a member whose scan found a
//     repo they have NEVER been shown (a name-set diff, not a timer), and
//     only if 30 days have passed since their last nudge.
//   * BATCH_SIZE caps a single run, so lifecycle mail can never crowd out
//     transactional mail in the shared outbox.
//
// Marking happens after ENQUEUE, not after send: the outbox owns
// delivery from that point, and a member who was queued but whose send
// later failed should not be re-nudged on the next tick as though
// nothing had happened.
// ════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_SIZE = 50;

type DueRow = {
  member_id:  string;
  email:      string;
  first_name: string | null;
  new_repos:  string[] | null;
};

export async function POST(req: NextRequest) { return nudge(req); }
// GET makes manual testing from cURL easier without changing the auth
// surface — the bearer check still applies.
export async function GET(req: NextRequest)  { return nudge(req); }

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

async function nudge(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    Sentry.captureMessage("github-showcase-nudge: CRON_SECRET is not configured", {
      level: "error", tags: { surface: "cron", path: "github-showcase-nudge" },
    });
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc("due_github_showcase_nudges", { p_limit: BATCH_SIZE });
  if (error) {
    Sentry.captureException(error, {
      level: "error", tags: { surface: "cron", path: "github-showcase-nudge-due" },
    });
    return NextResponse.json({ error: `Lookup failed: ${error.message}` }, { status: 500 });
  }

  const rows = (data ?? []) as DueRow[];
  if (rows.length === 0) return NextResponse.json({ nudged: 0 });

  const appUrl = `${emailBaseUrl()}/profile`;
  const emails = rows
    // Defensive: due_github_showcase_nudges already guarantees at least
    // one new repo, but an empty list would render an email that says
    // nothing, which is worse than skipping the member this week.
    .filter((row) => (row.new_repos?.length ?? 0) > 0)
    .map((row) => {
      const { subject, text, html } = renderShowcaseNudgeEmail({
        firstName: row.first_name,
        newRepoNames: row.new_repos ?? [],
        appUrl,
      });
      return { to: row.email, subject, text, html };
    });

  if (emails.length === 0) return NextResponse.json({ nudged: 0 });

  await enqueueEmailsBulk(emails);

  const { error: markError } = await supabase.rpc("mark_github_showcase_nudged", {
    p_member_ids: rows.map((row) => row.member_id),
  });
  if (markError) {
    // The mail is already queued. Failing to mark means these members
    // could be nudged again next week — worth alerting on, but not worth
    // failing the run over.
    Sentry.captureException(markError, {
      level: "error", tags: { surface: "cron", path: "github-showcase-nudge-mark" },
    });
  }

  return NextResponse.json({ nudged: emails.length });
}
