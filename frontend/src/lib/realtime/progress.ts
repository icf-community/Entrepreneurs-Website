import type { RealtimeChannel } from "@supabase/supabase-js";
import { browserClient } from "@/lib/supabase/browser";
import { startPoll, type PollOptions } from "@/lib/poll";

// ════════════════════════════════════════════════════════════════════
// Foundry · Wait for background work by being told, not by asking
//
// The progress views (CV processing, GitHub scan, Foundry AI turns) used
// to poll a status RPC every 1–8 s. Now a database trigger
// (20261111000001_progress_broadcasts) sends a content-free signal on the
// member's private topic `member:<uuid>` whenever the watched row changes,
// and the view re-reads the status through the same RPC as before. The
// signal carries no data, so authorisation stays where it was.
//
// Cost shape: the socket is opened only while something is being waited
// on, and closed when the last waiter stops. A tab with nothing in flight
// holds no connection.
//
// Requests per wait: one on start, one when the channel joins (it closes
// the gap between the first read and the subscription), one per signal,
// and a slow safety check while the tab is visible. Broadcast is
// at-most-once (a reconnect can drop a message), and without that check a
// lost signal would leave a spinner up for good.
//
// If the channel can't join (Realtime down, a proxy blocking websockets),
// each waiter falls back to the old backoff poller for the rest of that
// wait. See watchProgress for the rules that keep the socket cheap.
// ════════════════════════════════════════════════════════════════════

export type ProgressKind = "cv" | "cv_suggestions" | "github" | "ai_turn";
type Signal = { kind?: string; turn?: string };

type Listener = { onSignal: (s: Signal) => void; onUp: () => void; onDown: () => void };

let shared: { topic: string; channel: RealtimeChannel; listeners: Set<Listener>; up: boolean } | null = null;

function attach(topic: string, l: Listener) {
  const supabase = browserClient();
  if (shared && shared.topic !== topic) {
    // A different member signed in on this tab; the old topic is not theirs.
    void supabase.removeChannel(shared.channel);
    shared = null;
  }
  if (shared) {
    shared.listeners.add(l);
    if (shared.up) l.onUp();
    return;
  }
  const listeners = new Set<Listener>([l]);
  const channel = supabase
    .channel(topic, { config: { private: true } })
    .on("broadcast", { event: "progress" }, ({ payload }) => {
      for (const x of [...listeners]) x.onSignal((payload ?? {}) as Signal);
    });
  const entry = { topic, channel, listeners, up: false };
  shared = entry;
  channel.subscribe((status) => {
    if (shared !== entry) return;
    if (status === "SUBSCRIBED") {
      entry.up = true;
      for (const x of [...listeners]) x.onUp();
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      // Drop the channel rather than let realtime-js rejoin on its own
      // backoff, which retries every 10 s for as long as the tab is open.
      // Each waiter falls back to polling for the rest of its wait; the
      // next wait tries Realtime once more.
      shared = null;
      void supabase.removeChannel(channel);
      for (const x of [...listeners]) x.onDown();
    }
  });
}

function detach(l: Listener) {
  if (!shared || !shared.listeners.delete(l) || shared.listeners.size > 0) return;
  // Last waiter gone: drop the channel. realtime-js closes the socket once
  // no channels remain, so an idle tab holds no connection.
  void browserClient().removeChannel(shared.channel);
  shared = null;
}

/** Subscribe to this member's progress signals. Returns a release function. */
export function subscribeToProgress(l: Listener): () => void {
  let released = false;
  void browserClient()
    .auth.getSession()
    .then(({ data }) => {
      if (released) return;
      const uid = data.session?.user.id;
      if (!uid) return l.onDown();
      attach(`member:${uid}`, l);
    }, () => { if (!released) l.onDown(); });
  return () => {
    released = true;
    detach(l);
  };
}

export const SAFETY_CHECK_MS = 30_000;
/** A wait holds the socket for at most this long; past it, safety checks only. */
export const MAX_LIVE_MS = 10 * 60_000;

