import "server-only";
import { maybeRow, rows, rowsOrThrow, type Db } from "@/lib/data/query";
import { signedImageUrls } from "@/lib/storage/blobRead";
import type {
  AiMode, AiSettings, AiState, Concept, Conversation, ConversationListItem, JobRequirements, ResultCard,
} from "./types";

// Foundry AI reads. Every one is a user-session RPC that re-authorises on
// the server (AI-plan §11): the caller's own conversations only, result
// cards re-checked against today's consent, eligibility and blocks.

export async function aiState(db: Db): Promise<AiState> {
  const data = await maybeRow("ai_state", () => db.rpc("ai_state"));
  if (!data) throw new Error("Failed to load ai_state");
  return data as unknown as AiState;
}

export async function anyAiModeEnabled(db: Db): Promise<boolean> {
  const results = await Promise.all(
    (["recruiter", "network", "opportunities"] as const).map((mode) => db.rpc("ai_mode_enabled", { p_mode: mode })),
  );
  return results.some((r) => r.data === true);
}

export async function listConversations(db: Db, mode: AiMode): Promise<ConversationListItem[]> {
  return rows("ai_list_conversations", () => db.rpc("ai_list_conversations", { p_mode: mode }));
}

export async function getConversation(db: Db, id: string): Promise<Conversation | null> {
  const data = await maybeRow("ai_get_conversation", () => db.rpc("ai_get_conversation", { p_conversation: id }));
  return (data as unknown as Conversation) ?? null;
}

export async function resultCards(db: Db, turnId: string): Promise<ResultCard[]> {
  // An empty list here would read as "no matches"; a failed read must not.
  const data = await rowsOrThrow("ai_result_cards", () => db.rpc("ai_result_cards", { p_turn: turnId }));
  const paths = data.map((r) => r.avatar_path).filter((p): p is string => !!p);
  const urls = paths.length ? await signedImageUrls(paths, "profile_picture") : [];
  const urlByPath = new Map(paths.map((p, i) => [p, urls[i] ?? null]));
  return data.map((r) => {
    const extra = (r.extra ?? {}) as Record<string, unknown>;
    return {
      slot: r.slot,
      kind: r.kind as ResultCard["kind"],
      targetId: r.target_id,
      title: r.title,
      subtitle: r.subtitle,
      avatarUrl: r.avatar_path ? urlByPath.get(r.avatar_path) ?? null : null,
      score: r.score,
      tier: r.tier as ResultCard["tier"],
      coverage: (r.coverage ?? []) as unknown as ResultCard["coverage"],
      components: (r.components ?? {}) as ResultCard["components"],
      evidence: (r.evidence ?? []) as unknown as ResultCard["evidence"],
      stale: !!r.stale,
      change: (r.change as ResultCard["change"]) ?? null,
      job: r.kind === "opportunity"
        ? {
            deadline: String(extra.deadline ?? ""),
            locationType: String(extra.location_type ?? ""),
            locationText: (extra.location_text as string | null) ?? null,
            pay: String(extra.pay ?? ""),
            applyMethod: (extra.apply_method as "email" | "link") ?? "email",
            applyUrl: (extra.apply_url as string | null) ?? null,
            contactEmail: (extra.contact_email as string | null) ?? null,
            audience: (extra.audience as string | null) ?? null,
            applied: !!extra.applied,
            sparse: !!extra.sparse,
          }
        : null,
    };
  });
}

export async function jobRequirements(db: Db, opportunityId: string): Promise<JobRequirements> {
  const data = await maybeRow("ai_get_job_requirements", () =>
    db.rpc("ai_get_job_requirements", { p_opportunity: opportunityId }));
  return (data as unknown as JobRequirements) ?? null;
}

export async function myAiSettings(db: Db): Promise<AiSettings> {
  const data = await rows("get_my_ai_settings", () => db.rpc("get_my_ai_settings"));
  const r = data[0];
  return {
    recruiterDiscoverable: !!r?.recruiter_discoverable,
    networkDiscoverable: !!r?.network_discoverable,
    evidenceSharing: !!r?.evidence_sharing,
    useChatMemory: r?.use_chat_memory ?? true,
    networkOffers: r?.network_offers ?? [],
    networkSeeks: r?.network_seeks ?? [],
    prefRoleTypes: r?.pref_role_types ?? [],
    prefLocationTypes: r?.pref_location_types ?? [],
    selfReported: r?.self_reported ?? "",
  };
}

export async function listConcepts(db: Db, kinds?: string[]): Promise<Concept[]> {
  return rows("ai_list_concepts", () => db.rpc("ai_list_concepts", kinds ? { p_kinds: kinds } : {}));
}
