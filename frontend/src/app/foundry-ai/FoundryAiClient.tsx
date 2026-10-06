"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/connections/ConfirmDialog";
import { outcomeMessage, stageLabel } from "@/lib/ai/outcomes";
import type {
  AiMode, AiState, Conversation, ConversationListItem, ResultCard, TurnStatusResponse,
} from "@/lib/ai/types";
import {
  cancelTurn, deleteAllAiHistory, deleteConversation, editSpec, forgetMessage, loadConversation,
  loadConversations, loadResults, saveFindings, submitTurn, type SpecOp, type SubmitInput,
} from "./actions";
import { CriteriaBar } from "./CriteriaBar";
import { RequirementsPanel } from "./RequirementsPanel";
import { ResultList } from "./ResultList";
import { useTurnPolling } from "./useTurnPolling";

// ════════════════════════════════════════════════════════════════════
// Foundry AI (AI-plan §12). One conversation per mode (and per job in
// recruiter mode); messages refine criteria; criteria run a bounded,
// evidence-based search; results land together when the turn finishes.
// The URL carries the mode, job and conversation for back/forward, never
// criteria or text.
// ════════════════════════════════════════════════════════════════════

const MODE_LABEL: Record<AiMode, string> = {
  recruiter: "Find candidates",
  network: "Build your network",
  opportunities: "Find opportunities",
};

const STARTERS: Record<AiMode, string[]> = {
  recruiter: ["Must know Python, nice to have FastAPI", "Experience with user research"],
  network: ["Deep learning and chess", "Someone who can help with fundraising"],
  opportunities: ["Jobs that match my profile", "Remote internships using Python"],
};

const MAX_MESSAGE = 600;

