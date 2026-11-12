"use client";

import { useCallback, useEffect, useState } from "react";
import { track } from "@/lib/analytics/track";
import type {
  AiMode, Conversation, ConversationListItem, ResultCard, TurnStatusResponse,
} from "@/lib/ai/types";
import { loadConversation, loadConversations, loadResults } from "./actions";
import { useTurnPolling } from "./useTurnPolling";

// Conversation list + active conversation + its in-flight/finished turn, for
// one (mode, job) pair. Pulled out of FoundryAiClient so the component's own
// control flow (submission guards, idempotency, the quota counter) is easier
// to follow; the loading/refresh/select logic here is unchanged from before.
export function useFoundryAiConversation(
  mode: AiMode,
  jobId: string | null,
  initialConversationId: string | null,
  onError: (message: string) => void,
) {
  const [conversations, setConversations] = useState<ConversationListItem[] | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [results, setResults] = useState<{ turnId: string; cards: ResultCard[]; partial: boolean } | null>(null);
  const [resultsError, setResultsError] = useState<string | null>(null);

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
    if (!res.ok) { onError(res.error); return null; }
    setConversation(res.data);
    if (!res.data) return null;
    const turns = res.data.turns;
    const running = [...turns].reverse().find((t) => t.status === "queued" || t.status === "running");
    setActiveTurnId(running?.id ?? null);
    const done = [...turns].reverse().find((t) => t.status === "completed" || t.status === "partial");
    if (done) await showResults(done.id, done.status === "partial");
    else setResults(null);
    return res.data;
  }, [showResults, onError]);

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

  // Returns whether the selection actually changed, so a caller with its
  // own extra state to reset (e.g. a dirty/error flag) only resets it when
  // this proceeds — matching the no-op-on-same-id behavior exactly.
  const selectConversation = useCallback((id: string | null) => {
    if (id === conversationId) return false;
    setResults(null);
    setConversation(null);
    setActiveTurnId(null);
    setLoadingConversation(!!id);
    setConversationId(id);
    return true;
  }, [conversationId]);

  const onTurnFinished = useCallback((s: TurnStatusResponse) => {
    track("ai_search_finished", {
      mode,
      status: s.status,
      results: s.resultCount === 0 ? "none" : s.resultCount < 5 ? "few" : "many",
    });
    setActiveTurnId(null);
    void refreshConversation(s.conversationId);
    void refreshConversations();
  }, [mode, refreshConversation, refreshConversations]);

  const status = useTurnPolling(activeTurnId, onTurnFinished);
  const running = !!activeTurnId;

  return {
    conversations, setConversations, refreshConversations,
    conversationId, setConversationId,
    conversation, setConversation,
    loadingConversation, setLoadingConversation,
    activeTurnId, setActiveTurnId,
    results, resultsError, showResults,
    refreshConversation,
    selectConversation,
    status, running,
  };
}
