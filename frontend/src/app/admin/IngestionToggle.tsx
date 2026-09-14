"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/forms/Banners";
import { setIngestionEnabled, type IngestionStatus } from "./actions";

// ════════════════════════════════════════════════════════════════════
// Foundry · GitHub/CV ingestion kill switch, in the admin panel
//
// Until this, github_cv_ingestion_enabled (20260911000003) could only be
// flipped by hand in the Supabase SQL Editor. This is the "2am problem"
// switch — it needs to be one click, not a remembered UPDATE statement,
// which is the whole reason it skips a confirm dialog in both
// directions: a kill switch that makes you confirm before it kills
// something is a worse kill switch.
//
// What it actually pauses (20260911000003, 20260914000001): new CV
// uploads' LLM parsing, new GitHub connections, and the weekly GitHub
// rescan. What it does NOT touch, ever: files already on disk, GitHub
// connections already made, or a member's already-picked showcase
// repos — those stay fully visible and editable regardless of this
// switch, by design.
// ════════════════════════════════════════════════════════════════════

export default function IngestionToggle({ initial }: { initial: IngestionStatus }) {
  const [status, setStatus] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const toggle = () => {
    setError("");
    const next = !status.enabled;
    startTransition(async () => {
      const res = await setIngestionEnabled(next);
      if (!res.ok) { setError(res.error); return; }
      setStatus({ enabled: next, lastChangedAt: new Date().toISOString(), lastChangedBy: "you" });
    });
  };

  return (
    <div className="mt-12 rule-draw pt-6">
      <p className="label-wide text-text-secondary mb-3">GitHub / CV ingestion</p>
      <p className="text-[0.8rem] text-text-muted mb-4 leading-relaxed">
        Pauses new CV parsing, new GitHub connections, and the weekly GitHub rescan — a fast stop
        for new AI spend. Files, connections and picks a member already has stay untouched and
        visible either way.
      </p>
      {error && <div className="mb-3"><ErrorBanner>{error}</ErrorBanner></div>}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border-strong bg-white/[0.03] p-4">
        <span
          className={
            "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-0.5 text-[0.75rem] font-semibold " +
            (status.enabled
              ? "border border-border text-text-muted"
              : "border border-[#ff4d4d]/40 bg-[#ff4d4d]/15 text-[#ff8080]")
          }
        >
          {status.enabled ? "Running" : "Paused"}
        </span>
        {status.lastChangedAt && (
          <span className="text-[0.75rem] text-text-muted">
            Last changed {new Date(status.lastChangedAt).toLocaleString()}
            {status.lastChangedBy ? ` by ${status.lastChangedBy}` : ""}
          </span>
        )}
        <Button
          type="button"
          variant={status.enabled ? "dangerGhost" : "primary"}
          size="sm"
          loading={pending}
          onClick={toggle}
          className="ml-auto"
        >
          {status.enabled ? "Pause ingestion" : "Resume ingestion"}
        </Button>
      </div>
    </div>
  );
}
