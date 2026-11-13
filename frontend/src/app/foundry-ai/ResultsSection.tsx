"use client";

import { Button } from "@/components/ui/Button";
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
        <section aria-label="Results" className="space-y-3">
          {running && <p className="text-small text-text-muted">Previous results</p>}
          <ResultList mode={mode} turnId={results.turnId} cards={results.cards} partial={results.partial} />
          {mode === "recruiter" && lastCompleted && !running && (
            <div className="flex flex-wrap gap-3">
              {!lastCompleted.saved ? (
                <Button variant="ghost" size="sm" onClick={onSave}>
                  Save these matches
                </Button>
              ) : (
                <span className="text-body text-text-muted">Saved for 7 days.</span>
              )}
              <Button variant="ghost" size="sm" onClick={onRescan} loading={sending}>
                Check for new matches
              </Button>
            </div>
          )}
        </section>
      )}
      {resultsError && (
        <p role="alert" className="text-body text-danger">
          {resultsError}{" "}
          {lastCompleted && (
            <button type="button" className="underline" onClick={onRetryResults}>
              Try again
            </button>
          )}
        </p>
      )}
      {lastTurn && (lastTurn.status === "failed" || lastTurn.status === "expired") && !running && (
        <p className="text-body text-text-muted">{outcomeMessage(lastTurn.outcome)}</p>
      )}
    </>
  );
}
