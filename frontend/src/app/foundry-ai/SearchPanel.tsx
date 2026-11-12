"use client";

import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { stageLabel } from "@/lib/ai/outcomes";
import type {
  AiMode, AiTurnSummary, Conversation, RecruiterJob, ResultCard, TurnStatusResponse,
} from "@/lib/ai/types";
import { cancelTurn, type SpecOp, type SubmitInput } from "./actions";
import { CriteriaBar } from "./CriteriaBar";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { ResultsSection } from "./ResultsSection";

const STARTERS: Record<AiMode, string[]> = {
  recruiter: ["Must know Python, nice to have FastAPI", "Experience with user research"],
  network: ["Deep learning and chess", "Someone who can help with fundraising"],
  opportunities: ["Jobs that match my profile", "Remote internships using Python"],
};

function ConversationCriteria({
  loadingConversation, conversation, mode, job, editing, running, onEdit,
}: {
  loadingConversation: boolean;
  conversation: Conversation | null;
  mode: AiMode;
  job: RecruiterJob | null;
  editing: boolean;
  running: boolean;
  onEdit: (ops: SpecOp[]) => Promise<void>;
}) {
  if (loadingConversation) return <Skeleton className="h-24 w-full rounded-2xl" />;
  if (!conversation) return null;
  return (
    <CriteriaBar
      mode={mode}
      spec={conversation.spec}
      canUndo={conversation.can_undo}
      busy={editing || running}
      jobAudience={conversation.job?.audience ?? job?.audience ?? null}
      onEdit={onEdit}
    />
  );
}

function ConfirmOrRunButton({
  conversation, running, sending, onSend,
}: {
  conversation: Conversation | null;
  running: boolean;
  sending: boolean;
  onSend: (kind: SubmitInput["kind"], message: string | null) => void;
}) {
  if (running || !conversation) return null;
  if (conversation.pending) {
    return (
      <Button size="sm" onClick={() => onSend("confirm", null)} loading={sending}>
        Search with these criteria
      </Button>
    );
  }
  return null;
}

function RunDirtyButton({
  dirty, conversation, running, sending, onSend,
}: {
  dirty: boolean;
  conversation: Conversation | null;
  running: boolean;
  sending: boolean;
  onSend: (kind: SubmitInput["kind"], message: string | null) => void;
}) {
  if (!dirty || !conversation || running) return null;
  return (
    <Button size="sm" onClick={() => onSend("run", null)} loading={sending}>
      Run search with these criteria
    </Button>
  );
}

function RunningStatus({
  running, status, activeTurnId,
}: {
  running: boolean;
  status: TurnStatusResponse | null;
  activeTurnId: string | null;
}) {
  return (
    <>
      <div aria-live="polite" className="text-[0.8rem] text-text-muted">
        {running && (status ? stageLabel(status.stage) : stageLabel("queued"))}
      </div>
      {running && activeTurnId && (
        <Button variant="ghost" size="sm" onClick={async () => { await cancelTurn(activeTurnId); }}>
          Stop
        </Button>
      )}
    </>
  );
}

// The conversation/criteria/composer/results stack shown once a mode (and,
// for recruiter, a job) is picked and its requirements are confirmed. Pulled
// out of FoundryAiClient so the parent's own branching — mode/job gating,
// requirements confirmation — stays simple; everything here is unchanged.
export function SearchPanel({
  mode, job, conversation, loadingConversation, editing, running, dirty, sending,
  status, activeTurnId, error, draft, setDraft, temporary, setTemporary, conversationId,
  results, resultsError, lastCompleted, lastTurn,
  onEdit, onForgetMessage, onSend, onSaveFindings, onRetryResults, onRequestDeleteChat,
}: {
  mode: AiMode;
  job: RecruiterJob | null;
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
      <ConversationCriteria
        loadingConversation={loadingConversation}
        conversation={conversation}
        mode={mode}
        job={job}
        editing={editing}
        running={running}
        onEdit={onEdit}
      />

      {conversation && <MessageList messages={conversation.messages} onForget={onForgetMessage} />}

      <ConfirmOrRunButton conversation={conversation} running={running} sending={sending} onSend={onSend} />
      <RunDirtyButton dirty={dirty} conversation={conversation} running={running} sending={sending} onSend={onSend} />
      <RunningStatus running={running} status={status} activeTurnId={activeTurnId} />

      {error && <p role="alert" className="text-[0.85rem] text-[#ff8080]">{error}</p>}

      <Composer
        draft={draft}
        setDraft={setDraft}
        disabled={running || sending}
        sending={sending}
        placeholder={conversation ? "Refine the search…" : "Describe who or what you're looking for…"}
        starters={conversation ? [] : STARTERS[mode]}
        onSend={() => onSend("message", draft.trim())}
        showTemporary={!conversationId}
        temporary={temporary}
        setTemporary={setTemporary}
      />

      <ResultsSection
        mode={mode}
        running={running}
        results={results}
        resultsError={resultsError}
        lastCompleted={lastCompleted}
        lastTurn={lastTurn}
        sending={sending}
        onSave={onSaveFindings}
        onRescan={() => onSend("rescan", null)}
        onRetryResults={onRetryResults}
      />

      {conversation && (
        <div className="flex flex-wrap gap-3 border-t border-border-subtle pt-4">
          <Button variant="dangerGhost" size="sm" onClick={onRequestDeleteChat} disabled={running}>
            Delete this chat
          </Button>
        </div>
      )}
    </>
  );
}