export type WatchOptions<T> = PollOptions<T> & {
  kind: ProgressKind;
  /** For ai_turn: only this turn's signals count. */
  turnId?: string;
  /** Injectable for tests. */
  subscribe?: typeof subscribeToProgress;
};

/**
 * Same contract as startPoll (fetch / onResult / onError, returns stop),
 * driven by signals instead of a timer. startPoll's options also set the
 * fallback poll's pace.
 *
 * Cost rules (Realtime bills peak connections and messages):
 *   * the first read runs before any socket; work that is already finished
 *     never opens one;
 *   * the socket is released while the tab is hidden, and rejoined (with a
 *     fresh read) when it is visible again;
 *   * one wait holds it for at most MAX_LIVE_MS. A job stuck longer than
 *     that gets only the 30 s visible-tab safety check;
 *   * a failed join is not retried (see attach), so a denied or unreachable
 *     channel can't loop.
 */
export function watchProgress<T>(opts: WatchOptions<T>): () => void {
  const { kind, turnId, subscribe = subscribeToProgress, ...pollOpts } = opts;
  const doc = typeof document === "undefined" ? null : document;
  const visible = () => !doc || doc.visibilityState === "visible";
  let stopped = false;
  let inFlight = false;
  let again = false;
  let safety: ReturnType<typeof setTimeout> | null = null;
  let capTimer: ReturnType<typeof setTimeout> | null = null;
  let capped = false;
  let stopFallback: (() => void) | null = null;
  let release: (() => void) | null = null;

  const clearSafety = () => {
    if (safety) clearTimeout(safety);
    safety = null;
  };
  const armSafety = () => {
    clearSafety();
    if (!stopped && !stopFallback) safety = setTimeout(() => void check(), SAFETY_CHECK_MS);
  };
  const unsubscribe = () => {
    release?.();
    release = null;
  };

  const listener: Listener = {
    onSignal: (s) => {
      if (s.kind !== kind) return;
      if (turnId && s.turn !== turnId) return;
      void check();
    },
    // Joined (or rejoined after a network blip): read once to cover any
    // signal sent before the join.
    onUp: () => void check(),
    onDown: () => {
      release = null; // attach has already dropped the channel
      if (stopped || stopFallback) return;
      clearSafety();
      stopFallback = startPoll({
        ...pollOpts,
        onResult: (r) => {
          const next = pollOpts.onResult(r);
          if (next === "stop") stop();
          return next;
        },
        onError: (e) => {
          stop();
          pollOpts.onError(e);
        },
      });
    },
  };

  function ensureSubscribed() {
    if (release || stopped || stopFallback || capped || !visible()) return;
    if (!capTimer) {
      capTimer = setTimeout(() => {
        capped = true;
        unsubscribe();
      }, MAX_LIVE_MS);
    }
    release = subscribe(listener);
  }

  function stop() {
    stopped = true;
    clearSafety();
    if (capTimer) clearTimeout(capTimer);
    stopFallback?.();
    stopFallback = null;
    unsubscribe();
    doc?.removeEventListener("visibilitychange", onVisibility);
  }

  async function check(): Promise<void> {
    if (stopped || stopFallback) return;
    if (inFlight) {
      again = true;
      return;
    }
    // Hidden: skip; the visibility listener checks on return.
    if (!visible()) return;
    inFlight = true;
    clearSafety();
    let result: T;
    try {
      result = await pollOpts.fetch();
    } catch (e) {
      inFlight = false;
      if (stopped) return;
      stop();
      pollOpts.onError(e);
      return;
    }
    inFlight = false;
    if (stopped) return;
    if (pollOpts.onResult(result) === "stop") {
      stop();
      return;
    }
    ensureSubscribed();
    if (again) {
      again = false;
      void check();
      return;
    }
    armSafety();
  }

  function onVisibility() {
    if (visible()) {
      void check(); // re-subscribes once the read says it's still waiting
    } else {
      unsubscribe();
      clearSafety();
    }
  }

  doc?.addEventListener("visibilitychange", onVisibility);
  void check();
  return stop;
}
