"use server";

import { revalidatePath } from "next/cache";
import { getActionAuth } from "@/lib/auth/actionAuth";
import { UNREACHABLE_MESSAGE } from "@/lib/supabase/unavailable";
import { err, ok, type Result } from "@/lib/result";
import { invalidate } from "@/lib/cache";

/**
 * The member's own answer to the graduation prompt (20261011000005).
 * Graduated → recent graduate, education updated; not yet → a new
 * expected year. The database checks that the caller is an approved
 * student and that the year is sensible.
 */
export async function confirmGraduation(
  graduated: boolean,
  stillEnrolled: boolean,
  newGradYear: number | null,
): Promise<Result> {
  const { supabase, user, unreachable } = await getActionAuth();
  if (unreachable) return err(UNREACHABLE_MESSAGE);
  if (!user) return err("You must be signed in.");
  if (typeof graduated !== "boolean" || typeof stillEnrolled !== "boolean") return err("Choose an answer.");
  if (!graduated && !Number.isInteger(newGradYear)) return err("Choose the year you now expect to graduate.");
  const { error } = await supabase.rpc("confirm_my_graduation", {
    p_graduated: graduated,
    p_still_enrolled: stillEnrolled,
    p_new_grad_year: graduated ? undefined : (newGradYear as number),
  });
  if (error) return err("We couldn't save that. Please try again.");
  // The directory shows each member's affiliation.
  await invalidate("directoryFacets");
  revalidatePath("/home");
  revalidatePath("/opportunities");
  return ok();
}
