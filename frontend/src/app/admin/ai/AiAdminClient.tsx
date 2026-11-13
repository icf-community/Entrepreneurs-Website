"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Definition, DefinitionList } from "@/components/ui/DefinitionList";
import { FormActions } from "@/components/ui/FormActions";
import { FormSection } from "@/components/ui/FormSection";
import { Input } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";
import { Stat, StatGrid } from "@/components/ui/Stat";
import { useToast } from "@/components/ui/Toast";
import { Field } from "@/components/forms/Field";
import { formatDate } from "@/lib/dates";
import { rebuildAiIndex, setAiFlag, setAiLimits, setOpportunityAudience } from "./actions";

export type AiOverview = {
  refusals_24h: Record<string, number>;
  polls_24h: number;
  provider_errors_24h: Record<string, number>;
  queue_wait_ms_24h: { p50: number | null; p95: number | null };
  provider_in_flight: number;
  cost_today: { reserved: number; settled: number; projected: number };
  is_operator: boolean;
  flags: { ai_enabled: boolean; recruiter: boolean; network: boolean; opportunities: boolean };
  limits: {
    active_turn_ceiling: number;
    provider_request_ceiling: number;
    queue_capacity: number;
    matching_daily_cap_micro: number;
    member_daily_cap_micro: number;
    ingestion_daily_cap_micro: number;
    controller_daily_cap_micro: number;
    updated_at: string;
    reason: string | null;
  };
  spend_today: { matching: number; ingestion: number; unreconciled: number };
  prices_confirmed: boolean;
  turns_24h: Record<string, number>;
  outcomes_24h: Record<string, number>;
  queue: { queued: number; running: number; oldest_queued_seconds: number | null };
  latency_ms_24h: { p50: number | null; p95: number | null };
  opted_in: { recruiter: number; network: number };
  requirements: Record<string, number>;
  jobs_needing_audience: number;
  recent_changes: { action: string; notes: string | null; at: string }[];
};

type JobRow = { id: string; title: string; company: string; deadline: string; poster: string };

/** One action on this page: which control is busy, what to call, and the toast for success (a failure toasts its own error). */
type Run = (label: string, fn: () => Promise<{ ok: boolean; error?: string }>, success: string) => Promise<void>;

const dollars = (micro: number) => `$${(micro / 1_000_000).toFixed(2)}`;

const FLAG_ROWS: { key: string; field: keyof AiOverview["flags"]; label: string }[] = [
  { key: "ai_enabled", field: "ai_enabled", label: "AI (master switch)" },
  { key: "ai_recruiter_enabled", field: "recruiter", label: "Find candidates" },
  { key: "ai_network_enabled", field: "network", label: "Build your network" },
  { key: "ai_opportunities_enabled", field: "opportunities", label: "Find opportunities" },
];

