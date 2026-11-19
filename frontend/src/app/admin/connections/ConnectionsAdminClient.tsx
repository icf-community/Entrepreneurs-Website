"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose } from "@/components/ui/Dialog";
import { closeDialog, dialogCloser } from "@/components/ui/dialogCloser";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { Pager } from "@/components/ui/Pager";
import { Panel } from "@/components/ui/Panel";
import { Section } from "@/components/ui/Section";
import { Stat, StatGrid } from "@/components/ui/Stat";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { ButtonTabs } from "@/components/ui/Tabs";
import { Textarea } from "@/components/ui/Textarea";
import { useUrlFilters } from "@/lib/filters/useUrlFilters";
import { ErrorBanner } from "@/components/forms/Banners";
import { Field } from "@/components/forms/Field";
import { CONNECTION_REPORT_CATEGORIES } from "@/lib/validation/connections";
import type {
  ConnectionReport,
  FlaggedSender,
  ConnectionStats,
} from "@/lib/data/adminConnections";
import {
  resolveConnectionReport,
  revealConnectionNote,
  clearSenderThrottle,
  setConnectionsEnabled,
  type ConnectionsStatus,
} from "../actions";

// ════════════════════════════════════════════════════════════════════
// Foundry · The connections admin surface
//
// Three things on this page are not obvious and all three are deliberate.
//
// 1. THE NOTE IS BEHIND A BUTTON, NOT IN THE ROW. A note is private
//    member-to-member content. `admin_reveal_connection_note` writes an
//    `admin_actions` row BEFORE it returns the text, so the audit record
//    exists even if the response is lost — and rendering the note as a
//    column would make that audit meaningless, because every admin who
//    opened the queue would have read every note.
//
// 2. THE CONFLICT-OF-INTEREST NOTICE. An admin is a member too and can be
//    one of the two people in a reported connection. The action is still
//    permitted and still logged either way; this says so out loud rather
//    than leaving the admin to notice.
//
// 3. `throttled` AND `decline_rate` ARE SEPARATE COLUMNS AND MUST STAY
//    SEPARATE. Throttled is automatic — distinct members blocked or
//    successfully reported this sender and the cap has already dropped.
//    Decline rate drives nothing and never will: this community has a
//    status gradient, and a junior member's requests going unanswered is
//    not misbehaviour. It is here so a human can look, which is a
//    completely different thing from a system that acts.
// ════════════════════════════════════════════════════════════════════

const STATUS_TABS = [
  { value: "open", label: "Open" },
  { value: "actioned", label: "Actioned" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
] as const;

const categoryLabel = (value: string) =>
  CONNECTION_REPORT_CATEGORIES.find((c) => c.value === value)?.label ?? value;

// Illegal content and hate speech carry duties that spam does not, so the
// queue makes the difference visible rather than leaving an admin to read
// every row to find the one that matters.
const URGENT = new Set(["illegal", "hate", "harassment", "sexual"]);

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-GB");
const REPORT_DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric",
});

export default function ConnectionsAdminClient({
  reports, status, page, matching, pageSize, senders, stats, connectionsStatus,
}: {
  reports: ConnectionReport[];
  status: string;
  page: number;
  matching: number;
  pageSize: number;
  senders: FlaggedSender[];
  stats: ConnectionStats | null;
  connectionsStatus: ConnectionsStatus;
}) {
  const url = useUrlFilters({ navigate: "server" });
  const [resolving, setResolving] = useState<null | {
    report: ConnectionReport;
    mode: "actioned" | "dismissed";
  }>(null);
  const [clearing, setClearing] = useState<FlaggedSender | null>(null);

  return (
    <>
      <div className="lm-sections">
        <ConnectionStatsRow stats={stats} />

        <KillSwitch initial={connectionsStatus} />

        <Section rule title="Reported connections">
          <ButtonTabs
            semantics="current"
            label="Report status"
            items={STATUS_TABS}
            value={status}
            disabled={url.pending}
            // Which tab is showing is carried by a rule under it, and a screen
            // reader needs it said: aria-current="page", because the selection
            // lives in the URL — this is navigation, not a toggle.
            onSelect={(next) => url.apply({ status: next, page: null })}
          />

          {reports.length === 0 ? (
            <EmptyState icon={status === "open" ? "check" : "list"}>
              {status === "open" ? "No open reports. Nothing needs your attention." : "Nothing here."}
            </EmptyState>
          ) : (
            <ul className="grid gap-4">
              {reports.map((report) => (
                <ReportRow
                  key={report.id}
                  report={report}
                  onResolve={(mode) => setResolving({ report, mode })}
                />
              ))}
            </ul>
          )}

          <Pager url={url} page={page} total={matching} pageSize={pageSize} label="Report pages" />
        </Section>

        <FlaggedSenders senders={senders} onClear={setClearing} />
      </div>

      {resolving && (
        <ResolveDialog
          report={resolving.report}
          mode={resolving.mode}
          onClose={() => setResolving(null)}
        />
      )}

      {clearing && (
        <ClearThrottleDialog sender={clearing} onClose={() => setClearing(null)} />
      )}
    </>
  );
}

