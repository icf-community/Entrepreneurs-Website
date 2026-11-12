import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { createServiceClient } from "@/lib/supabase/service";
import { errorSummary } from "@/lib/errorSummary";

// ════════════════════════════════════════════════════════════════════
// Foundry · Blob deletion drain
//
// Invoked by pg_cron every 5 minutes via pg_net. Claims a batch from
// blob_deletion_queue and asks the upload gateway to delete each key
// from Azure Blob Storage.
//
// This route exists because Postgres cannot talk to Azure and, more to
// the point, must not be able to: delete permission on the container is
// held by exactly one identity — the gateway VM's managed identity — and
// nothing else in the system can destroy an image. The queue is how a
// deletion inside a Postgres transaction reaches that identity.
//
// WHY THIS IS A COMPLIANCE PATH, NOT HOUSEKEEPING.
// Rows land in the queue from a trigger on post_images (author delete,
// admin takedown, 7-day expiry, ban, account deletion) AND from
// profiles_enqueue_media_deletion (20260901000002: an avatar or CV
// replaced or removed, or the whole profile deleted). If this drain
// stops, bytes for content we have told a member is deleted stay in
// whichever container they were written to. The lifecycle rule on the
// account is a 30-day backstop, not a substitute — see
// infra/azure/provision.sh, which now runs it across all three
// containers.
//
// Failure handling per key:
//   * 2xx or 404       → deleted_at = now(). See NOTE below on 404.
//   * 5xx / network    → bump attempts; exponential backoff (2^n min)
//   * other 4xx        → bury (attempts := max_attempts) for inspection
// ════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Vercel Hobby allows up to 60s. Blob deletes are fast; the batch size is
// what keeps a backlog inside the budget rather than timing out on it.
export const maxDuration = 60;

// Sized against the rate-limit ceiling, not expected traffic, because the
// consequence of under-sizing is a compliance one rather than a cost one:
// a drain that cannot keep up leaves images of deleted posts in the
// container, and the 30-day lifecycle rule that would eventually collect
// them is far longer than the 7 days the privacy page promises.
//
// Ceiling: 2,000 members x 10 posts x 2 images = 40,000 images/day created,
// all of which expire seven days later, so ~1,700 deletions an hour in the
// steady state. At 12 runs an hour this batch drains 2,400 — clear of it
// with margin. 40 waves of 5 finish in a few seconds, well inside the 60s
// budget, so the headroom is close to free.
const BATCH_SIZE = 200;
const CONCURRENCY = 5;

type ClaimedRow = {
  id: string;
  blob_key: string;
  container: string;
  attempts: number;
  max_attempts: number;
};

export async function POST(req: NextRequest) { return drain(req); }
// GET makes manual testing from a browser/cURL easier without changing
// the auth surface — the bearer check still applies.
export async function GET(req: NextRequest) { return drain(req); }