export default function AiAdminClient({ overview: o, needingAudience }: { overview: AiOverview; needingAudience: JobRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const run: Run = async (label, fn, success) => {
    setBusy(label);
    const res = await fn();
    setBusy(null);
    if (res.ok) { toast(success, "success"); router.refresh(); } else toast(res.error ?? "That didn't work.", "error");
  };

  return (
    <div className="grid gap-6">
      {/* The one thing that stops AI search outright goes first, above the numbers it makes meaningless. */}
      {!o.prices_confirmed && (
        <Notice tone="danger">
          Model prices aren&apos;t confirmed, so AI search refuses to run. Confirm them in ai_private.model_prices first.
        </Notice>
      )}

      <HealthStats o={o} />
      <SwitchesPanel o={o} reason={reason} onReason={setReason} busy={busy} run={run} />
      <LimitsPanel o={o} reason={reason} busy={busy} run={run} />
      <LastDayPanel o={o} />
      <AudiencePanel jobs={needingAudience} busy={busy} run={run} />
    </div>
  );
}

// ─── Health: fifteen counters on one ruled sheet ────────────────────

// A value that has a limit is drawn against it (a ring that fills); the words say the same, so nothing depends on the drawing.
function HealthStats({ o }: { o: AiOverview }) {
  const { limits, spend_today: spend } = o;
  return (
    <StatGrid min="sm">
      <Stat size="sm" label="Matching spend today" value={`${dollars(spend.matching)} of ${dollars(limits.matching_daily_cap_micro)}`}
        meter={{ value: spend.matching, max: limits.matching_daily_cap_micro }} tone={spend.matching > limits.matching_daily_cap_micro ? "danger" : "default"} />
      <Stat size="sm" label="Ingestion spend today" value={`${dollars(spend.ingestion)} of ${dollars(limits.ingestion_daily_cap_micro)}`}
        meter={{ value: spend.ingestion, max: limits.ingestion_daily_cap_micro }} tone={spend.ingestion > limits.ingestion_daily_cap_micro ? "danger" : "default"} />
      <Stat size="sm" label="Unreconciled calls" value={String(spend.unreconciled)} />
      <Stat size="sm" label="Provider requests" value={`${o.provider_in_flight} of ${limits.provider_request_ceiling}`}
        meter={{ value: o.provider_in_flight, max: limits.provider_request_ceiling }} />
      <Stat size="sm" label="Queue wait (24h)" value={o.queue_wait_ms_24h.p50 == null ? "—" : `p50 ${Math.round(o.queue_wait_ms_24h.p50)}ms · p95 ${Math.round(o.queue_wait_ms_24h.p95 ?? 0)}ms`} />
      <Stat size="sm" label="Status polls (24h)" value={String(o.polls_24h)} />
      <Stat size="sm" label="Reserved / uncertain cost" value={dollars(o.cost_today.reserved)} />
      <Stat size="sm" label="Settled cost today" value={dollars(o.cost_today.settled)} />
      <Stat size="sm" label="Projected daily cost (current pace)" value={dollars(o.cost_today.projected)} />
      <Stat size="sm" label="Queue" value={`${o.queue.queued} waiting · ${o.queue.running} running`} />
      <Stat size="sm" label="Oldest waiting" value={o.queue.oldest_queued_seconds == null ? "—" : `${o.queue.oldest_queued_seconds}s`} />
      <Stat size="sm" label="Result time (24h)" value={o.latency_ms_24h.p50 == null ? "—" : `p50 ${Math.round(o.latency_ms_24h.p50 / 1000)}s · p95 ${Math.round((o.latency_ms_24h.p95 ?? 0) / 1000)}s`} />
      <Stat size="sm" label="Opted in: recruiters" value={String(o.opted_in.recruiter)} />
      <Stat size="sm" label="Opted in: network" value={String(o.opted_in.network)} />
      <Stat size="sm" label="Jobs needing an audience" value={String(o.jobs_needing_audience)} tone={o.jobs_needing_audience > 0 ? "lit" : "default"} />
    </StatGrid>
  );
}

// ─── Switches ───────────────────────────────────────────────────────

function SwitchesPanel({ o, reason, onReason, busy, run }: {
  o: AiOverview;
  reason: string;
  onReason: (next: string) => void;
  busy: string | null;
  run: Run;
}) {
  return (
    <FormSection as="section" title="Switches" description={o.is_operator ? undefined : "Only AI operators can change these."}>
      <Field label="Reason (recorded with every change)">
        <Input value={reason} onChange={(e) => onReason(e.target.value)} maxLength={300} />
      </Field>
      <ul className="divide-y divide-border-subtle">
        {FLAG_ROWS.map((f) => {
          const on = o.flags[f.field];
          return (
            <li key={f.key} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              {/* a point of light while it is on, a dim ring while it is off; the word is beside it. The label stays one run of text that is a
                  direct child of the row (the e2e finds the row from it). */}
              <span aria-hidden className={`size-2 shrink-0 rounded-full ${on ? "bg-lit" : "border border-border-strong"}`} />
              <span className="min-w-0 flex-1 text-body">{f.label}: <strong>{on ? "on" : "off"}</strong></span>
              <Button size="sm" variant={on ? "dangerGhost" : "ghost"} disabled={!o.is_operator} loading={busy === f.key}
                onClick={() => run(f.key, () => setAiFlag(f.key, !on, reason), `${f.label} ${on ? "off" : "on"}.`)}>
                {on ? "Turn off" : "Turn on"}
              </Button>
            </li>
          );
        })}
      </ul>
    </FormSection>
  );
}

// ─── Limits ─────────────────────────────────────────────────────────

function LimitsPanel({ o, reason, busy, run }: { o: AiOverview; reason: string; busy: string | null; run: Run }) {
  const [ceiling, setCeiling] = useState(String(o.limits.active_turn_ceiling));
  const [dailyCap, setDailyCap] = useState(String(o.limits.matching_daily_cap_micro / 1_000_000));
  const [memberCap, setMemberCap] = useState(String(o.limits.member_daily_cap_micro / 1_000_000));

  return (
    <FormSection
      as="section"
      title="Limits"
      description="Raise the active-turn ceiling at most 25% at a time, and only when the queue is persistently full with healthy headroom."
    >
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Active turns">
          <Input type="number" min={1} max={50} value={ceiling} onChange={(e) => setCeiling(e.target.value)} />
        </Field>
        <Field label="Matching cap per day ($)">
          <Input type="number" min={0} step="0.5" value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} />
        </Field>
        <Field label="Per member per day ($)">
          <Input type="number" min={0} step="0.05" value={memberCap} onChange={(e) => setMemberCap(e.target.value)} />
        </Field>
      </div>
      <FormActions>
        <Button size="md" disabled={!o.is_operator} loading={busy === "limits"}
          onClick={() => run("limits", () => setAiLimits(Number(ceiling), Math.round(Number(dailyCap) * 1_000_000),
            Math.round(Number(memberCap) * 1_000_000), reason), "Limits saved.")}>
          Save limits
        </Button>
        <Button size="md" variant="ghost" disabled={!o.is_operator} loading={busy === "rebuild"}
          onClick={() => run("rebuild", async () => { const r = await rebuildAiIndex(); return r.ok ? { ok: true } : r; }, "Rebuild queued.")}>
          Rebuild search index
        </Button>
      </FormActions>
    </FormSection>
  );
}

