"use server";

import { getActionAuth } from "@/lib/auth/actionAuth";
import { check } from "@/lib/ratelimit";
import { UNREACHABLE_MESSAGE } from "@/lib/supabase/unavailable";
import { err, ok, type Result } from "@/lib/result";
import { outcomeMessage } from "@/lib/ai/outcomes";

// S8 gap 20: "Search with AI" / "Find with AI" entry points from /members
// and /opportunities. The /foundry-ai link these pages build must never
// carry the filter values themselves (AI-plan.md "no criteria in URLs"),
// so the current filters are handed off through this opaque, single-use,
// owner-scoped reference instead — never the raw values in a query string.

export type DraftFilters = {
  role?: string[];
  course?: string[];
  sector?: string[];
  skill?: string[];
  gradMin?: string;
  gradMax?: string;
  q?: string;
};

async function member() {
  const auth = await getActionAuth();
  if (auth.unreachable) return err(UNREACHABLE_MESSAGE);
  if (!auth.user) return err("You must be signed in.");
  if (auth.status !== "approved") return err("Approved members only.");
  return ok({ supabase: auth.supabase, userId: auth.user.id });
}

export async function createAiDraftHandoff(
  mode: "network" | "opportunities",
  filters: DraftFilters,
): Promise<Result<{ id: string }>> {
  const m = await member();
  if (!m.ok) return m;
  const decision = await check("aiDraftHandoff", m.data.userId);
  if (decision === "limited") return err(outcomeMessage("limited"));
  const { data, error } = await m.data.supabase.rpc("ai_create_draft_handoff", {
    p_mode: mode,
    p_filters: filters as never,
  });
  return error || !data ? err("We couldn't open the AI search. Try again.") : ok({ id: data });
}

export async function consumeAiDraftHandoff(id: string): Promise<Result<DraftFilters | null>> {
  const m = await member();
  if (!m.ok) return m;
  const { data, error } = await m.data.supabase.rpc("ai_consume_draft_handoff", { p_id: id });
  return error ? ok(null) : ok((data as unknown as DraftFilters) ?? null);
}
