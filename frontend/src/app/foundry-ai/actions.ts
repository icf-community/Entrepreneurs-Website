"use server";

import * as Sentry from "@sentry/nextjs";
import { getActionAuth } from "@/lib/auth/actionAuth";
import { check } from "@/lib/ratelimit";
import { UNREACHABLE_MESSAGE } from "@/lib/supabase/unavailable";
import { err, ok, type Result } from "@/lib/result";
import { getConversation, jobRequirements, listConversations, resultCards } from "@/lib/ai/data";
import { outcomeMessage } from "@/lib/ai/outcomes";
import type {
  AiMode, Conversation, ConversationListItem, JobRequirements, ResultCard, Spec,
} from "@/lib/ai/types";

// ════════════════════════════════════════════════════════════════════
// Foundry AI — the browser's only way in (AI-plan §10).
//
// Server actions, so the framework's origin check applies and a cross-site
// page cannot spend a member's searches. Each one: a signed-in approved
// member, a rate-limit bucket, then ONE user-session RPC that does the real
// checks as that member (auth.uid()). The AI executor is never reachable
// from here or from the browser; it claims queued turns from Postgres.
// ════════════════════════════════════════════════════════════════════

const MODES = new Set<AiMode>(["recruiter", "network", "opportunities"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

async function member() {
  const auth = await getActionAuth();
  if (auth.unreachable) return err(UNREACHABLE_MESSAGE);
  if (!auth.user) return err("You must be signed in.");
  if (auth.status !== "approved") return err("Approved members only.");
  return ok({ supabase: auth.supabase, userId: auth.user.id });
}

export type SubmitInput = {
  mode: AiMode;
  conversationId: string | null;
  opportunityId: string | null;
  kind: "message" | "run" | "confirm" | "rescan";
  message: string | null;
  idempotencyKey: string;
  expectedRevision: number | null;
  temporary: boolean;
};

export type SubmitResult = { turnId: string; conversationId: string; duplicate: boolean };

export async function submitTurn(input: SubmitInput): Promise<Result<SubmitResult, { message: string; retryAt: string | null }>> {
  const m = await member();
  if (!m.ok) return err({ message: m.error, retryAt: null });
  const { supabase, userId } = m.data;

  // Cheap shape checks before anything else (§9.1 admission order).
  if (!MODES.has(input.mode) || !KEY.test(input.idempotencyKey)
      || (input.conversationId && !UUID.test(input.conversationId))
      || (input.opportunityId && !UUID.test(input.opportunityId))
      || !["message", "run", "confirm", "rescan"].includes(input.kind)
      || (input.message != null && (typeof input.message !== "string" || input.message.length > 600))) {
    return err({ message: outcomeMessage("invalid_message"), retryAt: null });
  }

  const decision = await check("aiSubmit", userId);
  if (decision === "limited") return err({ message: outcomeMessage("rate_minute"), retryAt: null });
  if (decision === "unavailable") return err({ message: outcomeMessage("unavailable"), retryAt: null });

  // The generated types mark these non-null; SQL takes null for "new
  // conversation", "no job", "no message" and "no revision yet".
  const { data, error } = await supabase.rpc("ai_submit_turn", {
    p_mode: input.mode,
    p_conversation: input.conversationId as string,
    p_opportunity: input.opportunityId as string,
    p_kind: input.kind,
    p_message: input.message as string,
    p_idempotency_key: input.idempotencyKey,
    p_expected_revision: input.expectedRevision as number,
    p_temporary: !!input.temporary,
  });
  if (error) {
    Sentry.captureException(error, { tags: { surface: "ai-submit" } });
    return err({ message: outcomeMessage("unavailable"), retryAt: null });
  }
  const row = data?.[0];
  if (!row) return err({ message: outcomeMessage(null), retryAt: null });
  if (row.outcome !== "queued" && row.outcome !== "duplicate") {
    return err({ message: outcomeMessage(row.outcome), retryAt: row.retry_at ?? null });
  }
  return { ok: true, data: { turnId: row.turn_id as string, conversationId: row.conversation_id as string, duplicate: row.outcome === "duplicate" } };
}

export async function loadConversation(id: string): Promise<Result<Conversation | null>> {
  const m = await member();
  if (!m.ok) return m;
  if (!UUID.test(id)) return ok(null);
  if ((await check("aiRead", m.data.userId)) === "limited") return err(outcomeMessage("limited"));
  try {
    return ok(await getConversation(m.data.supabase, id));
  } catch {
    return err(outcomeMessage("unavailable"));
  }
}

export async function loadConversations(mode: AiMode): Promise<Result<ConversationListItem[]>> {
  const m = await member();
  if (!m.ok) return m;
  if (!MODES.has(mode)) return ok([]);
  try {
    return ok(await listConversations(m.data.supabase, mode));
  } catch {
    return err(outcomeMessage("unavailable"));
  }
}

export async function loadResults(turnId: string): Promise<Result<ResultCard[]>> {
  const m = await member();
  if (!m.ok) return m;
  if (!UUID.test(turnId)) return ok([]);
  if ((await check("aiRead", m.data.userId)) === "limited") return err(outcomeMessage("limited"));
  try {
    return ok(await resultCards(m.data.supabase, turnId));
  } catch {
    return err("We couldn't load these results. Try again.");
  }
}

export type SpecOp =
  | { op: "remove"; atom: string }
  | { op: "set_required"; atom: string; required: boolean }
  | { op: "set_audience"; audience: ("students" | "graduates")[] }
  | { op: "set_transferable"; value: boolean }
  | { op: "add"; kind: string; concept: string; required: boolean }
  | { op: "undo" };

export async function editSpec(conversationId: string, expectedRevision: number, ops: SpecOp[]): Promise<Result<{ spec: Spec; revision: number }>> {
  const m = await member();
  if (!m.ok) return m;
  if (!UUID.test(conversationId) || !Array.isArray(ops) || ops.length === 0 || ops.length > 16) {
    return err("That change isn't valid.");
  }
  const decision = await check("aiEdit", m.data.userId);
  if (decision === "limited") return err(outcomeMessage("limited"));

  const { data, error } = await m.data.supabase.rpc("ai_edit_spec", {
    p_conversation: conversationId,
    p_expected_revision: expectedRevision,
    p_ops: ops as never,
  });
  if (error) {
    if (error.message.includes("stale_revision")) return err(outcomeMessage("stale_revision"));
    if (error.message.includes("busy")) return err(outcomeMessage("busy"));
    if (error.message.includes("edit_limit")) return err("You've made a lot of changes today. Try again tomorrow.");
    if (error.message.includes("too_many_criteria")) return err("Use at most 12 criteria.");
    return err("That change isn't valid.");
  }
  const row = data?.[0];
  return row ? ok({ spec: row.spec as unknown as Spec, revision: row.spec_revision }) : err(outcomeMessage(null));
}

export async function cancelTurn(turnId: string): Promise<Result> {
  const m = await member();
  if (!m.ok) return m;
  if (!UUID.test(turnId)) return ok();
  const { error } = await m.data.supabase.rpc("ai_cancel_turn", { p_turn: turnId });
  return error ? err(outcomeMessage("unavailable")) : ok();
}

export async function deleteConversation(id: string): Promise<Result> {
  const m = await member();
  if (!m.ok) return m;
  if (!UUID.test(id)) return ok();
  const { error } = await m.data.supabase.rpc("ai_delete_conversation", { p_conversation: id });
  return error ? err("We couldn't delete that conversation. Try again.") : ok();
}

export async function deleteAllAiHistory(): Promise<Result> {
  const m = await member();
  if (!m.ok) return m;
  const { error } = await m.data.supabase.rpc("ai_delete_all_history");
  return error ? err("We couldn't delete your AI history. Try again.") : ok();
}

export async function forgetMessage(id: string): Promise<Result> {
  const m = await member();
  if (!m.ok) return m;
  if (!UUID.test(id)) return ok();
  const { error } = await m.data.supabase.rpc("ai_forget_message", { p_message: id });
  return error ? err("We couldn't forget that message. Try again.") : ok();
}

export async function saveFindings(turnId: string): Promise<Result> {
  const m = await member();
  if (!m.ok) return m;
  if (!UUID.test(turnId)) return err("Those results are no longer available.");
  const { error } = await m.data.supabase.rpc("ai_save_findings", { p_turn: turnId });
  return error ? err("Those results are no longer available.") : ok();
}

export async function loadJobRequirements(opportunityId: string): Promise<Result<JobRequirements>> {
  const m = await member();
  if (!m.ok) return m;
  if (!UUID.test(opportunityId)) return ok(null);
  try {
    return ok(await jobRequirements(m.data.supabase, opportunityId));
  } catch {
    return err(outcomeMessage("unavailable"));
  }
}

export type ConfirmAtom = { id?: string; concept?: string; kind?: string; required: boolean };

export async function confirmRequirements(opportunityId: string, atoms: ConfirmAtom[]): Promise<Result> {
  const m = await member();
  if (!m.ok) return m;
  if (!UUID.test(opportunityId) || !Array.isArray(atoms) || atoms.length > 12) return err("That list isn't valid.");
  const decision = await check("aiEdit", m.data.userId);
  if (decision === "limited") return err(outcomeMessage("limited"));
  const { error } = await m.data.supabase.rpc("ai_confirm_job_requirements", {
    p_opportunity: opportunityId,
    p_atoms: atoms as never,
  });
  return error ? err("We couldn't save these requirements. Check them and try again.") : ok();
}
