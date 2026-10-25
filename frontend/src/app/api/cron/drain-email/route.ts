import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { Resend } from "resend";
import { timingSafeEqual } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { createServiceClient } from "@/lib/supabase/service";
import { errorSummary } from "@/lib/errorSummary";

// ════════════════════════════════════════════════════════════════════
// Foundry · Outbound email drain
//
// Invoked by pg_cron every 5 minutes via pg_net. Claims up to
// BATCH_SIZE pending rows from outbound_email, sends each via Resend
// at a controlled pace (~1.5 req/sec, well under Resend's 2 req/sec
// free-tier cap), and records success or failure per row.
//
// Auth: shared-secret bearer token in Authorization header. The
// pg_cron driver pulls the secret from public.app_config and we
// compare it against the CRON_SECRET env var here.
//
// Concurrency: rows are claimed via SECURITY DEFINER RPC with
// `FOR UPDATE SKIP LOCKED`, and `next_attempt_at` is pushed 10 min
// into the future so a manually-triggered second invocation skips
// rows in flight.
//
// Failure handling per row:
//   * 2xx              → sent_at = now()
//   * 429              → push next_attempt_at +30 min; don't burn an attempt.
//                        Resend returns 429 for both per-second rate limits
//                        AND daily-quota-exceeded, so this is also our daily
//                        cap: once the quota is hit, rows defer (not fail) and
//                        flush automatically when the window resets.
//   * 5xx / network    → bump attempts; exponential backoff (2^n min)
//   * 4xx (not 429)    → bury (attempts := max_attempts)
// ════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Vercel Hobby allows up to 60s. A full batch should finish in ~15s.
export const maxDuration = 60;

const BATCH_SIZE = 20;
const PER_SEND_GAP_MS = 600;       // 1.5 req/sec, under Resend's 2/sec
const BACKOFF_429_MIN = 30;        // Wait at least 30 min after a rate-limit
// No default From address. `RESEND_FROM` is required config, not a
// preference: Resend only accepts onboarding@resend.dev for mail to the
// account owner's own inbox, so falling back to it does not degrade the
// drain — it makes every send to every member fail, one 4xx at a time,
// with the rows buried at max_attempts and nothing saying why. Failing
// the whole batch loudly is the shorter path to the same diagnosis, and
// it matches the rule the rest of the codebase follows: never
// `process.env.X ?? "literal"` for required config.

type ClaimedRow = {
  id:           string;
  to_address:   string;
  subject:      string;
  text_body:    string;
  html_body:    string;
  reply_to:     string | null;
  attempts:     number;
  max_attempts: number;
};

export async function POST(req: NextRequest) { return drain(req); }
// GET makes manual testing from a browser/cURL easier without changing
// the auth surface — the bearer check still applies.
export async function GET(req: NextRequest)  { return drain(req); }

async function drain(req: NextRequest): Promise<NextResponse> {
  // ─── Auth ──────────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    Sentry.captureMessage("drain-email: CRON_SECRET is not configured", {
      level: "error", tags: { surface: "cron", path: "drain-email" },
    });
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  // Constant-time compare to avoid timing side channels on the secret.
  if (!safeEqual(auth, expected)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ─── Env preflight ─────────────────────────────────────────────────
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    Sentry.captureMessage("drain-email: RESEND_API_KEY is not configured", {
      level: "error", tags: { surface: "cron", path: "drain-email" },
    });
    return NextResponse.json(
      { error: "RESEND_API_KEY is not configured" },
      { status: 500 },
    );
  }
  const fromAddress = process.env.RESEND_FROM;
  if (!fromAddress) {
    Sentry.captureMessage("drain-email: RESEND_FROM is not configured", {
      level: "error", tags: { surface: "cron", path: "drain-email" },
    });
    return NextResponse.json(
      { error: "RESEND_FROM is not configured" },
      { status: 500 },
    );
  }
  const resend = new Resend(resendKey);
  const supabase = createServiceClient();

  // ─── Claim a batch ─────────────────────────────────────────────────
  const { data: claimed, error: claimErr } = await supabase
    .rpc("claim_outbound_email_batch", { p_limit: BATCH_SIZE });
  if (claimErr) {
    Sentry.captureException(claimErr, {
      level: "error", tags: { surface: "cron", path: "drain-email-claim" },
    });
    return NextResponse.json(
      { error: "Claim failed", detail: errorSummary(claimErr) },
      { status: 500 },
    );
  }
  const rows = (claimed ?? []) as ClaimedRow[];
  if (rows.length === 0) {
    return NextResponse.json({ drained: 0, succeeded: 0, failed: 0 });
  }

  // ─── Send each ─────────────────────────────────────────────────────
  let succeeded = 0;
  let permanentFailed = 0;
  let transientFailed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const result = await sendOne(resend, fromAddress, row);
    await recordResult(supabase, row, result);

    switch (result.kind) {
      case "sent":       succeeded++; break;
      case "permanent":  permanentFailed++; break;
      case "transient":
      case "rate_limited":
        transientFailed++; break;
    }

    // Pace ourselves to stay under Resend's per-second limit. Skip
    // the gap after the last row.
    if (i < rows.length - 1) {
      await sleep(PER_SEND_GAP_MS);
    }
  }

  return NextResponse.json({
    drained:           rows.length,
    succeeded,
    permanent_failed:  permanentFailed,
    transient_failed:  transientFailed,
  });
}

