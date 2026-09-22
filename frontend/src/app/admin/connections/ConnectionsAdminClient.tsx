"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Dialog, closeDialog, dialogCloser } from "@/components/ui/Dialog";
import { Pager } from "@/components/ui/Pager";
import { useUrlFilters } from "@/lib/filters/useUrlFilters";
import { ErrorBanner } from "@/components/forms/Banners";
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
    <div>
      <ConnectionStatsRow stats={stats} />

      <KillSwitch initial={connectionsStatus} />

      <section className="mt-12 rule-draw pt-6">
        <p className="label-wide text-text-secondary mb-3">Reported connections</p>

        <nav aria-label="Report status" className="mb-6 flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              disabled={url.pending}
              // Which tab is showing is carried by a border colour and
              // nothing else, so without this a screen reader reads four
              // identical buttons and the admin cannot tell which list they
              // are looking at. aria-current="page" because the selection
              // lives in the URL — this is navigation, not a toggle.
              aria-current={status === tab.value ? "page" : undefined}
              onClick={() => url.apply({ status: tab.value, page: null })}
              className={
                "rounded-lg border px-4 py-2 text-[0.8rem] transition-colors cursor-pointer " +
                (status === tab.value
                  ? "border-accent bg-white/[0.05] text-text-primary"
                  : "border-border-strong bg-white/[0.03] text-text-secondary hover:border-accent hover:text-text-primary")
              }
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {reports.length === 0 ? (
          <p className="rounded-xl border border-border-subtle bg-white/[0.02] px-6 py-12 text-center text-[0.875rem] text-text-secondary">
            {status === "open" ? "No open reports. Nothing needs your attention." : "Nothing here."}
          </p>
        ) : (
          <ul className="space-y-4">
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
      </section>

      <FlaggedSenders senders={senders} onClear={setClearing} />

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
    </div>
  );
}

// ─── The three aggregates ───────────────────────────────────────────

