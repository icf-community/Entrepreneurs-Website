"use client";

import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
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
      <div>
        <Button size="sm" onClick={() => onSend("confirm", null)} loading={sending}>
          Search with these criteria
        </Button>
      </div>
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
    <div>
      <Button size="sm" onClick={() => onSend("run", null)} loading={sending}>
        Run search with these criteria
      </Button>
    </div>
  );
}

// The thinking state. While a turn runs: the orbit turning, the stage in words (the live region, polite, so
// the stage is announced as it moves) and Stop. Idle, the region stays mounted but takes no room (sr-only),
// because a live region has to exist before its text changes to be announced reliably.
function RunningStatus({
  running, status, activeTurnId,
}: {
  running: boolean;
  status: TurnStatusResponse | null;
  activeTurnId: string | null;
}) {
  return (
    <div className={running ? "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-tint-1 py-2 pl-4 pr-2" : "sr-only"}>
      <div aria-live="polite" className="flex min-w-0 flex-1 basis-40 items-center gap-3 py-1 text-body text-text-secondary">
        {running && (
          <>
            <Spinner size="md" className="text-lit" />
            <span>{status ? stageLabel(status.stage) : stageLabel("queued")}</span>
          </>
        )}
      </div>
      {running && activeTurnId && (
        <Button variant="ghost" size="sm" onClick={async () => { await cancelTurn(activeTurnId); }}>
          Stop
        </Button>
      )}
    </div>
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

      {error && <Notice tone="danger" role="alert">{error}</Notice>}

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
