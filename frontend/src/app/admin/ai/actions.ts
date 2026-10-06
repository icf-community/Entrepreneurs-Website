"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/actionAuth";
import { err, ok, type Result } from "@/lib/result";

// AI operations (AI-plan §10.1). Every RPC behind these checks the caller
// in its own body: is_admin() to read, is_ai_operator() to change anything,
// and each change is written to admin_actions with its reason.

const FLAGS = new Set(["ai_enabled", "ai_recruiter_enabled", "ai_network_enabled", "ai_opportunities_enabled"]);

export async function setAiFlag(key: string, enabled: boolean, reason: string): Promise<Result> {
  const guard = await requireAdmin();
  if (!guard.ok) return err(guard.error);
  if (!FLAGS.has(key) || typeof enabled !== "boolean") return err("That switch isn't valid.");
  if (typeof reason !== "string" || reason.trim().length < 3 || reason.length > 300) {
    return err("Give a reason (3–300 characters).");
  }
  const { error } = await guard.supabase.rpc("admin_set_ai_flag", { p_key: key, p_enabled: enabled, p_reason: reason.trim() });
  if (error) return err(error.message.includes("operators") ? "Only AI operators can change this." : "We couldn't change that.");
  revalidatePath("/admin/ai");
  return ok();
}

export async function setAiLimits(
  activeTurnCeiling: number, matchingDailyCapMicro: number, memberDailyCapMicro: number, reason: string,
): Promise<Result> {
  const guard = await requireAdmin();
  if (!guard.ok) return err(guard.error);
  const ints = [activeTurnCeiling, matchingDailyCapMicro, memberDailyCapMicro];
  if (ints.some((n) => !Number.isInteger(n) || n < 0)) return err("Use whole numbers.");
  if (typeof reason !== "string" || reason.trim().length < 3 || reason.length > 300) {
    return err("Give a reason (3–300 characters).");
  }
  const { error } = await guard.supabase.rpc("admin_set_ai_limits", {
    p_active_turn_ceiling: activeTurnCeiling,
    p_matching_daily_cap_micro: matchingDailyCapMicro,
    p_member_daily_cap_micro: memberDailyCapMicro,
    p_reason: reason.trim(),
  });
  if (error) {
    if (error.message.includes("operators")) return err("Only AI operators can change this.");
    if (error.message.includes("25%")) return err("Raise the ceiling in steps of at most 25%.");
    return err("We couldn't change the limits. Check the values and try again.");
  }
  revalidatePath("/admin/ai");
  return ok();
}

export async function rebuildAiIndex(): Promise<Result<number>> {
  const guard = await requireAdmin();
  if (!guard.ok) return err(guard.error);
  const { data, error } = await guard.supabase.rpc("admin_ai_rebuild_index");
  if (error) return err(error.message.includes("operators") ? "Only AI operators can do this." : "We couldn't queue the rebuild.");
  revalidatePath("/admin/ai");
  return ok(data ?? 0);
}

export async function setOpportunityAudience(id: string, audience: string): Promise<Result> {
  const guard = await requireAdmin();
  if (!guard.ok) return err(guard.error);
  if (!["students", "graduates", "both"].includes(audience)) return err("Choose students, graduates or both.");
  const { error } = await guard.supabase.rpc("admin_set_opportunity_audience", { p_id: id, p_audience: audience });
  if (error) return err("We couldn't set the audience. Try again.");
  revalidatePath("/admin/ai");
  revalidatePath("/opportunities");
  return ok();
}