async function drain(req: NextRequest): Promise<NextResponse> {
  // ─── Auth ──────────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    Sentry.captureMessage("drain-blob-deletions: CRON_SECRET is not configured", {
      level: "error", tags: { surface: "cron", path: "drain-blob-deletions" },
    });
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  // Constant-time compare to avoid timing side channels on the secret.
  if (!safeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ─── Env preflight ─────────────────────────────────────────────────
  // No fallbacks. A drain that silently no-ops because config is missing
  // is worse than one that fails loudly: the queue would grow, the bytes
  // would stay, and nothing would say so.
  const gateway = process.env.UPLOAD_GATEWAY_URL;
  if (!gateway) {
    Sentry.captureMessage("drain-blob-deletions: UPLOAD_GATEWAY_URL is not configured", {
      level: "error", tags: { surface: "cron", path: "drain-blob-deletions" },
    });
    return NextResponse.json({ error: "UPLOAD_GATEWAY_URL is not configured" }, { status: 500 });
  }
  const serviceToken = process.env.GATEWAY_SERVICE_TOKEN;
  if (!serviceToken) {
    Sentry.captureMessage("drain-blob-deletions: GATEWAY_SERVICE_TOKEN is not configured", {
      level: "error", tags: { surface: "cron", path: "drain-blob-deletions" },
    });
    return NextResponse.json({ error: "GATEWAY_SERVICE_TOKEN is not configured" }, { status: 500 });
  }

  const supabase = createServiceClient();

  // ─── Claim a batch ─────────────────────────────────────────────────
  const { data: claimed, error: claimErr } = await supabase
    .rpc("claim_blob_deletion_batch", { p_limit: BATCH_SIZE });
  if (claimErr) {
    Sentry.captureException(claimErr, {
      level: "error", tags: { surface: "cron", path: "drain-blob-deletions-claim" },
    });
    return NextResponse.json({ error: "Claim failed", detail: errorSummary(claimErr) }, { status: 500 });
  }
  const rows = (claimed ?? []) as ClaimedRow[];
  if (rows.length === 0) {
    return NextResponse.json({ drained: 0, succeeded: 0, failed: 0 });
  }

  // ─── Delete each ───────────────────────────────────────────────────
  // Small fixed concurrency: enough that a full batch finishes well inside
  // maxDuration, low enough not to look like a burst to the single gateway
  // process on the other end.
  let succeeded = 0;
  let permanentFailed = 0;
  let transientFailed = 0;

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const slice = rows.slice(i, i + CONCURRENCY);
    const outcomes = await Promise.all(
      slice.map((row) => deleteOne(gateway.replace(/\/$/, ""), serviceToken, row)),
    );

    await Promise.all(slice.map((row, n) => recordResult(supabase, row, outcomes[n])));

    for (const outcome of outcomes) {
      if (outcome.kind === "deleted") succeeded++;
      else if (outcome.kind === "permanent") permanentFailed++;
      else transientFailed++;
    }
  }

  return NextResponse.json({
    drained: rows.length,
    succeeded,
    permanent_failed: permanentFailed,
    transient_failed: transientFailed,
  });
}

// ─── Internals ──────────────────────────────────────────────────────
type DeleteOutcome =
  | { kind: "deleted" }
  | { kind: "transient"; error: string }
  | { kind: "permanent"; error: string };

async function deleteOne(
  gateway: string,
  serviceToken: string,
  row: ClaimedRow,
): Promise<DeleteOutcome> {
  try {
    // react-doctor-disable-next-line react-doctor/no-fetch-response-used-without-status-check -- status is checked (res.ok || res.status === 404) below before any body is read
    const res = await fetch(`${gateway}/v1/blobs/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify({ items: [{ key: row.blob_key, container: row.container }] }),
      // The gateway is a single small process; a hung request must not eat
      // the whole function budget.
      signal: AbortSignal.timeout(10_000),
    });

    // NOTE: 404 IS SUCCESS. A key can legitimately be absent — the batch
    // was retried after a partial success, the account lifecycle rule
    // collected it first, or the upload never completed. Treating "already
    // gone" as a failure would retry the row to max_attempts and leave the
    // queue looking broken while the bytes are, in fact, destroyed.
    if (res.ok || res.status === 404) return { kind: "deleted" };

    const body = await res.text().catch(() => "");
    const display = `${res.status}: ${body.slice(0, 200)}`;

    if (res.status >= 500) return { kind: "transient", error: display };
    return { kind: "permanent", error: display };
  } catch (e) {
    // Network, DNS, timeout, gateway restarting — all worth retrying.
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: "transient", error: `network: ${msg}` };
  }
}

async function recordResult(
  supabase: ReturnType<typeof createServiceClient>,
  row: ClaimedRow,
  result: DeleteOutcome,
): Promise<void> {
  const nowIso = new Date().toISOString();

  if (result.kind === "deleted") {
    await supabase
      .from("blob_deletion_queue")
      .update({ deleted_at: nowIso, last_error: null })
      .eq("id", row.id);
    return;
  }

  if (result.kind === "permanent") {
    // Buried rather than deleted. A key we could not destroy is exactly
    // the thing someone should be able to find later, because it means
    // bytes survive that a member was told were gone.
    await supabase
      .from("blob_deletion_queue")
      .update({
        attempts: row.max_attempts,
        next_attempt_at: nowIso,
        last_error: result.error,
      })
      .eq("id", row.id);
    return;
  }

  const newAttempts = row.attempts + 1;
  const backoffMin = Math.min(2 ** newAttempts, 120); // cap at 2h
  await supabase
    .from("blob_deletion_queue")
    .update({
      attempts: newAttempts,
      next_attempt_at: new Date(Date.now() + backoffMin * 60_000).toISOString(),
      last_error: result.error,
    })
    .eq("id", row.id);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
