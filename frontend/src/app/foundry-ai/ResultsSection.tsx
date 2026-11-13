"use client";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Icon } from "@/design-system/icons/Icon";
import { outcomeMessage } from "@/lib/ai/outcomes";
import type { AiMode, AiTurnSummary, ResultCard } from "@/lib/ai/types";
import { ResultList } from "./ResultList";

export function ResultsSection({
  mode, running, results, resultsError, lastCompleted, lastTurn, sending, onSave, onRescan, onRetryResults,
}: {
  mode: AiMode;
  running: boolean;
  results: { turnId: string; cards: ResultCard[]; partial: boolean } | null;
  resultsError: string | null;
  lastCompleted: AiTurnSummary | null;
  lastTurn: AiTurnSummary | null;
  sending: boolean;
  onSave: () => void;
  onRescan: () => void;
  onRetryResults: () => void;
}) {
  return (
    <>
      {results && (
        <section aria-label="Results" className="space-y-4">
          {running && <p className="text-small text-text-muted">Previous results</p>}
          <ResultList mode={mode} turnId={results.turnId} cards={results.cards} partial={results.partial} />
          {mode === "recruiter" && lastCompleted && !running && (
            <div className="flex flex-wrap items-center gap-3">
              {!lastCompleted.saved ? (
                <Button variant="ghost" size="sm" type="button" onClick={onSave}>
                  Save these matches
                </Button>
              ) : (
                <Badge tone="success" className="min-h-8 gap-2 px-3 text-small">
                  <Icon name="check" size={14} />
                  Saved for 7 days.
                </Badge>
              )}
              <Button variant="ghost" size="sm" type="button" onClick={onRescan} loading={sending}>
                Check for new matches
              </Button>
            </div>
          )}
        </section>
      )}
      {resultsError && (
        <Notice
          tone="danger"
          role="alert"
          action={lastCompleted ? <Button variant="ghost" size="sm" type="button" onClick={onRetryResults}>Try again</Button> : undefined}
        >
          {resultsError}
        </Notice>
      )}
      {lastTurn && (lastTurn.status === "failed" || lastTurn.status === "expired") && !running && (
        <Notice tone={lastTurn.status === "failed" ? "danger" : "info"}>{outcomeMessage(lastTurn.outcome)}</Notice>
      )}
    </>
  );
}
