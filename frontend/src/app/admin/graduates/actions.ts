"use server";

import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { requireAdmin } from "@/lib/auth/actionAuth";
import { enqueueEmailsBulk, renderGraduationPromptEmail } from "@/lib/email";
import { emailBaseUrl } from "@/lib/siteUrl";
import { describeSupabaseError } from "@/lib/supabaseErrors";

type PreviewResult =
  | { ok: true; count: number; sample: { id: string; firstName: string; surname: string; gradYear: number }[] }
  | { ok: false; error: string };

export async function previewGraduates(cutoffYear: number): Promise<PreviewResult> {
  if (!Number.isFinite(cutoffYear) || cutoffYear < 1950 || cutoffYear > 2099) {
    return { ok: false, error: "Cutoff year must be between 1950 and 2099." };
  }

  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  const { supabase } = auth;
  // Admin RLS lets us read every profile. No mutation here — this is
  // just a count + sample for the confirm modal.
  const { data, error, count } = await supabase
    .from("profiles")
    .select("id, first_name, surname, grad_year", { count: "exact" })
    .eq("role", "student")
    .eq("status", "approved")
    .not("grad_year", "is", null)
    .lte("grad_year", cutoffYear)
    // Only students not yet asked: the prompt goes once (20261011000005).
    .is("graduation_prompted_at", null)
    .is("graduation_confirmed_at", null)
    .order("grad_year", { ascending: true })
    .limit(20);

  if (error) return { ok: false, error: describeSupabaseError(error) };

  const sample = (data ?? []).map((r) => ({
    id:        r.id as string,
    firstName: r.first_name as string,
    surname:   r.surname as string,
    gradYear:  r.grad_year as number,
  }));

  return { ok: true, count: count ?? 0, sample };
}

type PromptResult =
  | { ok: true; prompted: number; emailsQueued: number }
  | { ok: false; error: string };

/**
 * Ask students due to graduate to confirm it (20261011000005). Nobody is
 * deleted: graduates keep their account, move to recent graduate when they
 * answer, and become eligible for Graduates jobs. Each student is asked
 * once; running this again only reaches students not yet asked.
 */
export async function promptGraduates(cutoffYear: number): Promise<PromptResult> {
  if (!Number.isFinite(cutoffYear) || cutoffYear < 1950 || cutoffYear > 2099) {
    return { ok: false, error: "Cutoff year must be between 1950 and 2099." };
  }

  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  const { supabase } = auth;
  const { data, error } = await supabase.rpc("admin_prompt_graduates", { p_cutoff_year: cutoffYear });
  if (error) return { ok: false, error: describeSupabaseError(error) };

  const rows = (data ?? []) as { user_id: string; email: string | null; first_name: string | null }[];
  // From trusted config, never request headers (link poisoning).
  const homeUrl = `${emailBaseUrl()}/home`;
  const enqueueRows = rows
    .filter((r): r is { user_id: string; email: string; first_name: string | null } => Boolean(r.email))
    .map((r) => ({ to: r.email, ...renderGraduationPromptEmail({ firstName: r.first_name, homeUrl }) }));

  let emailsQueued = 0;
  if (enqueueRows.length > 0) {
    try {
      // Bulk-enqueued; the drain sends them at a controlled pace.
      emailsQueued = await enqueueEmailsBulk(enqueueRows);
    } catch (e) {
      Sentry.captureException(e, { level: "error", tags: { surface: "admin", path: "prompt-graduates-email" } });
      revalidatePath("/admin/graduates");
      return {
        ok: false,
        error: `Asked ${rows.length} students in the app, but queueing their emails failed. They will still see the prompt when they sign in.`,
      };
    }
  }
  revalidatePath("/admin/graduates");
  return { ok: true, prompted: rows.length, emailsQueued };
}
