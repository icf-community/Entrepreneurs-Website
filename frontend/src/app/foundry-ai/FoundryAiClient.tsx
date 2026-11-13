"use client";

import Link from "next/link";
import { useRef, useState, useEffect } from "react";
import { track } from "@/lib/analytics/track";
import type { AiMode, AiState } from "@/lib/ai/types";
import { deleteAllAiHistory, deleteConversation, submitTurn, type SubmitInput } from "./actions";
import { consumeAiDraftHandoff } from "@/lib/ai/entryPoint";
import { renderDraftText } from "@/lib/ai/draftText";
import { ModeTabs } from "./ModeTabs";
import { ConversationSidebar } from "./ConversationSidebar";
import { ModeGate } from "./ModeGate";
import { AiHistoryDialogs } from "./AiHistoryDialogs";
import { useFoundryAiConversation } from "./useFoundryAiConversation";
import { useConversationActions } from "./useConversationActions";

// ════════════════════════════════════════════════════════════════════
// Foundry AI (AI-plan §12). One conversation per mode (and per job in
// recruiter mode); messages refine criteria; criteria run a bounded,
// evidence-based search; results land together when the turn finishes.
// The URL carries the mode, job and conversation for back/forward, never
// criteria or text.
// ════════════════════════════════════════════════════════════════════

