"use server";

import * as Sentry from "@sentry/nextjs";
import { getActionAuth } from "@/lib/auth/actionAuth";
import { check } from "@/lib/ratelimit";
import { UNREACHABLE_MESSAGE } from "@/lib/supabase/unavailable";

export type ExportResult = { ok: true; json: string; filename: string } | { ok: false; error: string };

/**
 * Settings → "Download my data" (launch programme F-x2).
 *
 * Everything we hold that is the member's own, from one owner-scoped RPC
 * (export_my_data, keyed on auth.uid()). A server action rather than a GET
 * route so the framework's origin check applies, and a cross-site page
 * can't spend the member's daily allowance by linking to it.
 */
export async function exportMyData(): Promise<ExportResult> {
  const { supabase, user, unreachable } = await getActionAuth();
  if (unreachable) return { ok: false, error: UNREACHABLE_MESSAGE };
  if (!user) return { ok: false, error: "You must be signed in." };

  const decision = await check("dataExport", user.id);
  if (decision === "limited") return { ok: false, error: "You've downloaded your data several times today. Please try again tomorrow." };
  if (decision === "unavailable") return { ok: false, error: "We can't prepare your data right now. Please try again in a few minutes." };

  const { data, error } = await supabase.rpc("export_my_data");
  if (error || !data) {
    Sentry.captureException(error ?? new Error("export_my_data returned nothing"), {
      tags: { surface: "data-export" },
    });
    return { ok: false, error: "We couldn't prepare your data. Please try again." };
  }

  const day = new Date().toISOString().slice(0, 10);
  return { ok: true, json: JSON.stringify(data, null, 2), filename: `foundry-my-data-${day}.json` };
}