type Props = {
  state: AiState;
  initialMode: AiMode;
  initialJobId: string | null;
  initialConversationId: string | null;
};

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export default function FoundryAiClient({ state, initialMode, initialJobId, initialConversationId }: Props) {
  const toast = useToast();
  const modes = (Object.keys(state.enabled) as AiMode[]).filter((m) => state.enabled[m]);
  const [mode, setMode] = useState<AiMode>(modes.includes(initialMode) ? initialMode : modes[0]);
  const [jobId, setJobId] = useState<string | null>(
    initialJobId && state.jobs.some((j) => j.id === initialJobId) ? initialJobId : state.jobs[0]?.id ?? null,
  );
  const job = state.jobs.find((j) => j.id === jobId) ?? null;
  const [jobsConfirmed, setJobsConfirmed] = useState<Set<string>>(
    () => new Set(state.jobs.filter((j) => j.requirements === "confirmed").map((j) => j.id)),
  );

  const [conversations, setConversations] = useState<ConversationListItem[] | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [results, setResults] = useState<{ turnId: string; cards: ResultCard[]; partial: boolean } | null>(null);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [temporary, setTemporary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [used, setUsed] = useState(state.quota.used);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [confirmDeleteChat, setConfirmDeleteChat] = useState(false);
  // One idempotency key per user action: a network retry of the same send
  // reuses it, so a double submit can never start two paid turns (§9).
  const keyRef = useRef<string>(newKey());

  // URL state for back/forward: mode, job and conversation only.
  useEffect(() => {
    const params = new URLSearchParams();
    params.set("mode", mode);
    if (mode === "recruiter" && jobId) params.set("job", jobId);
    if (conversationId) params.set("c", conversationId);
    window.history.replaceState(null, "", `/foundry-ai?${params.toString()}`);
  }, [mode, jobId, conversationId]);

  const refreshConversations = useCallback(async () => {
    const res = await loadConversations(mode);
    if (res.ok) {
      setConversations(mode === "recruiter" ? res.data.filter((c) => c.opportunity_id === jobId) : res.data);
    } else {
      setConversations([]);
    }
  }, [mode, jobId]);

  useEffect(() => {
    let cancelled = false;
    loadConversations(mode).then((res) => {
      if (cancelled) return;
      const list = res.ok ? res.data : [];
      setConversations(mode === "recruiter" ? list.filter((c) => c.opportunity_id === jobId) : list);
    });
    return () => { cancelled = true; };
  }, [mode, jobId]);

  const showResults = useCallback(async (turnId: string, partial: boolean) => {
    setResultsError(null);
    const res = await loadResults(turnId);
    if (res.ok) setResults({ turnId, cards: res.data, partial });
    else setResultsError(res.error);
  }, []);

  const applyConversation = useCallback(async (res: Awaited<ReturnType<typeof loadConversation>>) => {
    if (!res.ok) { setError(res.error); return null; }
    setConversation(res.data);
    if (!res.data) return null;
    const turns = res.data.turns;
    const running = [...turns].reverse().find((t) => t.status === "queued" || t.status === "running");
    setActiveTurnId(running?.id ?? null);
    const done = [...turns].reverse().find((t) => t.status === "completed" || t.status === "partial");
    if (done) await showResults(done.id, done.status === "partial");
    else setResults(null);
    return res.data;
  }, [showResults]);

  const refreshConversation = useCallback(
    (id: string) => loadConversation(id).then(applyConversation),
    [applyConversation],
  );

  // Loads the selected conversation. State is reset where the selection
  // changes (selectConversation), not here, so this effect only fetches.
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    loadConversation(conversationId).then((res) => {
      if (cancelled) return;
      void applyConversation(res).finally(() => setLoadingConversation(false));
    });
    return () => { cancelled = true; };
  }, [conversationId, applyConversation]);

  const selectConversation = (id: string | null) => {
    if (id === conversationId) return;
    setResults(null);
    setDirty(false);
    setError(null);
    setConversation(null);
    setActiveTurnId(null);
    setLoadingConversation(!!id);
    setConversationId(id);
  };

  const onTurnFinished = useCallback((s: TurnStatusResponse) => {
    setActiveTurnId(null);
    void refreshConversation(s.conversationId);
    void refreshConversations();
  }, [refreshConversation, refreshConversations]);

  const status = useTurnPolling(activeTurnId, onTurnFinished);
  const running = !!activeTurnId;

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
    const res = await submitTurn({
      mode,
      conversationId,
      opportunityId: mode === "recruiter" ? jobId : null,
      kind,
      message,
      idempotencyKey: keyRef.current,
      expectedRevision: conversation?.spec_revision ?? null,
      temporary: !conversationId && temporary,
    });
    setSending(false);
    if (!res.ok) {
      const when = res.error.retryAt ? ` (${new Date(res.error.retryAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})` : "";
      setError(res.error.message + when);
      return;
    }
    keyRef.current = newKey();
    if (!res.data.duplicate) setUsed((n) => n + 1);
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

  const edit = async (ops: SpecOp[]) => {
    if (!conversation || editing) return;
    setEditing(true);
    const res = await editSpec(conversation.id, conversation.spec_revision, ops);
    setEditing(false);
    if (!res.ok) { toast(res.error, "error"); return; }
    setConversation({ ...conversation, spec: res.data.spec, spec_revision: res.data.revision, can_undo: ops[0]?.op !== "undo" });
    setDirty(true);
  };

  const jobNeedsConfirming = mode === "recruiter" && !!jobId && !jobsConfirmed.has(jobId);
  const remaining = Math.max(0, state.quota.limit - used);
  const lastTurn = conversation?.turns.at(-1) ?? null;
  const lastCompleted = useMemo(
    () => [...(conversation?.turns ?? [])].reverse().find((t) => t.status === "completed" || t.status === "partial") ?? null,
    [conversation],
  );

  if (modes.length === 0) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="order-2 lg:order-1">
        <details className="rounded-2xl border border-border bg-bg-card" open>
          <summary className="cursor-pointer px-4 py-3 text-[0.8rem] text-text-primary lg:hidden">Recent searches</summary>
          <div className="space-y-2 px-4 pb-4 lg:pt-4">
            <Button variant="ghost" size="sm" className="w-full" onClick={() => selectConversation(null)} disabled={running}>
              New search
            </Button>
            {conversations === null ? (
              <Skeleton className="h-16 w-full" />
            ) : conversations.length === 0 ? (
              <p className="text-[0.75rem] text-text-muted">No recent searches.</p>
            ) : (
              <ul className="space-y-1">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => selectConversation(c.id)}
                      aria-current={c.id === conversationId ? "true" : undefined}
                      className={`w-full cursor-pointer truncate rounded-lg border px-3 py-2 text-left text-[0.8rem] ${
                        c.id === conversationId ? "border-accent text-text-primary" : "border-border-strong text-text-secondary hover:border-accent"
                      }`}
                    >
                      {c.title || "Untitled search"}
                      {c.temporary && <span className="text-text-muted"> · temporary</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="pt-2 text-[0.7rem] text-text-muted">
              Chats are kept for 7 days. <Link href="/ai-notice" className="underline">How AI search works</Link>
            </p>
            <Button variant="dangerGhost" size="sm" className="w-full" onClick={() => setConfirmDeleteAll(true)}>
              Delete all AI history
            </Button>
          </div>
        </details>
      </aside>

      <div className="order-1 min-w-0 space-y-5 lg:order-2">
        {modes.length > 1 && (
          <div role="tablist" aria-label="Search mode" className="flex flex-wrap gap-2">
            {modes.map((m) => (
              <button
                key={m}
                role="tab"
                type="button"
                aria-selected={m === mode}
                onClick={() => switchMode(m)}
                className={`cursor-pointer rounded-lg border px-4 py-2 text-[0.8rem] ${
                  m === mode ? "border-accent bg-white/[0.08] text-text-primary" : "border-border-strong text-text-secondary hover:border-accent"
                }`}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        )}

        <p className="text-[0.8rem] text-text-muted">
          AI-assisted matching. Evidence may be incomplete.{" "}
          <Link href="/ai-notice" className="underline">Learn more</Link> · {remaining} of {state.quota.limit} searches left today
        </p>

        {mode === "recruiter" && (
          state.jobs.length === 0 ? (
            <p className="rounded-2xl border border-border bg-bg-card p-5 text-[0.85rem] text-text-secondary">
              Candidate search works with an open job you posted. <Link href="/opportunities/new" className="underline">Post a job</Link>
            </p>
          ) : (
            <label className="block">
              <span className="text-[0.75rem] text-text-muted">Job</span>
              <select
                value={jobId ?? ""}
                onChange={(e) => { setJobId(e.target.value); selectConversation(null); setConversations(null); }}
                className="mt-1 w-full rounded-lg border border-border-strong bg-white/[0.03] px-3 py-2 text-[0.85rem] text-text-primary"
              >
                {state.jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.title} · {j.company}</option>
                ))}
              </select>
            </label>
          )
        )}

        {mode === "opportunities" && !state.education_known && (
          <p className="rounded-2xl border border-border bg-bg-card p-5 text-[0.85rem] text-text-secondary">
            Confirm your status to see jobs. <Link href="/settings#education" className="underline">Confirm now</Link>
          </p>
        )}

        {jobNeedsConfirming && jobId ? (
          <RequirementsPanel
            key={jobId}
            jobId={jobId}
            onConfirmed={() => setJobsConfirmed((s) => new Set([...s, jobId]))}
          />
        ) : (mode !== "recruiter" || job) && (
          <>
            {loadingConversation ? (
              <Skeleton className="h-24 w-full rounded-2xl" />
            ) : conversation ? (
              <CriteriaBar
                mode={mode}
                spec={conversation.spec}
                canUndo={conversation.can_undo}
                busy={editing || running}
                jobAudience={conversation.job?.audience ?? job?.audience ?? null}
                onEdit={edit}
              />
            ) : null}

            {conversation && (
              <ol className="space-y-2" aria-label="Conversation">
                {conversation.messages.map((m) => (
                  <li key={m.id} className={`flex items-start gap-2 text-[0.85rem] ${m.role === "member" ? "text-text-primary" : "text-text-secondary"}`}>
                    <span className="shrink-0 text-[0.65rem] uppercase tracking-wider text-text-muted">{m.role === "member" ? "You" : "Foundry"}</span>
                    <span className="min-w-0 flex-1 whitespace-pre-wrap">{m.body}</span>
                    {m.role === "member" && (
                      <button
                        type="button"
                        className="shrink-0 cursor-pointer rounded-md border border-border-strong px-2 py-0.5 text-[0.65rem] text-text-muted hover:border-accent"
                        onClick={async () => {
                          const res = await forgetMessage(m.id);
                          if (res.ok) void refreshConversation(conversation.id);
                          else toast(res.error, "error");
                        }}
                        aria-label="Forget this message and any criteria it added"
                      >
                        Forget
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            )}

            {conversation?.pending && !running && (
              <Button size="sm" onClick={() => send("confirm", null)} loading={sending}>
                Search with these criteria
              </Button>
            )}

            {dirty && conversation && !running && (
              <Button size="sm" onClick={() => send("run", null)} loading={sending}>
                Run search with these criteria
              </Button>
            )}

            <div aria-live="polite" className="text-[0.8rem] text-text-muted">
              {running && (status ? stageLabel(status.stage) : stageLabel("queued"))}
            </div>
            {running && activeTurnId && (
              <Button variant="ghost" size="sm" onClick={async () => { await cancelTurn(activeTurnId); }}>
                Stop
              </Button>
            )}

            {error && <p role="alert" className="text-[0.85rem] text-[#ff8080]">{error}</p>}

            <Composer
              draft={draft}
              setDraft={(v) => { setDraft(v); keyRef.current = newKey(); }}
              disabled={running || sending}
              sending={sending}
              placeholder={conversation ? "Refine the search…" : "Describe who or what you're looking for…"}
              starters={conversation ? [] : STARTERS[mode]}
              onSend={() => send("message", draft.trim())}
              showTemporary={!conversationId}
              temporary={temporary}
              setTemporary={setTemporary}
            />

            {results && (
              <section aria-label="Results" className="space-y-3">
                {running && <p className="text-[0.75rem] text-text-muted">Previous results</p>}
                <ResultList mode={mode} cards={results.cards} partial={results.partial} />
                {mode === "recruiter" && lastCompleted && !running && (
                  <div className="flex flex-wrap gap-3">
                    {!lastCompleted.saved ? (
                      <Button variant="ghost" size="sm" onClick={async () => {
                        const res = await saveFindings(lastCompleted.id);
                        if (res.ok) { toast("Saved for 7 days.", "success"); void refreshConversation(conversation!.id); }
                        else toast(res.error, "error");
                      }}>
                        Save these matches
                      </Button>
                    ) : (
                      <span className="text-[0.8rem] text-text-muted">Saved for 7 days.</span>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => send("rescan", null)} loading={sending}>
                      Check for new matches
                    </Button>
                  </div>
                )}
              </section>
            )}
            {resultsError && (
              <p role="alert" className="text-[0.85rem] text-[#ff8080]">
                {resultsError}{" "}
                {lastCompleted && (
                  <button type="button" className="underline" onClick={() => void showResults(lastCompleted.id, lastCompleted.status === "partial")}>
                    Try again
                  </button>
                )}
              </p>
            )}

            {lastTurn && (lastTurn.status === "failed" || lastTurn.status === "expired") && !running && (
              <p className="text-[0.8rem] text-text-muted">{outcomeMessage(lastTurn.outcome)}</p>
            )}

            {conversation && (
              <div className="flex flex-wrap gap-3 border-t border-border-subtle pt-4">
                <Button variant="dangerGhost" size="sm" onClick={() => setConfirmDeleteChat(true)} disabled={running}>
                  Delete this chat
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {confirmDeleteChat && conversation && (
        <ConfirmDialog
          title="Delete this chat?"
          body={<p>Its messages, criteria and results are deleted now.</p>}
          confirmLabel="Delete chat"
          onConfirm={() => deleteConversation(conversation.id)}
          onSuccess={() => { selectConversation(null); void refreshConversations(); }}
          onClose={() => setConfirmDeleteChat(false)}
        />
      )}
      {confirmDeleteAll && (
        <ConfirmDialog
          title="Delete all AI history?"
          body={<p>Every AI chat, criterion and saved match you have is deleted now. Today&apos;s search count stays.</p>}
          confirmLabel="Delete everything"
          onConfirm={() => deleteAllAiHistory()}
          onSuccess={() => { selectConversation(null); void refreshConversations(); }}
          onClose={() => setConfirmDeleteAll(false)}
        />
      )}
    </div>
  );
}

function Composer({
  draft, setDraft, disabled, sending, placeholder, starters, onSend, showTemporary, temporary, setTemporary,
}: {
  draft: string;
  setDraft: (v: string) => void;
  disabled: boolean;
  sending: boolean;
  placeholder: string;
  starters: string[];
  onSend: () => void;
  showTemporary: boolean;
  temporary: boolean;
  setTemporary: (v: boolean) => void;
}) {
  const composing = useRef(false);
  const canSend = draft.trim().length > 0 && draft.length <= MAX_MESSAGE && !disabled;
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (canSend) onSend(); }}
      className="rounded-2xl border border-border bg-bg-card p-4"
    >
      {starters.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {starters.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setDraft(s)}
              className="cursor-pointer rounded-lg border border-border-strong bg-white/[0.04] px-3 py-1.5 text-[0.75rem] text-text-secondary hover:border-accent"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <label htmlFor="ai-composer" className="sr-only">Your search</label>
      <textarea
        id="ai-composer"
        rows={3}
        maxLength={MAX_MESSAGE}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={(e) => {
          // Enter sends; Shift+Enter is a newline; never mid-composition (IME).
          if (e.key === "Enter" && !e.shiftKey && !composing.current && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSend) onSend();
          }
        }}
        className="w-full resize-none rounded-lg border border-border bg-white/[0.03] px-3 py-2 text-[0.85rem] text-text-primary placeholder:text-text-muted focus:border-accent"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-[0.75rem] text-text-muted">
          <span>{draft.length}/{MAX_MESSAGE}</span>
          {showTemporary && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={temporary} onChange={(e) => setTemporary(e.target.checked)} />
              Temporary search (not used to understand later searches)
            </label>
          )}
        </div>
        <Button type="submit" size="sm" loading={sending} disabled={!canSend}>
          Search
        </Button>
      </div>
    </form>
  );
}