// ─── The three aggregates ───────────────────────────────────────────

function ConnectionStatsRow({ stats }: { stats: ConnectionStats | null }) {
  if (!stats) return null;
  return (
    <StatGrid>
      <Stat
        label="Total connections"
        value={stats.totalConnections.toLocaleString("en-GB")}
        hint="Accepted, both directions counted once"
      />
      <Stat
        label="Median per member"
        value={stats.medianPerMember.toLocaleString("en-GB")}
        hint="Members with none are included"
      />
      <Stat
        label="Cross-cohort"
        value={`${stats.crossCohortPct}%`}
        hint="Connections between different graduation years"
        meter={{ value: stats.crossCohortPct, max: 100 }}
      />
    </StatGrid>
  );
}

// ─── Kill switch ────────────────────────────────────────────────────

function KillSwitch({ initial }: { initial: ConnectionsStatus }) {
  const [status, setStatus] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  // No confirm dialog in either direction, same as IngestionToggle: this
  // is the "2am problem" switch, and a kill switch that makes you confirm
  // before it kills something is a worse kill switch.
  const toggle = () => {
    setError("");
    const next = !status.enabled;
    startTransition(async () => {
      const res = await setConnectionsEnabled(next);
      if (!res.ok) { setError(res.error); return; }
      setStatus({ enabled: next, lastChangedAt: new Date().toISOString(), lastChangedBy: "you" });
    });
  };

  // It looks like the state it is in (a calm panel while it runs, a danger panel while it is paused), as IngestionToggle does.
  return (
    <Section
      rule
      title="New connection requests"
      description={
        <>
          Pauses <strong>new requests only</strong>. Accepting, declining, withdrawing, blocking,
          reporting and removing all keep working while this is off, and the daily digest keeps
          going out — otherwise flipping it strands everyone mid-handshake with an inbox they
          cannot clear.
        </>
      }
    >
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <Panel tone={status.enabled ? "default" : "danger"} className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:px-5">
        <Badge tone={status.enabled ? "success" : "danger"} dot>
          {status.enabled ? "Open" : "Paused"}
        </Badge>
        {status.lastChangedAt && (
          // suppressHydrationWarning: this formats in the viewer's local zone,
          // which legitimately differs from the server's (same pattern as
          // BannerForm's CurrentBannerStatus).
          <span className="text-small text-text-muted" suppressHydrationWarning>
            {/* react-doctor-disable-next-line react-doctor/no-locale-format-in-render -- cosmetic admin-only timestamp; suppressHydrationWarning above accepts the server/client locale mismatch rather than adding post-mount state for it */}
            Last changed {DATE_TIME_FORMAT.format(new Date(status.lastChangedAt))}
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
          {status.enabled ? "Pause new requests" : "Allow new requests"}
        </Button>
      </Panel>
    </Section>
  );
}

// ─── One report ─────────────────────────────────────────────────────

function ReportRow({
  report, onResolve,
}: {
  report: ConnectionReport;
  onResolve: (mode: "actioned" | "dismissed") => void;
}) {
  return (
    <Panel as="li" className="grid gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Badge tone={URGENT.has(report.category) ? "danger" : "neutral"}>{categoryLabel(report.category)}</Badge>
          <h3 className="mt-3 break-words font-display text-lead text-text-primary">
            About {report.reportedName || "a member who has since left"}
          </h3>
          {/* suppressHydrationWarning: this formats in the viewer's local
              zone, which legitimately differs from the server's. */}
          <p className="mt-1 text-small text-text-muted" suppressHydrationWarning>
            Reported by {report.reporterName}
            <span aria-hidden className="mx-1.5">·</span>
            {/* react-doctor-disable-next-line react-doctor/no-locale-format-in-render -- cosmetic admin-only timestamp; suppressHydrationWarning above accepts the server/client locale mismatch rather than adding post-mount state for it */}
            {REPORT_DATE_FORMAT.format(new Date(report.createdAt))}
          </p>
        </div>

        {/* The number that decides whether this is a pattern or a one-off,
            shown next to the report rather than left to be counted. */}
        {report.reportedSignals > 0 && (
          <Badge className="shrink-0">
            {report.reportedSignals} distinct{" "}
            {report.reportedSignals === 1 ? "signal" : "signals"} against them
          </Badge>
        )}
      </div>

      {report.adminIsParty && (
        <div role="note">
          <Notice tone="lit">
            You are one of the people involved in this report. You can still act on it, and your
            action is logged either way — but consider passing it to another admin.
          </Notice>
        </div>
      )}

      <blockquote className="whitespace-pre-wrap break-words rounded-lg bg-tint-2 px-4 py-3 text-body text-text-secondary">
        {report.reason}
      </blockquote>

      {report.hasNote && <NoteReveal reportId={report.id} />}

      {report.resolutionNote && (
        <p className="text-small text-text-muted">
          Resolution note: {report.resolutionNote}
        </p>
      )}

      {report.status === "open" && (
        <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-4">
          <Button variant="danger" size="sm" onClick={() => onResolve("actioned")}>
            Uphold
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onResolve("dismissed")}>
            Dismiss
          </Button>
        </div>
      )}
    </Panel>
  );
}

/** The private note, one deliberate click away (see 1. at the top). Opening it is what writes the audit row. */
function NoteReveal({ reportId }: { reportId: string }) {
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  return (
    <div className="grid gap-2">
      {note === null ? (
        <>
          <div>
            <Button
              variant="ghost"
              size="sm"
              loading={pending}
              onClick={() =>
                start(async () => {
                  setError("");
                  const res = await revealConnectionNote(reportId);
                  if (!res.ok) { setError(res.error); return; }
                  setNote(res.data);
                })
              }
            >
              Show the note they sent
            </Button>
          </div>
          <p className="text-small text-text-muted">
            Private member-to-member content. Opening it is recorded against your account.
          </p>
        </>
      ) : (
        <>
          <p className="text-small text-text-muted">
            Note sent with the request, as it read when this was reported:
          </p>
          <blockquote className="whitespace-pre-wrap break-words rounded-lg bg-tint-2 px-4 py-3 text-body text-text-secondary">
            {note || "(the note was empty)"}
          </blockquote>
        </>
      )}
      {error && <ErrorBanner>{error}</ErrorBanner>}
    </div>
  );
}

function ResolveDialog({
  report, mode, onClose,
}: {
  report: ConnectionReport;
  mode: "actioned" | "dismissed";
  onClose: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  const upholding = mode === "actioned";
  const title = upholding ? `Uphold this report about ${report.reportedName || "this member"}?` : "Dismiss this report?";

  return (
    <Dialog
      onClose={onClose}
      label={upholding ? "Uphold this report" : "Dismiss this report"}
      tone={upholding ? "danger" : "default"}
      className="w-full max-w-[28rem] p-6 sm:p-7"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 className="font-display text-title text-text-primary">{title}</h2>
        <DialogClose className="-mr-2 -mt-2" />
      </div>
      <p className="mt-3 text-body text-text-secondary">
        {upholding
          ? "This counts as a reputation signal against them: enough distinct signals and their daily request cap drops automatically for 30 days. The reporter is emailed that we agreed. It does not remove the connection or ban anyone — do that separately if it is warranted."
          : "The reporter is emailed to say it was reviewed and no action was taken. No reputation signal is recorded."}
      </p>

      <div className="mt-5">
        <Field label="Note for the reporter (optional)">
          <Textarea
            id="resolve-note"
            rows={3}
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            className="resize-none"
          />
        </Field>
      </div>

      {error && <div className="mt-4"><ErrorBanner>{error}</ErrorBanner></div>}

      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button variant="quiet" size="md" onClick={(e) => closeDialog(e)}>Cancel</Button>
        <Button
          variant={upholding ? "danger" : "primary"}
          size="md"
          loading={pending}
          // dialogCloser, not onClose(). Calling the parent's onClose
          // unmounts the <dialog> from React without the browser ever
          // closing it, so the focus restore the native element does for
          // free never runs and the admin is left on <body> — back at the
          // top of the page, with no idea where they were. Resolved
          // synchronously because currentTarget is null after the await.
          onClick={(e) => {
            const close = dialogCloser(e);
            start(async () => {
              setError("");
              const res = await resolveConnectionReport(report.id, mode, text);
              if (!res.ok) { setError(res.error); return; }
              close();
              router.refresh();
            });
          }}
        >
          {upholding ? "Uphold and email reporter" : "Dismiss and email reporter"}
        </Button>
      </div>
    </Dialog>
  );
}

// ─── Flagged senders ────────────────────────────────────────────────

const SENDERS_LABEL = "Members with blocks, upheld reports, or an unusual decline rate";
// The four measured columns, in the order SenderRow prints them.
const SENDER_COUNTS = ["Signals", "Requests sent", "Declined", "Decline rate"] as const;

function FlaggedSenders({
  senders, onClear,
}: {
  senders: FlaggedSender[];
  onClear: (s: FlaggedSender) => void;
}) {
  return (
    <Section
      rule
      title="Senders worth a look"
      description={
        <>
          <strong>Throttled</strong> is automatic — that many distinct members have blocked them or
          had a report upheld against them, so their daily cap has already dropped. It decays on
          its own.{" "}
          <strong>Decline rate</strong> drives nothing and never will: students requesting alumni
          and alumni requesting angels means unanswered requests are normal here, and throttling on
          that would penalise exactly who the platform exists to help. It is here so a person can
          look.
        </>
      }
    >
      {senders.length === 0 ? (
        <EmptyState icon="check">
          Nobody is flagged. No member has attracted a block or an upheld report recently.
        </EmptyState>
      ) : (
        <Table label={SENDERS_LABEL} caption={SENDERS_LABEL}>
          <THead>
            <TR>
              <TH>Member</TH>
              {SENDER_COUNTS.map((name) => (
                <TH key={name} numeric>{name}</TH>
              ))}
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {senders.map((s) => (
              <SenderRow key={s.memberId} s={s} onClear={onClear} />
            ))}
          </TBody>
        </Table>
      )}
    </Section>
  );
}

function SenderRow({ s, onClear }: { s: FlaggedSender; onClear: (s: FlaggedSender) => void }) {
  return (
    <TR>
      <TD label="Member" primary>
        {s.memberName}
        {s.throttled && (
          <Badge tone="danger" className="ml-2 align-middle">
            Throttled
          </Badge>
        )}
      </TD>
      <TD label="Signals" numeric>{s.distinctSignals}</TD>
      <TD label="Requests sent" numeric>{s.requestsSent}</TD>
      <TD label="Declined" numeric>{s.declines}</TD>
      <TD label="Decline rate" numeric>{Math.round(s.declineRate * 100)}%</TD>
      <TD actions>
        {s.throttled && (
          <Button variant="ghost" size="sm" onClick={() => onClear(s)}>
            Lift throttle
          </Button>
        )}
      </TD>
    </TR>
  );
}

function ClearThrottleDialog({
  sender, onClose,
}: {
  sender: FlaggedSender;
  onClose: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  return (
    <Dialog
      onClose={onClose}
      label="Lift this throttle"
      className="w-full max-w-[28rem] p-6 sm:p-7"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 className="font-display text-title text-text-primary">
          Lift the throttle on {sender.memberName}?
        </h2>
        <DialogClose className="-mr-2 -mt-2" />
      </div>
      <p className="mt-3 text-body text-text-secondary">
        Their daily request cap goes back to normal immediately. The{" "}
        {sender.distinctSignals} {sender.distinctSignals === 1 ? "signal" : "signals"} against
        them are not deleted — this records that you reviewed them and decided they do not
        warrant a restriction. They are not told, either way.
      </p>

      <div className="mt-5">
        <Field label="Why (recorded in the admin log, optional)">
          <Textarea
            id="clear-note"
            rows={3}
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            className="resize-none"
          />
        </Field>
      </div>

      {error && <div className="mt-4"><ErrorBanner>{error}</ErrorBanner></div>}

      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button variant="quiet" size="md" onClick={(e) => closeDialog(e)}>Cancel</Button>
        <Button
          variant="primary"
          size="md"
          loading={pending}
          // See ResolveDialog: the browser has to be the one that closes it
          // or focus is dropped on <body>.
          onClick={(e) => {
            const close = dialogCloser(e);
            start(async () => {
              setError("");
              const res = await clearSenderThrottle(sender.memberId, text);
              if (!res.ok) { setError(res.error); return; }
              close();
              router.refresh();
            });
          }}
        >
          Lift the throttle
        </Button>
      </div>
    </Dialog>
  );
}
