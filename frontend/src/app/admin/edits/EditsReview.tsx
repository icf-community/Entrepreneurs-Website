"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/forms/Field";
import { ErrorBanner } from "@/components/forms/Banners";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { Textarea } from "@/components/ui/Textarea";
import { Icon } from "@/design-system/icons/Icon";
import { formatDate } from "@/lib/dates";
import { approveEdit, declineEdit } from "./actions";
import type { ListingEdit } from "@/lib/listings/edits";

// ════════════════════════════════════════════════════════════════════
// Foundry · Reviewing a change to something already published
//
// Different from the other admin queues in one way that matters: the
// listing is already live, so the reviewer is not deciding whether to
// publish it — they are deciding whether a *change* is safe. What they
// need is therefore a diff, not a card. Only changed fields are shown,
// old value beside new, because a full re-read of an unchanged
// description is exactly how a moved start time gets skimmed past.
//
// Time and location changes carry a flag. On a physical event with
// student attendees those are the safeguarding-relevant edits — a venue
// moved off campus, or a start pushed to 11pm — even when not one word
// of the description changed.
//
// Drawn as a Table: three columns (field, published now, proposed) that
// stack into labelled lines on a phone. Cells hold plain text, never a
// wrapper of their own, so the diff reads as one run per value. The Table is
// itself the surface, so each proposal is an open article on the page (a rule
// between them), not a Panel around a bordered table.
// ════════════════════════════════════════════════════════════════════

const KIND_LABEL: Record<ListingEdit["listingKind"], string> = {
  event: "Event",
  opportunity: "Opportunity",
  vc_grant: "VC / grant",
};

const PUBLIC_PATH: Record<ListingEdit["listingKind"], string> = {
  event: "/events",
  opportunity: "/opportunities",
  vc_grant: "/vcs",
};

const SAFETY_FIELDS = new Set(["event_at", "location"]);

type Props = {
  items: ListingEdit[];
  labels: Record<string, string>;
  /** Precomputed server-side so the diff and the emails agree. */
  changed: Record<string, string[]>;
};

export default function EditsReview({ items, labels, changed }: Props) {
  if (items.length === 0) {
    return (
      <EmptyState icon="edit">
        No proposed changes. Published listings are all as their organisers left them.
      </EmptyState>
    );
  }
  return (
    <div className="divide-y divide-border-subtle">
      {items.map((e) => (
        <EditCard key={e.id} edit={e} labels={labels} changed={changed[e.id] ?? []} />
      ))}
    </div>
  );
}

function EditCard({
  edit,
  labels,
  changed,
}: {
  edit: ListingEdit;
  labels: Record<string, string>;
  changed: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");

  const safety = changed.filter((f) => SAFETY_FIELDS.has(f));

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError("");
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
    });
  };

  return (
    <article className="py-8 first:pt-0 last:pb-0">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{KIND_LABEL[edit.listingKind]}</Badge>
            {safety.length > 0 && (
              <Badge tone="danger">
                <Icon name="flag" size={14} />
                Time / place changed
              </Badge>
            )}
          </div>
          <h2 className="mt-3 font-display text-lead text-text-primary">{edit.listingTitle}</h2>
          <p className="mt-1 text-small text-text-muted">
            Proposed by {edit.proposedByName ?? "a member"} on <span className="data">{formatDate(edit.createdAt)}</span>
          </p>
        </div>
        <ButtonLink href={`${PUBLIC_PATH[edit.listingKind]}/${edit.listingId}`} variant="ghost" size="sm">
          View live listing
        </ButtonLink>
      </div>

      {changed.length === 0 ? (
        <p className="text-body text-text-muted">
          Nothing differs from the published version. Approving is harmless; declining is tidier.
        </p>
      ) : (
        <Table label={`Proposed changes to ${edit.listingTitle}`}>
          <THead>
            <TR>
              <TH>Field</TH>
              <TH>Published now</TH>
              <TH>Proposed</TH>
            </TR>
          </THead>
          <TBody>
            {changed.map((f) => (
              <TR key={f}>
                <TD primary nowrap label="Field">
                  {labels[f] ?? f}
                  {SAFETY_FIELDS.has(f) && (
                    <>
                      <Icon name="flag" size={14} className="ml-2 inline-block align-text-bottom text-danger" />
                      <span className="sr-only">Time or place changed</span>
                    </>
                  )}
                </TD>
                <TD label="Published now" className="whitespace-pre-wrap break-words text-text-muted">
                  {render(edit.current[f])}
                </TD>
                <TD label="Proposed" className="whitespace-pre-wrap break-words text-text-primary">
                  {render(edit.proposed[f])}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {error && <div className="mt-4"><ErrorBanner>{error}</ErrorBanner></div>}

      {!declining ? (
        <div className="mt-5 flex flex-wrap gap-3">
          <Button
            type="button"
            variant="primary"
            size="sm"
            loading={pending}
            onClick={() => run(() => approveEdit(edit.id))}
          >
            Approve changes
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setDeclining(true)}>
            Decline
          </Button>
        </div>
      ) : (
        <div className="mt-5 grid gap-4">
          <Field label="Why? The organiser gets this, so it has to tell them what to change.">
            <Textarea
              id={`reason-${edit.id}`}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="resize-none"
            />
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="danger"
              size="sm"
              loading={pending}
              onClick={() => run(() => declineEdit(edit.id, reason))}
            >
              Decline changes
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setDeclining(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

function render(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return String(v);
}