// ─── Internals ────────────────────────────────────────────────────────
type SendOutcome =
  | { kind: "sent"; messageId: string | null }
  | { kind: "rate_limited"; error: string }
  | { kind: "transient"; error: string }
  | { kind: "permanent"; error: string };

// Resend's SDK exposes no signal/timeout option (checked its PostOptions
// type), unlike every other external call in the codebase. A manual race
// can't cancel the underlying request, but it does stop one hung send from
// eating the whole batch's share of the route's maxDuration — the idempotency
// key below makes the eventual real response harmless to ignore.
const SEND_TIMEOUT_MS = 15_000;

async function sendOne(
  resend: Resend,
  fromAddress: string,
  row: ClaimedRow,
): Promise<SendOutcome> {
  try {
    // idempotencyKey pinned to the row's own id: if the process is killed
    // after Resend accepts the send but before recordResult() writes
    // sent_at, the row's lock eventually expires and becomes claimable
    // again. Without this, that re-claim resends a message that already
    // reached the recipient — Resend dedupes any repeat request carrying
    // the same key instead.
    const { data, error } = await Promise.race([
      resend.emails.send({
        from:    fromAddress,
        to:      row.to_address,
        subject: row.subject,
        text:    row.text_body,
        html:    row.html_body,
        ...(row.reply_to ? { replyTo: row.reply_to } : {}),
      }, { idempotencyKey: row.id }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Resend send timed out")), SEND_TIMEOUT_MS)),
    ]);
    if (!error) {
      return { kind: "sent", messageId: data?.id ?? null };
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    const message    = (error as { message?: string }).message ?? String(error);
    const display    = `${statusCode ?? "?"}: ${message}`;

    if (statusCode === 429) return { kind: "rate_limited", error: display };
    if (typeof statusCode === "number" && statusCode >= 500) {
      return { kind: "transient", error: display };
    }
    if (typeof statusCode === "number" && statusCode >= 400) {
      return { kind: "permanent", error: display };
    }
    // Unknown shape — treat as transient so we retry.
    return { kind: "transient", error: display };
  } catch (e) {
    // Network / SDK exception — transient.
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: "transient", error: `network: ${msg}` };
  }
}

async function recordResult(
  supabase: ReturnType<typeof createServiceClient>,
  row: ClaimedRow,
  result: SendOutcome,
): Promise<void> {
  const nowIso = new Date().toISOString();

  if (result.kind === "sent") {
    await supabase
      .from("outbound_email")
      .update({
        sent_at:             nowIso,
        provider_message_id: result.messageId,
        last_error:          null,
      })
      .eq("id", row.id);
    return;
  }

  if (result.kind === "rate_limited") {
    // Don't burn an attempt — this is a "come back later" signal, not
    // a bad row. Push next_attempt_at well past the cron interval.
    await supabase
      .from("outbound_email")
      .update({
        next_attempt_at: minutesFromNowIso(BACKOFF_429_MIN),
        last_error:      result.error,
      })
      .eq("id", row.id);
    return;
  }

  if (result.kind === "permanent") {
    // Bury — admin can inspect via admin_outbound_email_stats.
    await supabase
      .from("outbound_email")
      .update({
        attempts:        row.max_attempts,
        next_attempt_at: nowIso,
        last_error:      result.error,
      })
      .eq("id", row.id);
    return;
  }

  // transient: bump attempts, exponential backoff.
  const newAttempts = row.attempts + 1;
  const backoffMin  = Math.min(2 ** newAttempts, 120); // cap at 2h
  await supabase
    .from("outbound_email")
    .update({
      attempts:        newAttempts,
      next_attempt_at: minutesFromNowIso(backoffMin),
      last_error:      result.error,
    })
    .eq("id", row.id);
}

function minutesFromNowIso(min: number): string {
  return new Date(Date.now() + min * 60_000).toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
