"use client";

import { useId, useState } from "react";
import { ViewProfileButton } from "@/components/members/ViewProfileButton";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Collapse } from "@/components/ui/Disclosure";
import { Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";
import { Popover } from "@/components/ui/Popover";
import { Disc } from "@/design-system/icons/Disc";
import { Icon } from "@/design-system/icons/Icon";
import type { IconName } from "@/design-system/icons/names";
import { externalHref, mailtoHref } from "@/lib/safeUrl";
import { formatDate } from "@/lib/dates";
import { audienceLabel, type Audience } from "@/lib/listings/audience";
import { reportMatch, type MatchReportReason } from "./actions";
import { useToast } from "@/components/ui/Toast";
import type { AiMode, CoverageRow, ResultCard } from "@/lib/ai/types";

// ════════════════════════════════════════════════════════════════════
// AI results (AI-plan §7, §12). Each card answers "why this one", "what is
// missing or unknown" and "what can I do next". The number is an evidence
// match for these criteria, never a probability or a judgement of the
// person; eligibility (the tier) is shown separately and ranks first.
// View profile opens the existing MemberDialog; Connect lives only there
// (F16). Results arrive together, never re-ordered while you read.
//
// Drawn as a column of panels: who (a ring with the photo, or the briefcase
// for a job), the words and the tier, the evidence match at the right; what is
// met as a row of marks; what you can do; and "Why this match" opening the
// evidence beneath. The marks that were ✓ ≈ ? – are icons, the words stay.
// ════════════════════════════════════════════════════════════════════

const STATE_MARK: Record<CoverageRow["state"], { icon: IconName; label: string; cls: string }> = {
  met: { icon: "check", label: "shown", cls: "text-text-primary" },
  related: { icon: "approx", label: "related experience", cls: "text-text-secondary" },
  unknown: { icon: "help", label: "not enough evidence", cls: "text-text-muted" },
  not_evidenced: { icon: "minus", label: "not shown", cls: "text-text-muted" },
};

const TIER_ICON: Record<ResultCard["tier"], IconName> = { meets: "check", possible: "help", partial: "minus" };

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

export function ResultList({ mode, turnId, cards, partial }: { mode: AiMode; turnId: string; cards: ResultCard[]; partial: boolean }) {
  const strong = cards.filter((c) => c.tier !== "partial");
  const weaker = cards.filter((c) => c.tier === "partial");
  return (
    <div className="space-y-6">
      {partial && (
        <Notice tone="lit">
          Some profiles couldn&apos;t be checked this time, so this list may be incomplete.
        </Notice>
      )}
      {strong.length > 0 && (
        <ol className="space-y-4" aria-label="Matches">
          {strong.map((c) => <li key={c.slot}><Card mode={mode} turnId={turnId} card={c} /></li>)}
        </ol>
      )}
      {weaker.length > 0 && (
        <section aria-labelledby="ai-partial-heading">
          <h3 id="ai-partial-heading" className="mb-3 font-display text-lead text-text-secondary">
            {mode === "opportunities" ? "Jobs you partly match" : "Partly matching"}
          </h3>
          <ol className="space-y-4">
            {weaker.map((c) => <li key={c.slot}><Card mode={mode} turnId={turnId} card={c} /></li>)}
          </ol>
        </section>
      )}
    </div>
  );
}

function Card({ mode, turnId, card }: { mode: AiMode; turnId: string; card: ResultCard }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  return (
    <Panel as="article" className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <CardAvatar card={card} />
        <CardSummary mode={mode} card={card} />
        <CardScore card={card} />
      </div>

      <CoverageList coverage={card.coverage} />

      {card.kind === "opportunity" && card.job && (
        <JobFacts card={card} />
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {card.kind === "opportunity" && card.job && <JobApply card={card} />}
        {card.kind === "member" ? (
          <ViewProfileButton memberId={card.targetId} />
        ) : (
          <ButtonLink href={`/opportunities/${card.targetId}`} variant="ghost" size="sm">
            View job
          </ButtonLink>
        )}
        {card.evidence.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide evidence" : "Why this match"}
            <Icon name="chevron-down" size={16} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </Button>
        )}
        <ReportControl turnId={turnId} targetId={card.targetId} />
      </div>
      <Collapse id={detailsId} open={open} lazy>
        <EvidenceList evidence={card.evidence} />
      </Collapse>
    </Panel>
  );
}

function CardAvatar({ card }: { card: ResultCard }) {
  // A member's photo (a short-lived signed URL) or their initials; a job has no face, so the briefcase in its ring.
  if (card.kind === "member") return <Avatar src={card.avatarUrl} name={card.title} size="md" />;
  return (
    <Disc>
      <Icon name="opportunities" size={20} />
    </Disc>
  );
}

function CardSummary({ mode, card }: { mode: AiMode; card: ResultCard }) {
  return (
    <div className="min-w-0 flex-1 basis-44">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 className="font-display text-lead text-text-primary">{card.title}</h3>
        {card.change === "new" && <Badge tone="lit">New</Badge>}
        {card.change === "updated" && <Badge tone="info">Updated</Badge>}
        {card.stale && <Badge tone="lit" className="h-auto max-w-full whitespace-normal py-1 text-left leading-snug">Profile changed since this search</Badge>}
      </div>
      {card.subtitle && <p className="mt-1 text-small text-text-secondary">{card.subtitle}</p>}
      <p className="mt-3 flex items-start gap-2 text-body text-text-secondary">
        <Icon name={TIER_ICON[card.tier]} size={16} className={`mt-1 shrink-0 ${card.tier === "meets" ? "text-lit" : "text-text-muted"}`} />
        <span>{tierLabel(mode, card.tier)}</span>
      </p>
      {card.sourceUpdatedAt && (
        <p className="mt-1 text-small text-text-muted">
          {card.kind === "member" ? "Profile updated" : "Updated"} <span className="data">{formatDate(card.sourceUpdatedAt)}</span>
        </p>
      )}
    </div>
  );
}

function CardScore({ card }: { card: ResultCard }) {
  if (card.score == null) return null;
  return (
    <div className="ml-auto shrink-0 text-right">
      <div className="font-display tnum text-heading leading-none text-text-primary">{card.score}</div>
      <div className="mt-1 text-caption text-text-muted">evidence match</div>
    </div>
  );
}

function CoverageList({ coverage }: { coverage: ResultCard["coverage"] }) {
  return (
    <ul className="mt-5 flex flex-wrap gap-2" aria-label="Criteria">
      {coverage.map((row) => {
        const s = STATE_MARK[row.state];
        return (
          <li key={row.atom}>
            <Badge
              tone={row.state === "met" ? "lit" : "neutral"}
              className={`h-auto min-h-8 max-w-full gap-2 whitespace-normal px-3 py-1 text-left text-small leading-snug ${row.state === "met" ? "" : s.cls}`}
            >
              <Icon name={s.icon} size={14} className="shrink-0" />
              <span>
                {row.label ?? row.free_text ?? row.concept}
                <span className="sr-only">: {s.label}{row.required ? ", must have" : ""}</span>
                {row.required && <span aria-hidden className="text-text-muted"> · must</span>}
              </span>
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

function EvidenceList({ evidence }: { evidence: ResultCard["evidence"] }) {
  return (
    <ul className="mt-5 space-y-3 border-t border-border-subtle pt-4">
      {evidence.map((e) => (
        <li key={`${e.kind}-${e.text}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-body text-text-secondary">
          <Badge className="shrink-0">
            {e.from_cv ? "From CV" : e.kind.startsWith("github") ? "GitHub" : e.kind === "self_reported" ? "Self-reported" : "Profile"}
          </Badge>
          <span className="min-w-[12rem] flex-1">{e.text}</span>
        </li>
      ))}
    </ul>
  );
}

function JobFacts({ card }: { card: ResultCard }) {
  const job = card.job!;
  const audience = audienceLabel(job.audience as Audience | null);
  const preference = card.components.preference;
  return (
    <div className="mt-5 space-y-2 text-body text-text-secondary">
      <p>
        {job.locationType}{job.locationText ? ` · ${job.locationText}` : ""} · {job.pay} · Apply by <span className="data">{formatDate(job.deadline)}</span>
        {audience ? ` · ${audience}` : ""}
      </p>
      {preference === "match" && <p className="text-text-muted">Matches your location preference.</p>}
      {preference === "mismatch" && <p className="text-text-muted">Doesn&apos;t match your location preference.</p>}
      {job.sparse && <p className="text-text-muted">Limited detail — you may want to ask the poster.</p>}
    </div>
  );
}

// How to apply, the first thing in the row of actions (it came right after the facts before, and still does in the DOM).
function JobApply({ card }: { card: ResultCard }) {
  const job = card.job!;
  // Only an absolute http(s) address becomes a link (safeUrl); anything else falls through to the next way to apply.
  const applyHref = job.applyMethod === "link" ? externalHref(job.applyUrl) : undefined;
  return (
    <>
      {job.applied && <Badge tone="success">Applied</Badge>}
      {applyHref ? (
        <ButtonLink href={applyHref} target="_blank" rel="noreferrer noopener" size="sm">
          Apply<span className="sr-only"> ↗</span>
          <Icon name="arrow-up-right" size={16} />
        </ButtonLink>
      ) : job.contactEmail ? (
        <ButtonLink href={mailtoHref(job.contactEmail, card.title)} size="sm">
          Email to apply<span className="sr-only"> ↗</span>
          <Icon name="arrow-up-right" size={16} />
        </ButtonLink>
      ) : (
        <span className="text-text-muted">The job page says how to apply.</span>
      )}
    </>
  );
}

const REPORT_REASONS: { value: MatchReportReason; label: string }[] = [
  { value: "wrong_skills", label: "Wrong skills" },
  { value: "not_relevant", label: "Not relevant" },
  { value: "outdated", label: "Outdated" },
  { value: "other", label: "Other" },
];

// S8 gap 18. Enum reason only, no free text. Reporting is idempotent at the
// database, so a double click just lands on "Reported" twice. The reasons live in
// a popover (a disclosure: no interruption, no focus trap) under "Report this
// match", so four buttons do not crowd every card; the panel is still named
// "Report this match" as the inline group was, and Cancel closes it.
function ReportControl({ turnId, targetId }: { turnId: string; targetId: string }) {
  const toast = useToast();
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  if (sent) {
    return (
      <span className="ml-auto inline-flex items-center gap-2 text-body text-text-muted">
        <Icon name="check" size={16} />
        Reported — thanks.
      </span>
    );
  }

  const send = async (reason: MatchReportReason) => {
    setSending(true);
    let res: Awaited<ReturnType<typeof reportMatch>>;
    try {
      res = await reportMatch(turnId, targetId, reason);
    } finally {
      setSending(false);
    }
    if (res.ok) setSent(true);
    else toast(res.error, "error");
  };

  return (
    <Popover
      label="Report this match"
      icon="flag"
      variant="quiet"
      caret={false}
      className="ml-auto"
      placement="bottom-end"
      panelLabel="Report this match"
      panelClassName="w-60 p-1.5"
    >
      {({ close }) => (
        <>
          <p className="px-3 pb-1 pt-2 text-small text-text-muted">Why?</p>
          {REPORT_REASONS.map((r) => (
            <button key={r.value} type="button" className="lm-pop__item" disabled={sending} onClick={() => void send(r.value)}>
              {r.label}
            </button>
          ))}
          <button type="button" className="lm-pop__item" onClick={() => close({ restoreFocus: true })}>
            Cancel
          </button>
        </>
      )}
    </Popover>
  );
}
