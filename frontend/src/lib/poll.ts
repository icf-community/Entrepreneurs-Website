// ════════════════════════════════════════════════════════════════════
// Foundry · One polling policy for every progress view (B8/B20, old S3)
//
// The CV and GitHub progress views polled on fixed setInterval timers. A
// slow response overlapped the next request (500 open dialogs ≈ 250
// status reads a second), and a request that threw left the spinner
// running forever. This replaces them:
//
//   * one request at a time — the next is scheduled only after the last
//     settles;
//   * backoff with jitter — base, 2×, 4× … capped, ±20%, so many open
//     dialogs don't fire in lockstep;
//   * paused while the tab is hidden, resumed with an immediate check;
//   * a thrown request stops the poll and calls onError, so the caller
//     can show "Try again" instead of spinning.
// ════════════════════════════════════════════════════════════════════

export type PollOptions<T> = {
  fetch: () => Promise<T>;
  /** Decide from each result whether to keep going. */
  onResult: (result: T) => "continue" | "stop";
  /** Called once if a request throws; polling has stopped by then. */
  onError: (e: unknown) => void;
  baseMs?: number;
  maxMs?: number;
  /** Injectable for tests. */
  random?: () => number;
};

/** Start polling immediately. Returns a function that stops it. */
export function startPoll<T>({
  fetch,
  onResult,
  onError,
  baseMs = 1_000,
  maxMs = 8_000,
  random = Math.random,
}: PollOptions<T>): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let delay = baseMs;
  const doc = typeof document === "undefined" ? null : document;

  const onVisibility = () => {
    if (!stopped && doc?.visibilityState === "visible" && timer === null) void tick();
  };
  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    doc?.removeEventListener("visibilitychange", onVisibility);
  };

  async function tick(): Promise<void> {
    timer = null;
    if (stopped) return;
    let result: T;
    try {
      result = await fetch();
    } catch (e) {
      if (stopped) return;
      stop();
      onError(e);
      return;
    }
    if (stopped) return;
    if (onResult(result) === "stop") {
      stop();
      return;
    }
    // Hidden tab: don't schedule; the visibility listener resumes us.
    if (doc && doc.visibilityState !== "visible") return;
    const jittered = delay * (0.8 + 0.4 * random());
    delay = Math.min(delay * 2, maxMs);
    timer = setTimeout(() => void tick(), jittered);
  }

  doc?.addEventListener("visibilitychange", onVisibility);
  void tick();
  return stop;
}
