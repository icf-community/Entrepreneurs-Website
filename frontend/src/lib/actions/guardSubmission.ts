import "server-only";
import { getActionAuth } from "@/lib/auth/actionAuth";
import { UNREACHABLE_MESSAGE } from "@/lib/supabase/unavailable";
import * as Sentry from "@sentry/nextjs";
import { check } from "@/lib/ratelimit";
import { verifyTurnstile } from "@/lib/turnstile";
import { ok, err, type Result } from "@/lib/result";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.overrides";

export type SubmissionMode = "user" | "admin";

// The gate every listing submission passes through, in the order it has to
// happen: identity, then authorisation for the mode, then the abuse
// controls — which are skipped in admin mode, since an admin publishing
// directly is not the traffic those exist to shape.
//
// This preamble was copied verbatim into submitOpportunity, submitEvent
// and submitVcGrant, differing only in the noun in the first message. A
// check added to one of three copies is a check that isn't enforced, which
// is the whole reason it's here.
//
// The SECURITY DEFINER RPCs behind these actions re-check the caller
// regardless; this layer exists to fail early with a message worth showing.
export async function guardSubmission(args: {
  mode: SubmissionMode;
  /** Completes "You must be signed in to post …". */
  noun: string;
  turnstileToken?: string;
}): Promise<Result<{ supabase: SupabaseClient<Database>; user: User }>> {
  const { user, isAdmin, status, supabase, unreachable } = await getActionAuth();

  if (unreachable) return err(UNREACHABLE_MESSAGE);
  if (!user) return err(`You must be signed in to post ${args.noun}.`);
  if (args.mode === "admin" && !isAdmin) return err("Admin access required.");
  if (args.mode === "user" && !isAdmin && status !== "approved") {
    return err("Your membership must be approved before you can post.");
  }

  if (args.mode === "user") {
    if (!(await verifyTurnstile(args.turnstileToken))) {
      return err("Verification failed. Please complete the challenge and try again.");
    }
    const decision = await check("submit", user.id);
    if (decision === "limited") {
      return err("You're posting too frequently. Please try again later.");
    }
    if (decision === "unavailable") {
      // The `submit` bucket fails closed, so this refusal is real — but it is
      // an outage, not the member's doing. Saying "too frequently" here would
      // blame them for it and leave nobody looking at the limiter. On the free
      // Upstash tier the response cache shares this database's command quota,
      // which makes "quota spent" one of the ways to arrive here.
      Sentry.captureMessage(
        "submit rate-limit bucket unreachable — submissions are being refused (fail-closed)",
        { level: "error", tags: { bucket: "submit", surface: "guardSubmission" } },
      );
      return err("We can't accept submissions right now. Please try again in a few minutes.");
    }
  }

  return ok({ supabase, user });
}
