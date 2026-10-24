"use client";

import { useEffect, useRef, useState } from "react";
import type { TurnStatusResponse } from "@/lib/ai/types";

// ════════════════════════════════════════════════════════════════════
// Polls one turn's status (AI-plan §9, §10.1, F2): never more than one
// request in flight, conditional on the last revision (an unchanged poll
// is a bodyless 304), backing off about 1 s → 2 s → 4 s with jitter, and
// paused while the tab is hidden — a fresh check runs when it comes back.
// No event stream: an SSE stream would hold a billed function open for
// the whole turn and still have to poll Postgres.
// ════════════════════════════════════════════════════════════════════

const STEPS_MS = [1000, 2000, 4000];

export function nextDelay(attempt: number, random: () => number = Math.random): number {
  const base = STEPS_MS[Math.min(attempt, STEPS_MS.length - 1)];
  // ±20% jitter so many tabs started together don't poll in lockstep.
  return Math.round(base * (0.8 + 0.4 * random()));
}

export function useTurnPolling(turnId: string | null, onFinished: (status: TurnStatusResponse) => void) {
  // Keyed by turn, so a new turn never shows the last one's stage.
  const [state, setState] = useState<{ turnId: string; status: TurnStatusResponse } | null>(null);
  const finishedRef = useRef(onFinished);
  useEffect(() => { finishedRef.current = onFinished; });

  // react-doctor-disable-next-line effect-needs-cleanup -- cleanup exists (cancelled flag, clearTimeout, controller.abort, removeEventListener) and is correct; analyzer can't trace it through the poll/schedule closures
  useEffect(() => {
    if (!turnId) return;
    const id: string = turnId;
    let cancelled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let etag: string | null = null;
    let last: TurnStatusResponse | null = null;

    const schedule = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(poll, ms);
    };

    let controller: AbortController | null = null;

    async function poll() {
      if (cancelled || inFlight) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return; // resumed on visibilitychange
      inFlight = true;
      controller = new AbortController();
      try {
        const res = await fetch(`/api/ai/turns/${id}`, {
          headers: etag ? { "If-None-Match": etag } : {},
          cache: "no-store",
          signal: controller.signal,
        });
        if (cancelled) return;
        if (res.status === 304) {
          attempt += 1;
        } else if (res.ok) {
          etag = res.headers.get("ETag");
          const body = (await res.json()) as TurnStatusResponse;
          if (cancelled) return;
          // Progress resets the backoff; silence lengthens it.
          attempt = last && last.revision === body.revision ? attempt + 1 : 0;
          last = body;
          setState({ turnId: id, status: body });
          if (body.finished) {
            finishedRef.current(body);
            return;
          }
        } else {
          attempt += 1;
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) attempt += 1;
      } finally {
        inFlight = false;
      }
      if (!cancelled) schedule(nextDelay(attempt));
    }

    const onVisible = () => {
      if (document.visibilityState === "visible" && !cancelled) {
        attempt = 0;
        schedule(0);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    schedule(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [turnId]);

  return state && state.turnId === turnId ? state.status : null;
}
