"use client";

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useToast } from "@/components/ui/Toast";
import type { Conversation } from "@/lib/ai/types";
import { editSpec, forgetMessage, saveFindings, type SpecOp } from "./actions";

// Spec edits, "forget message", "save findings" and "retry results" all
// act on the active conversation and share its dirty/editing flags. Pulled
// out of FoundryAiClient so the parent's own control flow (submission
// guards, idempotency, the quota counter) stays easy to follow; none of
// the logic below has changed from before.
export function useConversationActions(
  conversation: Conversation | null,
  setConversation: Dispatch<SetStateAction<Conversation | null>>,
  refreshConversation: (id: string) => Promise<Conversation | null>,
  showResults: (turnId: string, partial: boolean) => Promise<void>,
) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);

  const lastTurn = conversation?.turns.at(-1) ?? null;
  const lastCompleted = useMemo(
    () => [...(conversation?.turns ?? [])].reverse().find((t) => t.status === "completed" || t.status === "partial") ?? null,
    [conversation],
  );

  const edit = useCallback(async (ops: SpecOp[]) => {
    if (!conversation || editing) return;
    setEditing(true);
    const res = await editSpec(conversation.id, conversation.spec_revision, ops);
    setEditing(false);
    if (!res.ok) { toast(res.error, "error"); return; }
    setConversation({ ...conversation, spec: res.data.spec, spec_revision: res.data.revision, can_undo: ops[0]?.op !== "undo" });
    setDirty(true);
  }, [conversation, editing, toast, setConversation]);

  const handleForgetMessage = useCallback(async (id: string) => {
    if (!conversation) return;
    const res = await forgetMessage(id);
    if (res.ok) void refreshConversation(conversation.id);
    else toast(res.error, "error");
  }, [conversation, refreshConversation, toast]);

  const handleSaveFindings = useCallback(async () => {
    if (!conversation || !lastCompleted) return;
    const res = await saveFindings(lastCompleted.id);
    if (res.ok) { toast("Saved for 7 days.", "success"); void refreshConversation(conversation.id); }
    else toast(res.error, "error");
  }, [conversation, lastCompleted, refreshConversation, toast]);

  const handleRetryResults = useCallback(() => {
    if (!lastCompleted) return;
    void showResults(lastCompleted.id, lastCompleted.status === "partial");
  }, [lastCompleted, showResults]);

  return {
    editing, dirty, setDirty,
    lastTurn, lastCompleted,
    edit, handleForgetMessage, handleSaveFindings, handleRetryResults,
  };
}
