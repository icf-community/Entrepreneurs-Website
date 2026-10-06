// Foundry AI — the shapes the browser sees (AI-plan §11, §12). Every field
// here comes from a user-session RPC that has already re-checked consent,
// eligibility and blocks; nothing is a raw model output.

export type AiMode = "recruiter" | "network" | "opportunities";

export const AI_MODES: AiMode[] = ["recruiter", "network", "opportunities"];

export type TurnStatus =
  | "queued" | "running" | "completed" | "partial" | "failed" | "cancelled" | "refused" | "clarify" | "expired";

export type TurnStage = "queued" | "understanding" | "searching" | "assessing" | "scoring" | "done";

export type SpecAtom = {
  id: string;
  kind: string;
  concept: string | null;
  label: string | null;
  required: boolean;
  negated: boolean;
  group: string | null;
  source: "message" | "job" | "command" | null;
  expires_at: string | null;
};

export type Spec = {
  atoms: SpecAtom[];
  audience: ("students" | "graduates")[] | null;
  transferable: boolean;
};

export type AiMessage = {
  id: string;
  role: "member" | "system";
  kind: "message" | "results" | "refused" | "clarify" | "mixed" | "failed" | "notice";
  body: string;
  turn_id: string | null;
  created_at: string;
  expires_at: string;
};

export type AiTurnSummary = {
  id: string;
  kind: "message" | "run" | "confirm" | "rescan";
  status: TurnStatus;
  stage: TurnStage | null;
  outcome: string | null;
  result_count: number;
  created_at: string;
  finished_at: string | null;
  saved: boolean;
};

export type Conversation = {
  id: string;
  mode: AiMode;
  temporary: boolean;
  title: string | null;
  spec: Spec;
  spec_revision: number;
  can_undo: boolean;
  pending: boolean;
  job: { id: string; title: string; company: string; audience: string | null; open: boolean } | null;
  messages: AiMessage[];
  turns: AiTurnSummary[];
};

export type ConversationListItem = {
  id: string;
  title: string | null;
  opportunity_id: string | null;
  temporary: boolean;
  last_activity_at: string;
  expires_at: string | null;
};

export type RecruiterJob = {
  id: string;
  title: string;
  company: string;
  deadline: string;
  audience: "students" | "graduates" | "both";
  requirements: "pending" | "parsed" | "confirmed" | "failed";
};

export type AiState = {
  enabled: Record<AiMode, boolean>;
  jobs: RecruiterJob[];
  quota: { used: number; limit: number; resets_at: string | null };
  education_known: boolean;
};

export type CoverageRow = {
  atom: string;
  kind: string;
  concept: string | null;
  free_text: string | null;
  label: string | null;
  required: boolean;
  state: "met" | "related" | "unknown" | "not_evidenced";
};

export type ResultCard = {
  slot: number;
  kind: "member" | "opportunity";
  targetId: string;
  title: string;
  subtitle: string | null;
  avatarUrl: string | null;
  score: number | null;
  tier: "meets" | "possible" | "partial";
  coverage: CoverageRow[];
  components: { coverage?: number; task?: number; depth?: number; coverage_only?: boolean; preference?: string };
  evidence: { text: string; kind: string; from_cv: boolean }[];
  stale: boolean;
  change: "new" | "updated" | "same" | null;
  job: null | {
    deadline: string;
    locationType: string;
    locationText: string | null;
    pay: string;
    applyMethod: "email" | "link";
    applyUrl: string | null;
    contactEmail: string | null;
    audience: string | null;
    applied: boolean;
    sparse: boolean;
  };
};

export type TurnStatusResponse = {
  status: TurnStatus;
  stage: TurnStage | null;
  outcome: string | null;
  revision: number;
  conversationId: string;
  resultCount: number;
  finished: boolean;
};

export type JobRequirements = {
  status: "pending" | "parsed" | "confirmed" | "failed";
  role_level: string | null;
  atoms: SpecAtom[];
  confirmed_at: string | null;
} | null;

export type AiSettings = {
  recruiterDiscoverable: boolean;
  networkDiscoverable: boolean;
  evidenceSharing: boolean;
  useChatMemory: boolean;
  networkOffers: string[];
  networkSeeks: string[];
  prefRoleTypes: string[];
  prefLocationTypes: string[];
  /** Owner-private note on projects and experience, labelled self-reported (AI-plan §7.1). */
  selfReported: string;
};

export type Concept = { slug: string; label: string; kind: string };
