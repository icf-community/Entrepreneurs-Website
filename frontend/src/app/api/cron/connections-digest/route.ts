import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { createServiceClient } from "@/lib/supabase/service";
import { renderConnectionDigestEmail } from "@/lib/email";
import { emailBaseUrl } from "@/lib/siteUrl";

// ════════════════════════════════════════════════════════════════════
// Foundry · The daily connection-request digest
//
// Invoked by pg_cron via pg_net every 15 minutes across a morning window
// — see cron_connection_digest in 20260917000004 and the schedule in
// 20260917000016. Same shared-secret bearer auth and service-client
// shape as api/cron/drain-email and api/cron/github-showcase-nudge.
//
// This route does NOT send anything. It renders, and the complete RPC
// hands rows to the existing outbound_email outbox, which owns delivery,
// retries and the provider's rate limits. Volume is bounded by
// connection_limits->digest_daily_cap, because digest mail and sign-in
// codes can share one sending allowance.
//
// ─── EXACTLY-ONCE LIVES IN THE TWO RPCs, NOT HERE ───────────────────
// claim_connection_digests reserves recipients under a claim id and a
// 10-minute lease; it does NOT mark anything digested. The complete RPC
// then stamps digested_at AND inserts the mail in one transaction.
//
// So if this process dies anywhere in between, nothing was stamped and
// nothing was queued: the lease lapses and a later run in the window
// re-claims under a new id. A stale completer matches zero rows. There
// is no time-window arithmetic in this file and there must not be —
// spacing (digest_min_hours) and the budget are enforced in SQL, under
// the claim's advisory lock, where two overlapping runs cannot race.
//
// ─── NO NOTE TEXT, EVER ─────────────────────────────────────────────
// The RPC returns names and counts only. That is not an oversight to be
// helpfully corrected here: the note is attacker-controlled text and this
// builds HTML, and not carrying it removes the injection surface rather
// than trusting an escape to stay correct forever. It also stops an
// abusive note reaching an inbox belonging to somebody who would never
// have opened the app — in Foundry that note sits next to a Block
// control and a Report control, and in an inbox it sits next to nothing.
// ════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// RECIPIENTS per run, each with ALL their waiting requests. Sixteen runs
// a morning makes the ceiling 800/day; digest_daily_cap is the real
// bound. 50 also fits inside what the drain sends between two runs.
const RECIPIENTS_PER_RUN = 50;

type DigestRow = {
  claim_id:      string;
  member_id:     string;
  first_name:    string | null;
  pending_count: number;
  sender_names:  string[] | null;
};

export async function POST(req: NextRequest) { return digest(req); }
// GET makes manual testing from cURL easier without changing the auth
// surface — the bearer check still applies.
export async function GET(req: NextRequest)  { return digest(req); }

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

async function digest(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    Sentry.captureMessage("connections-digest: CRON_SECRET is not configured", {
      level: "error", tags: { surface: "cron", path: "connections-digest" },
    });
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc("claim_connection_digests", { p_limit: RECIPIENTS_PER_RUN });
  if (error) {
    Sentry.captureException(error, {
      level: "error", tags: { surface: "cron", path: "connections-digest-claim" },
    });
    return NextResponse.json({ error: `Claim failed: ${error.message}` }, { status: 500 });
  }

  const rows = (data ?? []) as DigestRow[];
  if (rows.length === 0) return NextResponse.json({ digested: 0 });

  const appUrl = emailBaseUrl();
  const emails = rows
    // Defensive: the RPC groups by recipient so a row always has at least
    // one claimed request, but a zero here would render "0 requests are
    // waiting", which is worse than skipping the member. A skipped member
    // keeps their lease until it lapses and is simply re-claimed later.
    .filter((row) => row.pending_count > 0)
    .map((row) => {
      const { subject, text, html } = renderConnectionDigestEmail({
        firstName: row.first_name,
        senderNames: row.sender_names ?? [],
        pendingCount: row.pending_count,
        appUrl,
      });
      return { member_id: row.member_id, subject, text, html };
    });

  if (emails.length === 0) return NextResponse.json({ digested: 0 });

  // One claim id per run: the RPC generates it once and repeats it on
  // every row.
  const { data: queued, error: completeError } = await supabase.rpc("complete_connection_digests", {
    p_claim_id: rows[0]!.claim_id,
    p_emails: emails,
  });
  if (completeError) {
    // Nothing was stamped or queued — the transaction rolled back whole.
    // The lease lapses and a later run retries these members.
    Sentry.captureException(completeError, {
      level: "error",
      tags: { surface: "cron", path: "connections-digest-complete" },
      extra: { claimed: rows.length },
    });
    return NextResponse.json({ error: "Complete failed" }, { status: 500 });
  }

  return NextResponse.json({ digested: queued ?? 0 });
}