function ConnectionStatsRow({ stats }: { stats: ConnectionStats | null }) {
  if (!stats) return null;
  return (
    <div className="grid grid-cols-1 gap-px border border-border bg-border sm:grid-cols-3">
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
      />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-bg-card p-5">
      <div className="text-[0.75rem] text-text-muted">{label}</div>
      <div className="data mt-1 text-[1.5rem] font-medium text-text-primary">{value}</div>
      <div className="mt-1 text-[0.7rem] text-text-muted">{hint}</div>
    </div>
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

  return (
    <div className="mt-12 rule-draw pt-6">
      <p className="label-wide text-text-secondary mb-3">New connection requests</p>
      <p className="text-[0.8rem] text-text-muted mb-4 leading-relaxed">
        Pauses <strong>new requests only</strong>. Accepting, declining, withdrawing, blocking,
        reporting and removing all keep working while this is off, and the daily digest keeps
        going out — otherwise flipping it strands everyone mid-handshake with an inbox they
        cannot clear.
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
          {status.enabled ? "Open" : "Paused"}
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
          {status.enabled ? "Pause new requests" : "Allow new requests"}
        </Button>
      </div>
    </div>
  );
}

// ─── One report ─────────────────────────────────────────────────────

function ReportRow({
  report, onResolve,
}: {
  report: ConnectionReport;
  onResolve: (mode: "actioned" | "dismissed") => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  return (
    <li className="rounded-xl border border-border-subtle bg-white/[0.02] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span
            className={
              "inline-block rounded-full px-2.5 py-1 text-[0.65rem] uppercase tracking-wider " +
              (URGENT.has(report.category)
                ? "border border-[#ff4d4d]/40 bg-[#ff4d4d]/10 text-[#ff8080]"
                : "border border-border-strong text-text-muted")
            }
          >
            {categoryLabel(report.category)}
          </span>
          <h2 className="mt-3 text-[1rem] font-medium tracking-tight text-text-primary break-words">
            About {report.reportedName || "a member who has since left"}
          </h2>
          <p className="mt-1 text-[0.75rem] text-text-muted">
            Reported by {report.reporterName}
            <span aria-hidden className="mx-1.5">·</span>
            {new Date(report.createdAt).toLocaleDateString("en-GB", {
              day: "numeric", month: "short", year: "numeric",
            })}
          </p>
        </div>

        {/* The number that decides whether this is a pattern or a one-off,
            shown next to the report rather than left to be counted. */}
        {report.reportedSignals > 0 && (
          <span className="shrink-0 rounded-lg border border-border-strong px-2.5 py-1 text-[0.7rem] text-text-secondary">
            {report.reportedSignals} distinct{" "}
            {report.reportedSignals === 1 ? "signal" : "signals"} against them
          </span>
        )}
      </div>

      {report.adminIsParty && (
        <p
          role="note"
          className="mt-4 rounded-lg border border-[#c9a84c]/40 bg-[#c9a84c]/10 px-3 py-2 text-[0.75rem] text-text-secondary"
        >
          You are one of the people involved in this report. You can still act on it, and your
          action is logged either way — but consider passing it to another admin.
        </p>
      )}

      <blockquote className="mt-4 border-l-2 border-border-strong pl-4 text-[0.85rem] text-text-secondary whitespace-pre-wrap break-words">
        {report.reason}
      </blockquote>

      {report.hasNote && (
        <div className="mt-4">
          {note === null ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                loading={pending}
                onClick={() =>
                  start(async () => {
                    setError("");
                    const res = await revealConnectionNote(report.id);
                    if (!res.ok) { setError(res.error); return; }
                    setNote(res.data);
                  })
                }
              >
                Show the note they sent
              </Button>
              <p className="mt-2 text-[0.7rem] text-text-muted">
                Private member-to-member content. Opening it is recorded against your account.
              </p>
            </>
          ) : (
            <>
              <p className="text-[0.7rem] text-text-muted">
                Note sent with the request, as it read when this was reported:
              </p>
              <blockquote className="mt-2 rounded-lg border border-border-strong bg-white/[0.03] px-4 py-3 text-[0.85rem] text-text-secondary whitespace-pre-wrap break-words">
                {note || "(the note was empty)"}
              </blockquote>
            </>
          )}
          {error && <p role="alert" className="mt-2 text-[0.8rem] text-[#ff8080]">{error}</p>}
        </div>
      )}

      {report.resolutionNote && (
        <p className="mt-3 text-[0.75rem] text-text-muted">
          Resolution note: {report.resolutionNote}
        </p>
      )}

      {report.status === "open" && (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-border-subtle pt-4">
          <Button variant="danger" size="sm" onClick={() => onResolve("actioned")}>
            Uphold
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onResolve("dismissed")}>
            Dismiss
          </Button>
        </div>
      )}
    </li>
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

  return (
    <Dialog
      onClose={onClose}
      label={upholding ? "Uphold this report" : "Dismiss this report"}
      className="w-full max-w-md rounded-xl border border-border-strong bg-bg-primary p-6"
    >
      <h3 className="font-display text-[1.1rem] text-text-primary">
        {upholding ? `Uphold this report about ${report.reportedName || "this member"}?` : "Dismiss this report?"}
      </h3>
      <p className="mt-2 text-[0.85rem] text-text-secondary leading-relaxed">
        {upholding
          ? "This counts as a reputation signal against them: enough distinct signals and their daily request cap drops automatically for 30 days. The reporter is emailed that we agreed. It does not remove the connection or ban anyone — do that separately if it is warranted."
          : "The reporter is emailed to say it was reviewed and no action was taken. No reputation signal is recorded."}
      </p>

      <label htmlFor="resolve-note" className="mt-5 block text-[0.75rem] text-text-muted">
        Note for the reporter (optional)
      </label>
      <textarea
        id="resolve-note"
        rows={3}
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
        className="mt-2 w-full rounded-lg border border-border-strong bg-white/[0.03] px-3 py-2 text-[0.85rem] text-text-primary"
      />

      {error && <div className="mt-4"><ErrorBanner>{error}</ErrorBanner></div>}

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={(e) => closeDialog(e)}>Cancel</Button>
        <Button
          variant={upholding ? "danger" : "primary"}
          size="sm"
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

function FlaggedSenders({
  senders, onClear,
}: {
  senders: FlaggedSender[];
  onClear: (s: FlaggedSender) => void;
}) {
  return (
    <section className="mt-12 rule-draw pt-6">
      <p className="label-wide text-text-secondary mb-3">Senders worth a look</p>
      <p className="text-[0.8rem] text-text-muted mb-4 max-w-[70ch] leading-relaxed">
        <strong>Throttled</strong> is automatic — that many distinct members have blocked them or
        had a report upheld against them, so their daily cap has already dropped. It decays on
        its own.{" "}
        <strong>Decline rate</strong> drives nothing and never will: students requesting alumni
        and alumni requesting angels means unanswered requests are normal here, and throttling on
        that would penalise exactly who the platform exists to help. It is here so a person can
        look.
      </p>

      {senders.length === 0 ? (
        <p className="rounded-xl border border-border-subtle bg-white/[0.02] px-6 py-12 text-center text-[0.875rem] text-text-secondary">
          Nobody is flagged. No member has attracted a block or an upheld report recently.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-subtle">
          <table className="w-full min-w-[640px] border-collapse text-[0.8rem]">
            <caption className="sr-only">
              Members with blocks, upheld reports, or an unusual decline rate
            </caption>
            <thead>
              <tr className="border-b border-border-subtle text-left text-text-muted">
                <th scope="col" className="px-4 py-3 font-normal">Member</th>
                <th scope="col" className="px-4 py-3 font-normal">Signals</th>
                <th scope="col" className="px-4 py-3 font-normal">Requests sent</th>
                <th scope="col" className="px-4 py-3 font-normal">Declined</th>
                <th scope="col" className="px-4 py-3 font-normal">Decline rate</th>
                <th scope="col" className="px-4 py-3 font-normal">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {senders.map((s) => (
                <tr key={s.memberId} className="border-b border-border-subtle last:border-0">
                  <td className="px-4 py-3 text-text-primary">
                    {s.memberName}
                    {s.throttled && (
                      <span className="ml-2 inline-block rounded-full border border-[#ff4d4d]/40 bg-[#ff4d4d]/10 px-2 py-0.5 text-[0.65rem] uppercase tracking-wider text-[#ff8080]">
                        Throttled
                      </span>
                    )}
                  </td>
                  <td className="tnum px-4 py-3 text-text-secondary">{s.distinctSignals}</td>
                  <td className="tnum px-4 py-3 text-text-secondary">{s.requestsSent}</td>
                  <td className="tnum px-4 py-3 text-text-secondary">{s.declines}</td>
                  <td className="tnum px-4 py-3 text-text-secondary">
                    {Math.round(s.declineRate * 100)}%
                  </td>
                  <td className="px-4 py-3 text-right">
                    {s.throttled && (
                      <Button variant="ghost" size="sm" onClick={() => onClear(s)}>
                        Lift throttle
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
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
      className="w-full max-w-md rounded-xl border border-border-strong bg-bg-primary p-6"
    >
      <h3 className="font-display text-[1.1rem] text-text-primary">
        Lift the throttle on {sender.memberName}?
      </h3>
      <p className="mt-2 text-[0.85rem] text-text-secondary leading-relaxed">
        Their daily request cap goes back to normal immediately. The{" "}
        {sender.distinctSignals} {sender.distinctSignals === 1 ? "signal" : "signals"} against
        them are not deleted — this records that you reviewed them and decided they do not
        warrant a restriction. They are not told, either way.
      </p>

      <label htmlFor="clear-note" className="mt-5 block text-[0.75rem] text-text-muted">
        Why (recorded in the admin log, optional)
      </label>
      <textarea
        id="clear-note"
        rows={3}
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
        className="mt-2 w-full rounded-lg border border-border-strong bg-white/[0.03] px-3 py-2 text-[0.85rem] text-text-primary"
      />

      {error && <div className="mt-4"><ErrorBanner>{error}</ErrorBanner></div>}

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={(e) => closeDialog(e)}>Cancel</Button>
        <Button
          variant="primary"
          size="sm"
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
