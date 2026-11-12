import "server-only";
import { revalidatePath } from "next/cache";
import { invalidate, type CacheKey } from "@/lib/cache";
import { enqueueEmailsBulk } from "@/lib/email";
import type { BulkResult } from "@/app/admin/bulkTypes";

/** What a per-item RPC gives back so the batch can email whoever it affected. */
export type BulkRecipient = { email: string; first_name: string | null };

type RenderedEmail = { subject: string; text: string; html: string };

/**
 * Runs a per-item admin RPC across a selection, then does the shared
 * follow-up work ONCE for the whole batch.
 *
 * This used to call the single-item action per id, and each of those
 * re-authenticated (getUser + is_admin + a profiles select), enqueued its
 * own email, dropped the cache keys and revalidated both paths — roughly
 * six round trips per item, sequential, in no transaction. Clearing a
 * fifty-item backlog was three hundred round trips and would hit the
 * function timeout part-way through, leaving some items handled and some
 * not, with the admin shown nothing at all.
 *
 * Now: the caller authenticates once, one RPC per item, one bulk email
 * insert, one cache drop, one revalidate per path. Per-item results are
 * still collected, so a partial batch is reported rather than guessed at.
 *
 * Sequential on purpose: each item hits a SECURITY DEFINER RPC, so firing
 * them in parallel would multiply database load for no user-visible gain
 * on a selection this size. A failure doesn't abort the rest — a bad row
 * shouldn't strand the ones behind it in the queue.
 */
export async function runBulk<R extends BulkRecipient>(
  ids: string[],
  opts: {
    /** The per-item RPC. Returns whoever to notify, or an error to collect. */
    one: (id: string) => Promise<{ recipient: R | null; error?: string }>;
    /** Omit for actions that notify nobody (approvals of listings). */
    email?: { render: (r: R) => RenderedEmail; replyTo: string };
    cacheKeys: readonly CacheKey[];
    revalidate: readonly string[];
  },
): Promise<BulkResult> {
  let succeeded = 0;
  const errors: string[] = [];
  const recipients: R[] = [];

  for (const id of ids) {
    // react-doctor-disable-next-line async-await-in-loop -- sequential by necessity (see loop body); not a candidate for Promise.all
    const r = await opts.one(id);
    if (r.error) {
      errors.push(r.error);
      continue;
    }
    succeeded++;
    if (r.recipient?.email) recipients.push(r.recipient);
  }

  if (opts.email && recipients.length > 0) {
    const { render, replyTo } = opts.email;
    try {
      await enqueueEmailsBulk(
        recipients.map((r) => ({ to: r.email, replyTo, ...render(r) })),
      );
    } catch (e) {
      // The state changes are committed. Say so rather than reporting a
      // clean success the admin would read as "they've all been told".
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`Applied to ${succeeded}, but the notification emails failed to queue: ${msg}`);
    }
  }

  // Whatever these writes made stale, dropped once rather than per item.
  // Cache first, then Next's path revalidation: a re-render triggered by
  // revalidatePath must not read the stale entry and put it straight back.
  if (opts.cacheKeys.length > 0) await invalidate(...opts.cacheKeys);
  for (const path of opts.revalidate) revalidatePath(path);

  return { ok: true, succeeded, failed: errors.length, firstError: errors[0] };
}
