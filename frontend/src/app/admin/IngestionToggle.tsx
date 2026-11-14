"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { Section } from "@/components/ui/Section";
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
//
// It looks like the state it is in: a calm panel while it runs, a danger
// panel while it is paused, so a paused switch cannot be missed from across
// the room.
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
    <Section
      rule
      title="GitHub / CV ingestion"
      description="Pauses new CV parsing, new GitHub connections, and the weekly GitHub rescan — a fast stop for new AI spend. Files, connections and picks a member already has stay untouched and visible either way."
    >
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <Panel tone={status.enabled ? "default" : "danger"} className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:px-5">
        <Badge tone={status.enabled ? "success" : "danger"} dot>
          {status.enabled ? "Running" : "Paused"}
        </Badge>
        {status.lastChangedAt && (
          // suppressHydrationWarning: this formats in the viewer's local time,
          // which legitimately differs from whatever the server rendered.
          <span className="text-small text-text-muted" suppressHydrationWarning>
            Last changed {new Date(status.lastChangedAt).toLocaleString("en-GB")}
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
      </Panel>
    </Section>
  );
}