// ─── The last day ───────────────────────────────────────────────────

function LastDayPanel({ o }: { o: AiOverview }) {
  const counts = [
    ...Object.entries(o.refusals_24h).map(([k, v]) => ({ key: `r-${k}`, term: `Admission: ${k.replaceAll("_", " ")}`, v })),
    ...Object.entries(o.provider_errors_24h).map(([k, v]) => ({ key: `p-${k}`, term: `Provider: ${k.replaceAll("_", " ")}`, v })),
    ...Object.entries(o.turns_24h).map(([k, v]) => ({ key: k, term: k, v })),
    ...Object.entries(o.outcomes_24h).map(([k, v]) => ({ key: `o-${k}`, term: k, v })),
  ];
  return (
    <FormSection as="section" title="Last 24 hours">
      {counts.length > 0 && (
        <DefinitionList min="sm" strong>
          {counts.map((c) => <Definition key={c.key} term={c.term}><span className="data">{c.v}</span></Definition>)}
        </DefinitionList>
      )}
      {o.recent_changes.length > 0 && (
        <ul className="divide-y divide-border-subtle text-body text-text-secondary">
          {o.recent_changes.map((c) => (
            <li key={`${c.at}-${c.action}`} className="py-2.5 first:pt-0 last:pb-0">{formatDate(c.at)} · {c.action} · {c.notes}</li>
          ))}
        </ul>
      )}
    </FormSection>
  );
}

// ─── Jobs that need an audience ─────────────────────────────────────

const AUDIENCES = [
  { value: "students", label: "Students" },
  { value: "graduates", label: "Graduates" },
  { value: "both", label: "Both" },
] as const;

function AudiencePanel({ jobs, busy, run }: { jobs: JobRow[]; busy: string | null; run: Run }) {
  return (
    <FormSection as="section" title="Jobs that need an audience" description="Members can't see these until someone chooses who they're for.">
      {jobs.length === 0 ? (
        <EmptyState bare size="compact" icon="check">None.</EmptyState>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {jobs.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <span className="min-w-0 text-body text-text-muted">
                <Link href={`/opportunities/${j.id}`} className="text-text-primary underline underline-offset-[3px] decoration-border-strong transition-colors hover:decoration-accent">{j.title}</Link> · {j.company} · {j.poster} · closes {formatDate(j.deadline)}
              </span>
              <span className="flex flex-wrap gap-2">
                {AUDIENCES.map((a) => (
                  <Button key={a.value} size="sm" variant="ghost" loading={busy === `${j.id}:${a.value}`}
                    onClick={() => run(`${j.id}:${a.value}`, () => setOpportunityAudience(j.id, a.value), "Audience set.")}>
                    {a.label}
                  </Button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </FormSection>
  );
}
