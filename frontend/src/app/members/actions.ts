"use server";

import { getActionAuth } from "@/lib/auth/actionAuth";
import { memberCard } from "@/lib/data/directory";
import type { DirectoryMember } from "@/lib/data/directory";
import { UNREACHABLE_MESSAGE } from "@/lib/supabase/unavailable";
import { err, ok, type Result } from "@/lib/result";

/**
 * The card MemberDialog needs, for a member reached from somewhere other
 * than the directory list ("Posted by", AI results). Connect stays inside
 * the dialog, one control per open dialog (F16).
 */
export async function getMemberCard(id: string): Promise<Result<DirectoryMember>> {
  const { supabase, user, status, isAdmin, unreachable } = await getActionAuth();
  if (unreachable) return err(UNREACHABLE_MESSAGE);
  if (!user) return err("You must be signed in.");
  if (status !== "approved" && !isAdmin) return err("Approved members only.");
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return err("That profile isn't available.");
  try {
    const card = await memberCard(supabase, id);
    return card ? ok(card) : err("That profile isn't available.");
  } catch {
    return err("We couldn't load that profile. Please try again.");
  }
}
