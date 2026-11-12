"use server";

import * as Sentry from "@sentry/nextjs";
import { getActionAuth } from "@/lib/auth/actionAuth";
import { check } from "@/lib/ratelimit";
import { UNREACHABLE_MESSAGE } from "@/lib/supabase/unavailable";
import { revalidatePath } from "next/cache";
import { invalidate } from "@/lib/cache";
import { err, ok, type Result } from "@/lib/result";
import { AI_CONSENT_VERSION } from "@/lib/ai/consent";

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

/**
 * Settings → "Delete account". A server action rather than a browser RPC so the
 * cached directory is dropped in the same breath: otherwise the deleted member's
 * card lingers until its TTL. The database refuses the last administrator.
 */
export async function deleteMyAccount(): Promise<Result> {
  const { supabase, user, unreachable } = await getActionAuth();
  if (unreachable) return err(UNREACHABLE_MESSAGE);
  if (!user) return err("You must be signed in.");
  const { error } = await supabase.rpc("delete_my_account");
  if (error) return err(error.message);
  await invalidate("directoryFacets");
  revalidatePath("/members");
  return ok();
}

const CONCEPT = /^[a-z0-9][a-z0-9_.+#-]{0,47}$/;
const ROLE_TYPES = new Set(["internship", "placement", "graduate", "part_time", "full_time", "contract", "cofounder"]);
const LOCATION_TYPES = new Set(["remote", "hybrid", "onsite"]);

/**
 * The member's own education status (AI-plan §7.2). Decides which jobs
 * they see: a job is for students, graduates or both, and an unknown
 * status sees none until it is confirmed (F29).
 */
export async function setMyEducation(enrolled: boolean, graduated: boolean): Promise<Result> {
  const { supabase, user, unreachable } = await getActionAuth();
  if (unreachable) return err(UNREACHABLE_MESSAGE);
  if (!user) return err("You must be signed in.");
  if (typeof enrolled !== "boolean" || typeof graduated !== "boolean") return err("Answer both questions.");
  const { error } = await supabase.rpc("set_my_education", {
    p_currently_enrolled: enrolled,
    p_has_completed_degree: graduated,
  });
  if (error) return err("We couldn't save that. Please try again.");
  revalidatePath("/opportunities");
  revalidatePath("/settings");
  return ok();
}

export type AiSettingsInput = {
  recruiterDiscoverable: boolean;
  networkDiscoverable: boolean;
  evidenceSharing: boolean;
  useChatMemory: boolean;
  networkOffers: string[];
  networkSeeks: string[];
  prefRoleTypes: string[];
  prefLocationTypes: string[];
  selfReported: string;
};

/**
 * Discovery and evidence choices (AI-plan §1, §6). Each is separate and
 * off until the member turns it on; switching one off removes them from
 * that kind of search at once, in the same database call.
 */
export async function saveAiSettings(input: AiSettingsInput): Promise<Result> {
  const { supabase, user, unreachable } = await getActionAuth();
  if (unreachable) return err(UNREACHABLE_MESSAGE);
  if (!user) return err("You must be signed in.");
  const bools = [input.recruiterDiscoverable, input.networkDiscoverable, input.evidenceSharing, input.useChatMemory];
  if (bools.some((b) => typeof b !== "boolean")) return err("That change isn't valid.");
  const lists = [input.networkOffers, input.networkSeeks];
  if (lists.some((l) => !Array.isArray(l) || l.length > 10 || l.some((s) => typeof s !== "string" || !CONCEPT.test(s)))) {
    return err("Choose up to 10 topics in each list.");
  }
  if (!Array.isArray(input.prefRoleTypes) || input.prefRoleTypes.some((r) => !ROLE_TYPES.has(r))
      || !Array.isArray(input.prefLocationTypes) || input.prefLocationTypes.some((l) => !LOCATION_TYPES.has(l))) {
    return err("That change isn't valid.");
  }
  if (typeof input.selfReported !== "string" || input.selfReported.length > 1200) {
    return err("Keep your projects and experience under 1,200 characters.");
  }
  const { error } = await supabase.rpc("set_my_ai_settings", {
    p_recruiter_discoverable: input.recruiterDiscoverable,
    p_network_discoverable: input.networkDiscoverable,
    p_evidence_sharing: input.evidenceSharing,
    p_use_chat_memory: input.useChatMemory,
    p_network_offers: input.networkOffers,
    p_network_seeks: input.networkSeeks,
    p_pref_role_types: input.prefRoleTypes,
    p_pref_location_types: input.prefLocationTypes,
    p_consent_version: AI_CONSENT_VERSION,
    p_self_reported: input.selfReported,
  });
  if (error) return err("We couldn't save your AI settings. Please try again.");
  revalidatePath("/settings");
  return ok();
}

export type ProjectionPreviewItem = { kind: string; text: string; fromCv: boolean; concepts: string[] };

/** "Preview what AI uses" (AI-plan §2): the member's own evidence lines, per purpose. */
export async function previewMyProjection(
  purpose: "recruiter" | "network" | "self",
): Promise<Result<ProjectionPreviewItem[]>> {
  const { supabase, user, unreachable } = await getActionAuth();
  if (unreachable) return err(UNREACHABLE_MESSAGE);
  if (!user) return err("You must be signed in.");
  if (!["recruiter", "network", "self"].includes(purpose)) return err("That preview isn't available.");
  const { data, error } = await supabase.rpc("ai_preview_my_projection", { p_purpose: purpose });
  if (error) return err("We couldn't load the preview. Please try again.");
  return ok((data ?? []).map((r) => ({ kind: r.source_kind, text: r.text, fromCv: r.from_cv, concepts: r.concepts ?? [] })));
}
