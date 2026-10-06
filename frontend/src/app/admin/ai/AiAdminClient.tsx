"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { inputCls } from "@/components/forms/styles";
import { formatDate } from "@/lib/dates";
import { rebuildAiIndex, setAiFlag, setAiLimits, setOpportunityAudience } from "./actions";

export type AiOverview = {
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
  const [ceiling, setCeiling] = useState(String(o.limits.active_turn_ceiling));
  const [dailyCap, setDailyCap] = useState(String(o.limits.matching_daily_cap_micro / 1_000_000));
  const [memberCap, setMemberCap] = useState(String(o.limits.member_daily_cap_micro / 1_000_000));

  const run = async (label: string, fn: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    setBusy(label);
    const res = await fn();
    setBusy(null);
    if (res.ok) { toast(success, "success"); router.refresh(); } else toast(res.error ?? "That didn't work.", "error");
  };

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Matching spend today" value={`${dollars(o.spend_today.matching)} of ${dollars(o.limits.matching_daily_cap_micro)}`} />
        <Stat label="Ingestion spend today" value={`${dollars(o.spend_today.ingestion)} of ${dollars(o.limits.ingestion_daily_cap_micro)}`} />
        <Stat label="Unreconciled calls" value={String(o.spend_today.unreconciled)} />
        <Stat label="Queue" value={`${o.queue.queued} waiting · ${o.queue.running} running`} />
        <Stat label="Oldest waiting" value={o.queue.oldest_queued_seconds == null ? "—" : `${o.queue.oldest_queued_seconds}s`} />
        <Stat label="Result time (24h)" value={o.latency_ms_24h.p50 == null ? "—" : `p50 ${Math.round(o.latency_ms_24h.p50 / 1000)}s · p95 ${Math.round((o.latency_ms_24h.p95 ?? 0) / 1000)}s`} />
        <Stat label="Opted in: recruiters" value={String(o.opted_in.recruiter)} />
        <Stat label="Opted in: network" value={String(o.opted_in.network)} />
        <Stat label="Jobs needing an audience" value={String(o.jobs_needing_audience)} />
      </section>

      {!o.prices_confirmed && (
        <p className="rounded-lg border border-[#ff4d4d]/40 px-4 py-3 text-[0.85rem] text-[#ff8080]">
          Model prices aren&apos;t confirmed, so AI search refuses to run. Confirm them in ai_private.model_prices first.
        </p>
      )}

      <section className="rounded-2xl border border-border bg-bg-card p-6">
        <h2 className="text-[0.95rem] font-medium">Switches</h2>
        {!o.is_operator && <p className="mt-1 text-[0.8rem] text-text-muted">Only AI operators can change these.</p>}
        <label className="mt-4 block">
          <span className="text-[0.75rem] text-text-muted">Reason (recorded with every change)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={`${inputCls} mt-1`} />
        </label>
        <ul className="mt-4 space-y-2">
          {FLAG_ROWS.map((f) => {
            const on = o.flags[f.field];
            return (
              <li key={f.key} className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-2">
                <span className="text-[0.85rem]">{f.label}: <strong>{on ? "on" : "off"}</strong></span>
                <Button size="sm" variant={on ? "dangerGhost" : "ghost"} disabled={!o.is_operator} loading={busy === f.key}
                  onClick={() => run(f.key, () => setAiFlag(f.key, !on, reason), `${f.label} ${on ? "off" : "on"}.`)}>
                  {on ? "Turn off" : "Turn on"}
                </Button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-2xl border border-border bg-bg-card p-6">
        <h2 className="text-[0.95rem] font-medium">Limits</h2>
        <p className="mt-1 text-[0.8rem] text-text-muted">
          Raise the active-turn ceiling at most 25% at a time, and only when the queue is persistently full with healthy headroom.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block"><span className="text-[0.75rem] text-text-muted">Active turns</span>
            <input type="number" min={1} max={50} value={ceiling} onChange={(e) => setCeiling(e.target.value)} className={`${inputCls} mt-1`} /></label>
          <label className="block"><span className="text-[0.75rem] text-text-muted">Matching cap per day ($)</span>
            <input type="number" min={0} step="0.5" value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} className={`${inputCls} mt-1`} /></label>
          <label className="block"><span className="text-[0.75rem] text-text-muted">Per member per day ($)</span>
            <input type="number" min={0} step="0.05" value={memberCap} onChange={(e) => setMemberCap(e.target.value)} className={`${inputCls} mt-1`} /></label>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button size="sm" disabled={!o.is_operator} loading={busy === "limits"}
            onClick={() => run("limits", () => setAiLimits(Number(ceiling), Math.round(Number(dailyCap) * 1_000_000),
              Math.round(Number(memberCap) * 1_000_000), reason), "Limits saved.")}>
            Save limits
          </Button>
          <Button size="sm" variant="ghost" disabled={!o.is_operator} loading={busy === "rebuild"}
            onClick={() => run("rebuild", async () => { const r = await rebuildAiIndex(); return r.ok ? { ok: true } : r; }, "Rebuild queued.")}>
            Rebuild search index
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-bg-card p-6">
        <h2 className="text-[0.95rem] font-medium">Last 24 hours</h2>
        <dl className="mt-3 grid gap-2 text-[0.8rem] sm:grid-cols-2">
          {Object.entries(o.turns_24h).map(([k, v]) => <div key={k}><dt className="inline text-text-muted">{k}: </dt><dd className="inline">{v}</dd></div>)}
          {Object.entries(o.outcomes_24h).map(([k, v]) => <div key={`o-${k}`}><dt className="inline text-text-muted">{k}: </dt><dd className="inline">{v}</dd></div>)}
        </dl>
        {o.recent_changes.length > 0 && (
          <ul className="mt-4 space-y-1 text-[0.8rem] text-text-secondary">
            {o.recent_changes.map((c, i) => <li key={i}>{formatDate(c.at)} · {c.action} · {c.notes}</li>)}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-bg-card p-6">
        <h2 className="text-[0.95rem] font-medium">Jobs that need an audience</h2>
        <p className="mt-1 text-[0.8rem] text-text-muted">Members can&apos;t see these until someone chooses who they&apos;re for.</p>
        {needingAudience.length === 0 ? (
          <p className="mt-3 text-[0.8rem] text-text-muted">None.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {needingAudience.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-2">
                <span className="text-[0.85rem]">
                  <Link href={`/opportunities/${j.id}`} className="underline">{j.title}</Link> · {j.company} · {j.poster} · closes {formatDate(j.deadline)}
                </span>
                <span className="flex gap-2">
                  {(["students", "graduates", "both"] as const).map((a) => (
                    <Button key={a} size="sm" variant="ghost" loading={busy === `${j.id}:${a}`}
                      onClick={() => run(`${j.id}:${a}`, () => setOpportunityAudience(j.id, a), "Audience set.")}>
                      {a === "both" ? "Both" : a === "students" ? "Students" : "Graduates"}
                    </Button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-bg-card p-4">
      <div className="text-[0.7rem] uppercase tracking-wider text-text-muted">{label}</div>
      <div className="mt-1 text-[0.95rem] text-text-primary">{value}</div>
    </div>
  );
}
