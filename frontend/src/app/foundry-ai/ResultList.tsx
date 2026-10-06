"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ViewProfileButton } from "@/components/members/ViewProfileButton";
import { externalHref } from "@/lib/safeUrl";
import { formatDate } from "@/lib/dates";
import { audienceLabel, type Audience } from "@/lib/listings/audience";
import type { AiMode, CoverageRow, ResultCard } from "@/lib/ai/types";

// ════════════════════════════════════════════════════════════════════
// AI results (AI-plan §7, §12). Each card answers "why this one", "what is
// missing or unknown" and "what can I do next". The number is an evidence
// match for these criteria, never a probability or a judgement of the
// person; eligibility (the tier) is shown separately and ranks first.
// View profile opens the existing MemberDialog; Connect lives only there
// (F16). Results arrive together, never re-ordered while you read.
// ════════════════════════════════════════════════════════════════════

const STATE_MARK: Record<CoverageRow["state"], { mark: string; label: string; cls: string }> = {
  met: { mark: "✓", label: "shown", cls: "text-text-primary" },
  related: { mark: "≈", label: "related experience", cls: "text-text-secondary" },
  unknown: { mark: "?", label: "not enough evidence", cls: "text-text-muted" },
  not_evidenced: { mark: "–", label: "not shown", cls: "text-text-muted" },
};

function tierLabel(mode: AiMode, tier: ResultCard["tier"]): string {
  if (mode === "opportunities") {
    return tier === "meets" ? "You show every requirement listed"
      : tier === "possible" ? "Some requirements aren't clear from your profile"
      : "You don't show every requirement yet";
  }
  return tier === "meets" ? "Meets every must-have"
    : tier === "possible" ? "Some must-haves aren't clear from the profile"
    : "Doesn't show every must-have";
}

export function ResultList({ mode, cards, partial }: { mode: AiMode; cards: ResultCard[]; partial: boolean }) {
  const strong = cards.filter((c) => c.tier !== "partial");
  const weaker = cards.filter((c) => c.tier === "partial");
  return (
    <div className="space-y-6">
      {partial && (
        <p className="rounded-lg border border-border px-3 py-2 text-[0.8rem] text-text-muted">
          Some profiles couldn&apos;t be checked this time, so this list may be incomplete.
        </p>
      )}
      {strong.length > 0 && (
        <ol className="space-y-3" aria-label="Matches">
          {strong.map((c) => <li key={c.slot}><Card mode={mode} card={c} /></li>)}
        </ol>
      )}
      {weaker.length > 0 && (
        <section aria-labelledby="ai-partial-heading">
          <h3 id="ai-partial-heading" className="mb-2 text-[0.7rem] uppercase tracking-wider text-text-muted">
            {mode === "opportunities" ? "Jobs you partly match" : "Partly matching"}
          </h3>
          <ol className="space-y-3">
            {weaker.map((c) => <li key={c.slot}><Card mode={mode} card={c} /></li>)}
          </ol>
        </section>
      )}
    </div>
  );
}

function Card({ mode, card }: { mode: AiMode; card: ResultCard }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  return (
    <article className="rounded-2xl border border-border bg-bg-card p-5">
      <div className="flex items-start gap-4">
        {card.kind === "member" && (
          card.avatarUrl
            // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not a static asset
            ? <img src={card.avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover border border-border" />
            : <div aria-hidden className="h-12 w-12 shrink-0 rounded-full border border-border bg-white/[0.04]" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[1rem] font-medium text-text-primary">{card.title}</h3>
            {card.change === "new" && <Pill>New</Pill>}
            {card.change === "updated" && <Pill>Updated</Pill>}
            {card.stale && <Pill>Profile changed since this search</Pill>}
          </div>
          {card.subtitle && <p className="mt-0.5 text-[0.8rem] text-text-muted">{card.subtitle}</p>}
          <p className="mt-2 text-[0.8rem] text-text-secondary">{tierLabel(mode, card.tier)}</p>
        </div>
        {card.score != null && (
          <div className="shrink-0 text-right">
            <div className="font-display text-[1.4rem] leading-none text-text-primary">{card.score}</div>
            <div className="mt-1 text-[0.65rem] uppercase tracking-wider text-text-muted">evidence match</div>
          </div>
        )}
      </div>

      <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Criteria">
        {card.coverage.map((row) => {
          const s = STATE_MARK[row.state];
          return (
            <li key={row.atom} className={`rounded-lg border border-border-strong px-2.5 py-1 text-[0.75rem] ${s.cls}`}>
              <span aria-hidden>{s.mark} </span>
              {row.label ?? row.free_text ?? row.concept}
              <span className="sr-only">: {s.label}{row.required ? ", must have" : ""}</span>
              {row.required && <span aria-hidden className="text-text-muted"> · must</span>}
            </li>
          );
        })}
      </ul>

      {card.kind === "opportunity" && card.job && (
        <JobFacts card={card} />
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {card.kind === "member" ? (
          <ViewProfileButton memberId={card.targetId} />
        ) : (
          <Link
            href={`/opportunities/${card.targetId}`}
            className="inline-flex items-center rounded-lg border border-border-strong bg-white/[0.05] px-4 py-2 text-[0.8rem] text-text-primary no-underline hover:border-accent"
          >
            View job
          </Link>
        )}
        {card.evidence.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center rounded-lg border border-border-strong bg-white/[0.05] px-4 py-2 text-[0.8rem] text-text-primary hover:border-accent cursor-pointer"
          >
            {open ? "Hide evidence" : "Why this match"}
          </button>
        )}
      </div>
      {open && (
        <ul id={detailsId} className="mt-3 space-y-2 border-t border-border-subtle pt-3">
          {card.evidence.map((e, i) => (
            <li key={i} className="text-[0.8rem] text-text-secondary">
              <span className="mr-1 text-[0.65rem] uppercase tracking-wider text-text-muted">
                {e.from_cv ? "From CV" : e.kind.startsWith("github") ? "GitHub" : e.kind === "self_reported" ? "Self-reported" : "Profile"}
              </span>
              {e.text}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function JobFacts({ card }: { card: ResultCard }) {
  const job = card.job!;
  const audience = audienceLabel(job.audience as Audience | null);
  const preference = card.components.preference;
  return (
    <div className="mt-4 space-y-2 text-[0.8rem] text-text-secondary">
      <p>
        {job.locationType}{job.locationText ? ` · ${job.locationText}` : ""} · {job.pay} · Apply by {formatDate(job.deadline)}
        {audience ? ` · ${audience}` : ""}
      </p>
      {preference === "match" && <p className="text-text-muted">Matches your location preference.</p>}
      {preference === "mismatch" && <p className="text-text-muted">Doesn&apos;t match your location preference.</p>}
      {job.sparse && <p className="text-text-muted">Limited detail — you may want to ask the poster.</p>}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        {job.applied && <Pill>Applied</Pill>}
        {job.applyMethod === "link" && job.applyUrl ? (
          <a
            href={externalHref(job.applyUrl)}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-[0.8rem] font-medium text-bg-primary no-underline hover:bg-accent-dim"
          >
            Apply ↗
          </a>
        ) : job.contactEmail ? (
          <a
            href={`mailto:${job.contactEmail}?subject=${encodeURIComponent(card.title)}`}
            className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-[0.8rem] font-medium text-bg-primary no-underline hover:bg-accent-dim"
          >
            Email to apply ↗
          </a>
        ) : (
          <span className="text-text-muted">The job page says how to apply.</span>
        )}
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-border-strong px-2 py-0.5 text-[0.65rem] uppercase tracking-wider text-text-secondary">
      {children}
    </span>
  );
}
