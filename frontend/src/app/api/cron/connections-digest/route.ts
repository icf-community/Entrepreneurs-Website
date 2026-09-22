import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { createServiceClient } from "@/lib/supabase/service";
import { enqueueEmailsBulk, renderConnectionDigestEmail } from "@/lib/email";
import { emailBaseUrl } from "@/lib/siteUrl";

// ════════════════════════════════════════════════════════════════════
// Foundry · The daily connection-request digest
//
// Invoked by pg_cron via pg_net — see cron_connection_digest in
// 20260917000004. Same shared-secret bearer auth and service-client shape
// as api/cron/drain-email and api/cron/github-showcase-nudge.
//
// This route does NOT send anything. It renders and hands rows to the
// existing outbound_email outbox, which owns delivery, retries and the
// provider's rate limits — which is why a launch-day digest burst can
// never stall a sign-in code.
//
// ─── EXACTLY-ONCE LIVES IN THE RPC, NOT HERE ────────────────────────
// claim_connection_digests stamps digested_at in the SAME statement that
// selects the rows, so two overlapping cron runs cannot both claim the
// same request: the loser matches zero rows and returns nothing. There is
// no time-window arithmetic in this file for that reason, and there must
// not be — a `where digested_at < today` check here would reintroduce
// exactly the double-send the claim was written to make impossible.
//
// The tradeoff is at-most-once: if this process dies between the claim
// and the enqueue, those rows are stamped and never mailed. Chosen
// deliberately. Digest mail leaves on the same sending domain as sign-in
// mail, where a spam complaint about a duplicate costs far more than a
// missed nudge.
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

// Recipients per run, not requests. A member with forty pending requests
// is one row here. pg_cron runs this daily; if a backlog ever exceeded
// one batch the next tick takes the rest, and nothing is lost because
// unclaimed rows stay unclaimed.
const BATCH_SIZE = 200;

type DigestRow = {
  member_id:     string;
  email:         string;
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

  const { data, error } = await supabase.rpc("claim_connection_digests", { p_limit: BATCH_SIZE });
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
    // waiting", which is worse than skipping the member.
    .filter((row) => row.pending_count > 0 && !!row.email)
    .map((row) => {
      const { subject, text, html } = renderConnectionDigestEmail({
        firstName: row.first_name,
        senderNames: row.sender_names ?? [],
        pendingCount: row.pending_count,
        appUrl,
      });
      return { to: row.email, subject, text, html };
    });

  if (emails.length === 0) return NextResponse.json({ digested: 0 });

  // If this throws, the rows are already claimed and those members get no
  // digest — the at-most-once tradeoff above, stated once more where it
  // actually happens. Alerted on rather than retried: a retry would need
  // to un-claim, and un-claiming is what reopens the double-send.
  try {
    await enqueueEmailsBulk(emails);
  } catch (e) {
    Sentry.captureException(e, {
      level: "error",
      tags: { surface: "cron", path: "connections-digest-enqueue" },
      extra: { claimed: rows.length, lost: emails.length },
    });
    return NextResponse.json({ error: "Enqueue failed" }, { status: 500 });
  }

  return NextResponse.json({ digested: emails.length });
}
