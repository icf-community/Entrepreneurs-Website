"use client";

import Link from "next/link";
import type {
  AiMode, AiTurnSummary, Conversation, RecruiterJob, ResultCard, TurnStatusResponse,
} from "@/lib/ai/types";
import type { SpecOp, SubmitInput } from "./actions";
import { JobPicker } from "./JobPicker";
import { RequirementsPanel } from "./RequirementsPanel";
import { SearchPanel } from "./SearchPanel";

// Which of "pick a job", "confirm requirements" or the search panel itself
// shows, for the current mode. Pulled out of FoundryAiClient so the
// parent's own branching for mode/job gating stays simple; the gating
// logic itself (recruiter needs a job, a job needs confirmed requirements
// before it can be searched) is unchanged from before.
export function ModeGate({
  mode, job, jobId, jobs, educationKnown, jobNeedsConfirming, onJobChange, onConfirmed,
  conversation, loadingConversation, editing, running, dirty, sending,
  status, activeTurnId, error, draft, setDraft, temporary, setTemporary, conversationId,
  results, resultsError, lastCompleted, lastTurn,
  onEdit, onForgetMessage, onSend, onSaveFindings, onRetryResults, onRequestDeleteChat,
}: {
  mode: AiMode;
  job: RecruiterJob | null;
  jobId: string | null;
  jobs: RecruiterJob[];
  educationKnown: boolean;
  jobNeedsConfirming: boolean;
  onJobChange: (id: string) => void;
  onConfirmed: () => void;
  conversation: Conversation | null;
  loadingConversation: boolean;
  editing: boolean;
  running: boolean;
  dirty: boolean;
  sending: boolean;
  status: TurnStatusResponse | null;
  activeTurnId: string | null;
  error: string | null;
  draft: string;
  setDraft: (v: string) => void;
  temporary: boolean;
  setTemporary: (v: boolean) => void;
  conversationId: string | null;
  results: { turnId: string; cards: ResultCard[]; partial: boolean } | null;
  resultsError: string | null;
  lastCompleted: AiTurnSummary | null;
  lastTurn: AiTurnSummary | null;
  onEdit: (ops: SpecOp[]) => Promise<void>;
  onForgetMessage: (id: string) => void;
  onSend: (kind: SubmitInput["kind"], message: string | null) => void;
  onSaveFindings: () => void;
  onRetryResults: () => void;
  onRequestDeleteChat: () => void;
}) {
  return (
    <>
      {mode === "recruiter" && <JobPicker jobs={jobs} jobId={jobId} onChange={onJobChange} />}

      {mode === "opportunities" && !educationKnown && (
        <p className="rounded-2xl border border-border bg-bg-card p-5 text-[0.85rem] text-text-secondary">
          Confirm your status to see jobs. <Link href="/settings#education" className="underline">Confirm now</Link>
        </p>
      )}

      {jobNeedsConfirming && jobId ? (
        <RequirementsPanel key={jobId} jobId={jobId} onConfirmed={onConfirmed} />
      ) : (mode !== "recruiter" || job) && (
        <SearchPanel
          mode={mode}
          job={job}
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
          setDraft={setDraft}
          temporary={temporary}
          setTemporary={setTemporary}
          conversationId={conversationId}
          results={results}
          resultsError={resultsError}
          lastCompleted={lastCompleted}
          lastTurn={lastTurn}
          onEdit={onEdit}
          onForgetMessage={onForgetMessage}
          onSend={onSend}
          onSaveFindings={onSaveFindings}
          onRetryResults={onRetryResults}
          onRequestDeleteChat={onRequestDeleteChat}
        />
      )}
    </>
  );
}