type Props = {
  state: AiState;
  initialMode: AiMode;
  initialJobId: string | null;
  initialConversationId: string | null;
  initialDraftId: string | null;
};

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export default function FoundryAiClient({ state, initialMode, initialJobId, initialConversationId, initialDraftId }: Props) {
  const modes = (Object.keys(state.enabled) as AiMode[]).filter(
    (m) => state.enabled[m] && (m !== "recruiter" || state.jobs.length > 0),
  );
  const [mode, setMode] = useState<AiMode>(modes.includes(initialMode) ? initialMode : modes[0]);
  const [jobId, setJobId] = useState<string | null>(
    initialJobId && state.jobs.some((j) => j.id === initialJobId) ? initialJobId : state.jobs[0]?.id ?? null,
  );
  const job = state.jobs.find((j) => j.id === jobId) ?? null;
  const [jobsConfirmed, setJobsConfirmed] = useState<Set<string>>(
    () => new Set(state.jobs.filter((j) => j.requirements === "confirmed").map((j) => j.id)),
  );

  const [draft, setDraft] = useState("");
  const [temporary, setTemporary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- deliberate one-time optimistic counter seeded from server props, incremented client-side via setUsed((n) => n + 1); not meant to track the prop after mount
  const [used, setUsed] = useState(state.quota.used);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [confirmDeleteChat, setConfirmDeleteChat] = useState(false);
  // One idempotency key per user action: a network retry of the same send
  // reuses it, so a double submit can never start two paid turns (§9).
  const [initialKey] = useState(newKey);
  const keyRef = useRef<string>(initialKey);

  const {
    conversations, setConversations,
    conversationId, setConversationId,
    conversation, setConversation,
    loadingConversation, setLoadingConversation,
    activeTurnId, setActiveTurnId,
    results, resultsError, showResults,
    refreshConversation,
    refreshConversations,
    selectConversation: selectConversationBase,
    status, running,
  } = useFoundryAiConversation(mode, jobId, initialConversationId, setError);

  const {
    editing, dirty, setDirty,
    lastTurn, lastCompleted,
    edit, handleForgetMessage, handleSaveFindings, handleRetryResults,
  } = useConversationActions(conversation, setConversation, refreshConversation, showResults);

  const selectConversation = (id: string | null) => {
    if (!selectConversationBase(id)) return;
    setDirty(false);
    setError(null);
  };

  // URL state for back/forward: mode, job and conversation only.
  useEffect(() => {
    const params = new URLSearchParams();
    params.set("mode", mode);
    if (mode === "recruiter" && jobId) params.set("job", jobId);
    if (conversationId) params.set("c", conversationId);
    window.history.replaceState(null, "", `/foundry-ai?${params.toString()}`);
  }, [mode, jobId, conversationId]);

  // S8 gap 20: a one-time handoff from /members or /opportunities. Consumed
  // (and gone from the server) on first mount; the draft only ever fills
  // the Composer text — nothing is sent until the member presses Send, and
  // the handoff id itself is already gone from the URL by the effect above.
  useEffect(() => {
    if (!initialDraftId) return;
    let cancelled = false;
    consumeAiDraftHandoff(initialDraftId).then((res) => {
      if (cancelled || !res.ok || !res.data) return;
      const text = renderDraftText(mode, res.data);
      if (text) setDraft(text);
    });
    return () => { cancelled = true; };
    // Runs once, for the id this page loaded with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDraftId]);

  const switchMode = (next: AiMode) => {
    if (next === mode) return;
    setMode(next);
    selectConversation(null);
    setConversations(null);
  };

  const send = async (kind: SubmitInput["kind"], message: string | null) => {
    if (sending || running) return;
    setSending(true);
    setError(null);
    let res: Awaited<ReturnType<typeof submitTurn>>;
    try {
      res = await submitTurn({
        mode,
        conversationId,
        opportunityId: mode === "recruiter" ? jobId : null,
        kind,
        message,
        idempotencyKey: keyRef.current,
        expectedRevision: conversation?.spec_revision ?? null,
        temporary: !conversationId && temporary,
      });
    } finally {
      setSending(false);
    }
    if (!res.ok) {
      // Enum-only (F19, G7): mode and kind, never criteria, ids or scores.
      track("ai_search_refused", { mode, kind, stage: "admission" });
      const when = res.error.retryAt ? ` (${new Date(res.error.retryAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})` : "";
      setError(res.error.message + when);
      return;
    }
    keyRef.current = newKey();
    if (!res.data.duplicate) {
      setUsed((n) => n + 1);
      track("ai_search_submitted", { mode, kind });
    }
    if (kind === "message") setDraft("");
    setDirty(false);
    setActiveTurnId(res.data.turnId);
    if (res.data.conversationId !== conversationId) {
      setConversationId(res.data.conversationId);
      setLoadingConversation(true);
    } else {
      void refreshConversation(res.data.conversationId);
    }
  };

  const jobNeedsConfirming = mode === "recruiter" && !!jobId && !jobsConfirmed.has(jobId);
  const remaining = Math.max(0, state.quota.limit - used);

  if (modes.length === 0) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <ConversationSidebar
        conversations={conversations}
        conversationId={conversationId}
        running={running}
        onSelect={selectConversation}
        onDeleteAll={() => setConfirmDeleteAll(true)}
      />

      <div className="order-1 min-w-0 space-y-5 lg:order-2">
        <ModeTabs modes={modes} mode={mode} onSwitch={switchMode} />

        <p className="text-body text-text-muted">
          AI-assisted matching. Evidence may be incomplete.{" "}
          <Link href="/ai-notice" className="underline">Learn more</Link> · {remaining} of {state.quota.limit} searches left today
        </p>

        <ModeGate
          mode={mode}
          job={job}
          jobId={jobId}
          jobs={state.jobs}
          educationKnown={state.education_known}
          jobNeedsConfirming={jobNeedsConfirming}
          // The rail reloads from an effect keyed on jobId. A "change" to the job
          // already selected (the first job is preselected, and automation or a
          // re-dispatched change event can re-pick it) would blank the rail
          // without that effect re-running, leaving it on its skeleton.
          onJobChange={(id) => { if (id === jobId) return; setJobId(id); selectConversation(null); setConversations(null); }}
          onConfirmed={() => setJobsConfirmed((s) => new Set([...s, jobId!]))}
          conversation={conversation}
          loadingConversation={loadingConversation}
          editing={editing}
          running={running}
          dirty={dirty}
          sending={sending}
          status={status}
          activeTurnId={activeTurnId}
          error={error}
          draft={draft}
          setDraft={(v) => { setDraft(v); keyRef.current = newKey(); }}
          temporary={temporary}
          setTemporary={setTemporary}
          conversationId={conversationId}
          results={results}
          resultsError={resultsError}
          lastCompleted={lastCompleted}
          lastTurn={lastTurn}
          onEdit={edit}
          onForgetMessage={handleForgetMessage}
          onSend={send}
          onSaveFindings={handleSaveFindings}
          onRetryResults={handleRetryResults}
          onRequestDeleteChat={() => setConfirmDeleteChat(true)}
        />
      </div>

      <AiHistoryDialogs
        showDeleteChat={confirmDeleteChat && !!conversation}
        showDeleteAll={confirmDeleteAll}
        onDeleteChat={() => deleteConversation(conversation!.id)}
        onDeleteAll={() => deleteAllAiHistory()}
        onChatDeleted={() => { selectConversation(null); void refreshConversations(); }}
        onAllDeleted={() => { selectConversation(null); void refreshConversations(); }}
        onCloseChat={() => setConfirmDeleteChat(false)}
        onCloseAll={() => setConfirmDeleteAll(false)}
      />
    </div>
  );
}
