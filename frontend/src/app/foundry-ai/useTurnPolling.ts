"use client";

import { useEffect, useRef, useState } from "react";
import type { TurnStatusResponse } from "@/lib/ai/types";
import { watchProgress } from "@/lib/realtime/progress";

// ════════════════════════════════════════════════════════════════════
// Follows one turn's status (AI-plan §9, §10.1, F2). Every revision bump
// on the turn sends a signal on the member's private Realtime topic
// (20261111000001), and this re-reads the status route only then, so a
// turn costs one read per stage instead of one every 1–4 s. Reads stay
// conditional on the last revision (an unchanged read is a bodyless 304).
// Paused while the tab is hidden, with a fresh read when it comes back.
//
// Still no SSE: an event stream would hold a billed Vercel function open
// for the whole turn. The Realtime socket goes to Supabase, not to us, and
// lib/realtime/progress closes it once the turn finishes. If the channel
// can't join, the old 1 s → 4 s backoff poll takes over.
// ════════════════════════════════════════════════════════════════════

const RETRY_MS = [1000, 2000];

export function useTurnPolling(turnId: string | null, onFinished: (status: TurnStatusResponse) => void) {
  // Keyed by turn, so a new turn never shows the last one's stage.
  const [state, setState] = useState<{ turnId: string; status: TurnStatusResponse } | null>(null);
  const finishedRef = useRef(onFinished);
  useEffect(() => { finishedRef.current = onFinished; });

  useEffect(() => {
    if (!turnId) return;
    const id: string = turnId;
    let etag: string | null = null;
    const controller = new AbortController();

    // Never throws. A 304 is "no news"; a failed read (429, 5xx, network)
    // is retried twice, because the read after a signal may be the one
    // that sees the turn finish, and the next safety check is 30 s away.
    async function read(): Promise<TurnStatusResponse | null> {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const res = await fetch(`/api/ai/turns/${id}`, {
            headers: etag ? { "If-None-Match": etag } : {},
            cache: "no-store",
            signal: controller.signal,
          });
          if (res.status === 304) return null;
          if (res.ok) {
            etag = res.headers.get("ETag");
            return (await res.json()) as TurnStatusResponse;
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return null;
        }
        if (attempt >= RETRY_MS.length || controller.signal.aborted) return null;
        await new Promise((r) => setTimeout(r, RETRY_MS[attempt]));
      }
    }

    const stop = watchProgress<TurnStatusResponse | null>({
      kind: "ai_turn",
      turnId: id,
      fetch: read,
      onResult: (body) => {
        if (!body) return "continue";
        setState({ turnId: id, status: body });
        if (body.finished) {
          finishedRef.current(body);
          return "stop";
        }
        return "continue";
      },
      onError: () => {},
      baseMs: 1000,
      maxMs: 4000,
    });
    return () => {
      stop();
      controller.abort();
    };
  }, [turnId]);

  return state && state.turnId === turnId ? state.status : null;
}
