"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";
import { settle } from "@/lib/settle";
import { Dialog } from "@/components/ui/Dialog";
import { closeDialog, dialogCloser } from "@/components/ui/dialogCloser";
import { ConfirmDialog } from "@/components/connections/ConfirmDialog";
import { browserClient } from "@/lib/supabase/browser";
import { sendConnectionRequest, unblockMember, withdrawConnectionRequest } from "@/app/connections/actions";
import { CONNECTION_NOTE_MAX, cleanNote, noteLength } from "@/lib/validation/connections";
import { track } from "@/lib/analytics/track";

// ════════════════════════════════════════════════════════════════════
// Foundry · The Connect control, inside the member dialog
//
// The member dialog's first mutating control, and it deliberately takes
// NO session props. Everything it needs comes from connection_state_with,
// which already answers "is this me" with `self` — so no call site had to
// start threading a user id through, and /members, /home and every other
// place that opens a dialog are untouched.
//
// Two refusals are collapsed into one state by the RPC, not by this
// component: blocked, on cooldown, paused, and not-a-member all arrive as
// `unavailable`. Distinguishing them here would rebuild the probing
// oracle the SQL closed — if the UI said "you blocked them" the block
// would stop being silent.
//
// The consent line is NOT decoration and is not collapsible. Sending is
// the requester's half of the consent, and it has to be in front of the
// person at the moment they send.
// ════════════════════════════════════════════════════════════════════

type State =
  | "loading"
  | "self"
  | "none"
  | "connected"
  | "pending_outgoing"
  | "pending_incoming"
  // You withdrew your own request and your three weeks are running
  // (20260917000017). Only ever the withdrawer's own view, so naming the
  // date leaks nothing — unlike a decline, which stays `unavailable`.
  | "withdrawn_by_me"
  | "blocked_by_me"
  | "unavailable"
  | "error";

type Quota = {
  daily_cap: number;
  weekly_cap: number;
  outstanding: number;
  limit_reason: string | null;
  available_at: string | null;
};

// The community's clock, not the viewer's: a limit that resets "at 14:05"
// must mean the same moment to everyone reading it (and matches the
// digest's UTC-in-winter / BST-in-summer window).
const LONDON = "Europe/London";

// Hoisted to module scope: the options never change, so there is no reason
// to reconstruct these on every formatWhen() call.
const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, year: "numeric", month: "2-digit", day: "2-digit" });
const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hour: "2-digit", minute: "2-digit" });
const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, weekday: "short", day: "numeric", month: "short" });

function formatWhen(iso: string): string {
  const at = new Date(iso);
  const time = TIME_FORMAT.format(at);
  const now = new Date();
  if (DAY_FORMAT.format(at) === DAY_FORMAT.format(now)) return `${time} today`;
  if (DAY_FORMAT.format(at) === DAY_FORMAT.format(new Date(now.getTime() + 86_400_000))) return `${time} tomorrow`;
  return WEEKDAY_FORMAT.format(at);
}

/** Why Connect is greyed out, or null when the member can send. */
function limitMessage(q: Quota | null): string | null {
  if (!q?.limit_reason) return null;
  const when = q.available_at ? ` You can send more from ${formatWhen(q.available_at)}.` : "";
  const requests = (n: number) => `${n} connection request${n === 1 ? "" : "s"}`;
  if (q.limit_reason === "weekly") return `You've hit your weekly limit of ${requests(q.weekly_cap)}.${when}`;
  if (q.limit_reason === "daily") return `You've hit today's limit of ${requests(q.daily_cap)}.${when}`;
  return `You have ${q.outstanding === 1 ? "1 request" : `${q.outstanding} requests`} waiting for a reply. Withdraw some from your Sent tab, or wait for replies, before sending more.`;
}

type PanelRow = {
  state: string;
  connection_id: string | null;
  available_at: string | null;
  consent_version: string | null;
  enabled: boolean | null;
  daily_cap: number;
  weekly_cap: number;
  outstanding: number;
  limit_reason: string | null;
  quota_available_at: string | null;
};

/** One read for the whole control (B25); null when it failed. */
async function fetchPanel(memberId: string): Promise<PanelRow | null> {
  const { data, error } = await browserClient().rpc("connection_panel_state", { p_member: memberId });
  if (error) {
    console.error("Failed to load connection state:", error);
    return null;
  }
  return (Array.isArray(data) ? data[0] : null) ?? null;
}

type Ids = { status: string; note: string; count: string };

export function ConnectControl({
  memberId,
  firstName,
  surname,
}: {
  memberId: string;
  firstName: string;
  surname: string;
}) {
  // B25: unique per instance, so two controls on one page never share an
  // id (and aria-describedby never points at the wrong control).
  const uid = useId();
  const ids: Ids = { status: `${uid}-status`, note: `${uid}-note`, count: `${uid}-note-count` };
  const [state, setState] = useState<State>("loading");
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [availableAt, setAvailableAt] = useState<string | null>(null);
  // Read so Connect can grey out BEFORE a send fails. Fail-open: the send
  // RPC's own caps are the enforcement, this is only what the button says.
  const [quota, setQuota] = useState<Quota | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [consentVersion, setConsentVersion] = useState<string | null>(null);
  // Read alongside the two calls below. `connection_state_with` answers
  // per-pair state and knows nothing about the kill switch — send_connection_
  // request is the only RPC it gates — so without this a `none` pair still
  // rendered a live, clickable Connect button while requests were paused,
  // and the member only found out when the send itself failed. Existing
  // connections/pending requests are unaffected either way: this only
  // changes what a *fresh* `none` state renders.
  const [enabled, setEnabled] = useState(true);
  const [composing, setComposing] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // B25: one read, not four. connection_panel_state composes
  // connection_state_with, the consent version, the kill switch and the
  // caller's quota server-side (20260928000001), so opening a profile is
  // one round trip instead of four. `attempt` re-runs it for Try again.
  const [attempt, setAttempt] = useState(0);

  function apply(row: PanelRow | null) {
    if (!row) {
      setState("error");
      return;
    }
    setState((row.state as State) ?? "error");
    setConnectionId(row.connection_id ?? null);
    setAvailableAt(row.available_at ?? null);
    setQuota({
      daily_cap: row.daily_cap,
      weekly_cap: row.weekly_cap,
      outstanding: row.outstanding,
      limit_reason: row.limit_reason,
      available_at: row.quota_available_at,
    });
    setConsentVersion(typeof row.consent_version === "string" ? row.consent_version : null);
    setEnabled(row.enabled !== false);
  }

  useEffect(() => {
    let cancelled = false;
    // A dialog switched to another member mid-read must not show this one's state.
    fetchPanel(memberId).then(
      (row) => { if (!cancelled) apply(row); },
      (e: unknown) => {
        if (cancelled) return;
        console.error("Failed to load connection state:", e);
        setState("error");
      },
    );
    return () => { cancelled = true; };
  }, [memberId, attempt]);

  // Re-read after any action rather than assuming its outcome.
  async function refresh() {
    apply(await fetchPanel(memberId).catch(() => null));
  }

  function retry() {
    setState("loading");
    setAttempt((n) => n + 1);
  }

  async function send(e: { currentTarget: HTMLElement }) {
    if (!consentVersion) return;
    // Resolved before the await — see dialogCloser.
    const close = dialogCloser(e);
    setSending(true);
    setError(null);
    const res = await settle(sendConnectionRequest({
      memberId,
      note: note || undefined,
      consentVersion,
    }));
    setSending(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }
    track("connection_request_sent", { with_note: note.trim().length > 0 });
    // The RPC accepts on the spot when they already had a request out to
    // you — two people agreeing is not a conflict — so the outcome is not
    // always "pending". Re-read rather than assuming.
    await refresh();
    setNote("");
    close();
  }

  async function unblock() {
    setSending(true);
    setError(null);
    const res = await settle(unblockMember({ memberId }));
    setSending(false);
    if (!res.ok) { setError(res.error); return; }
    // Unblocking deletes the row, so the pair is back to having
    // no history at all — which is `none`, not `connected`.
    setState("none");
  }

  // Nothing for your own profile. While we are still finding out, a
  // placeholder of the same height rather than a button: a Connect button
  // that might turn into "Connected" a moment later is worse than a beat of
  // nothing, but a footer that pops in shifts the dialog.
  if (state === "self") return null;
  if (state === "loading") return <LoadingFooter />;
  if (state === "error") return <ErrorFooter onRetry={retry} />;
  if (state === "connected") return <ConnectedFooter />;

  // LinkedIn's shape: the Connect button becomes Pending, and Pending is
  // where you withdraw. Withdrawing holds only YOU for three weeks — the
  // dialog says so, and says they can still reach you.
  if (state === "pending_outgoing") {
    return (
      <PendingOutgoingFooter
        firstName={firstName}
        connectionId={connectionId}
        withdrawing={withdrawing}
        setWithdrawing={setWithdrawing}
        onWithdrawSuccess={() => { void refresh(); }}
      />
    );
  }

  if (state === "withdrawn_by_me") {
    return <WithdrawnByMeFooter firstName={firstName} availableAt={availableAt} />;
  }

  if (state === "pending_incoming") {
    return <PendingIncomingFooter firstName={firstName} />;
  }

  if (state === "blocked_by_me") {
    return <BlockedByMeFooter sending={sending} error={error} onUnblock={unblock} />;
  }

  // `unavailable` is the one message four different situations share, and
  // it says nothing about which. That is the point.
  //
  // A paused kill switch joins the same message rather than getting its
  // own: `send_connection_request` refuses on it just like block/cooldown/
  // paused-recipient do, so a `none` pair under a paused switch is really a
  // fifth case of the same thing, not a new one that needs distinguishing.
  if (state === "unavailable" || (state === "none" && !enabled)) {
    return <UnavailableFooter />;
  }

  // state === "none"
  return (
    <NoneFooter
      firstName={firstName}
      surname={surname}
      ids={ids}
      quota={quota}
      composing={composing}
      setComposing={setComposing}
      note={note}
      setNote={setNote}
      sending={sending}
      error={error}
      setError={setError}
      consentVersion={consentVersion}
      onSend={send}
    />
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return <section className="pt-4 border-t border-border-subtle">{children}</section>;
}

function LoadingFooter() {
  return (
    <Footer>
      <SkeletonRegion label="Checking your connection status…" className="flex items-center justify-between gap-3">
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-8 w-24 rounded-lg" />
      </SkeletonRegion>
    </Footer>
  );
}

function ErrorFooter({ onRetry }: { onRetry: () => void }) {
  return (
    <Footer>
      <div className="flex items-center justify-between gap-3">
        <p role="alert" className="text-[0.8rem] text-text-muted">
          Couldn&apos;t check your connection status.
        </p>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </Footer>
  );
}

function ConnectedFooter() {
  return (
    <Footer>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.8rem] text-text-secondary">
          You&apos;re connected. You can see each other&apos;s email address.
        </p>
        <Link
          href="/connections"
          className="shrink-0 rounded-lg border border-border-strong bg-white/[0.05] px-3 py-1.5 text-[0.75rem] text-text-primary no-underline transition-colors hover:border-accent hover:bg-white/[0.10]"
        >
          View
        </Link>
      </div>
    </Footer>
  );
}

function PendingOutgoingFooter({
  firstName,
  connectionId,
  withdrawing,
  setWithdrawing,
  onWithdrawSuccess,
}: {
  firstName: string;
  connectionId: string | null;
  withdrawing: boolean;
  setWithdrawing: (b: boolean) => void;
  onWithdrawSuccess: () => void;
}) {
  return (
    <Footer>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.8rem] text-text-secondary">Request sent — waiting for a reply.</p>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          aria-label={`Pending — withdraw your request to ${firstName}`}
          onClick={() => setWithdrawing(true)}
          disabled={!connectionId}
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className="mr-1.5 inline h-3.5 w-3.5 -mt-0.5" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="6.25" />
            <path d="M8 4.5V8l2.25 1.5" strokeLinecap="round" />
          </svg>
          Pending
        </Button>
      </div>
      {withdrawing && connectionId && (
        <ConfirmDialog
          title={`Withdraw your request to ${firstName}?`}
          body={
            <p>
              You won&apos;t be able to send {firstName} another request for three weeks. They
              can still send you one.
            </p>
          }
          confirmLabel="Withdraw"
          onConfirm={async () => {
            const res = await withdrawConnectionRequest({ connectionId });
            if (res.ok) track("connection_request_withdrawn");
            return res;
          }}
          onSuccess={onWithdrawSuccess}
          onClose={() => setWithdrawing(false)}
        />
      )}
    </Footer>
  );
}

function WithdrawnByMeFooter({ firstName, availableAt }: { firstName: string; availableAt: string | null }) {
  return (
    <Footer>
      <p className="text-[0.8rem] text-text-muted">
        You withdrew your request.
        {availableAt && <> You can send {firstName} a new one from {formatWhen(availableAt)}.</>}
      </p>
    </Footer>
  );
}

function PendingIncomingFooter({ firstName }: { firstName: string }) {
  return (
    <Footer>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.8rem] text-text-secondary">
          {firstName} sent you a connection request.
        </p>
        <Link
          href="/connections?tab=pending"
          className="shrink-0 rounded-lg border border-border-strong bg-white/[0.05] px-3 py-1.5 text-[0.75rem] text-text-primary no-underline transition-colors hover:border-accent hover:bg-white/[0.10]"
        >
          Review
        </Link>
      </div>
    </Footer>
  );
}

function BlockedByMeFooter({
  sending,
  error,
  onUnblock,
}: {
  sending: boolean;
  error: string | null;
  onUnblock: () => Promise<void>;
}) {
  return (
    <Footer>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.8rem] text-text-muted">
          You&apos;ve blocked this member. They were never told.
        </p>
        <Button
          variant="ghost"
          size="sm"
          loading={sending}
          className="shrink-0"
          onClick={onUnblock}
        >
          Unblock
        </Button>
      </div>
      {error && <p role="alert" className="mt-2 text-[0.8rem] text-[#ff8080]">{error}</p>}
    </Footer>
  );
}

function UnavailableFooter() {
  return (
    <Footer>
      <p className="text-[0.8rem] text-text-muted">
        You can&apos;t send a request to this member right now.
      </p>
    </Footer>
  );
}

function NoneFooter({
  firstName,
  surname,
  ids,
  quota,
  composing,
  setComposing,
  note,
  setNote,
  sending,
  error,
  setError,
  consentVersion,
  onSend,
}: {
  firstName: string;
  surname: string;
  ids: Ids;
  quota: Quota | null;
  composing: boolean;
  setComposing: (b: boolean) => void;
  note: string;
  setNote: (s: string) => void;
  sending: boolean;
  error: string | null;
  setError: (s: string | null) => void;
  consentVersion: string | null;
  onSend: (e: { currentTarget: HTMLElement }) => void;
}) {
  const cleaned = cleanNote(note);
  const used = cleaned ? noteLength(cleaned) : 0;
  const tooLong = used > CONNECTION_NOTE_MAX;
  const limited = limitMessage(quota);

  return (
    <Footer>
      <div className="flex items-center justify-between gap-3">
        <p id={ids.status} className="text-[0.8rem] text-text-muted">
          {limited ?? "Connect to exchange email addresses."}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setComposing(true)}
          className="shrink-0"
          disabled={!!limited}
          aria-describedby={limited ? ids.status : undefined}
        >
          Connect
        </Button>
      </div>

      {/* A real confirmation, nested inside the member dialog. Safe to
          nest: closeDialog() closes the nearest <dialog>, and Escape only
          ever reaches the top one. ✕, Cancel and Escape all leave the
          member exactly where they were — nothing sent, Connect still
          there for later. */}
      {composing && (
        <ConnectDialog
          firstName={firstName}
          surname={surname}
          ids={ids}
          note={note}
          setNote={setNote}
          used={used}
          tooLong={tooLong}
          error={error}
          sending={sending}
          consentVersion={consentVersion}
          onClose={() => { setComposing(false); setError(null); }}
          onSend={onSend}
        />
      )}
    </Footer>
  );
}

function ConnectDialog({
  firstName,
  surname,
  ids,
  note,
  setNote,
  used,
  tooLong,
  error,
  sending,
  consentVersion,
  onClose,
  onSend,
}: {
  firstName: string;
  surname: string;
  ids: Ids;
  note: string;
  setNote: (s: string) => void;
  used: number;
  tooLong: boolean;
  error: string | null;
  sending: boolean;
  consentVersion: string | null;
  onClose: () => void;
  onSend: (e: { currentTarget: HTMLElement }) => void;
}) {
  return (
    <Dialog
      onClose={onClose}
      label={`Connect with ${firstName} ${surname}?`}
      className="w-full max-w-[480px] rounded-2xl bg-bg-card border border-border shadow-2xl my-auto"
    >
      <div className="px-6 py-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-[1.15rem] text-text-primary tracking-tight">
            Connect with {firstName} {surname}?
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={closeDialog}
            disabled={sending}
            className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border-strong bg-white/[0.05] text-text-primary transition-colors hover:border-accent hover:bg-white/[0.10] disabled:opacity-60"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="mt-3 space-y-3">
          <p className="text-[0.85rem] text-text-secondary leading-relaxed">
            If {firstName} accepts, you&apos;ll each be able to see the other&apos;s email address.
          </p>
          <div>
            <label
              htmlFor={ids.note}
              className="block text-[0.7rem] uppercase tracking-wider text-text-muted mb-1.5"
            >
              Add a note (optional)
            </label>
            <textarea
              id={ids.note}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              // maxLength is generous rather than exact: the note is
              // cleaned before it is counted, so trailing whitespace is
              // not part of the budget and a hard stop at 300 raw
              // characters would cut a legitimate note short.
              maxLength={CONNECTION_NOTE_MAX * 2}
              placeholder="Why you'd like to connect."
              aria-describedby={ids.count}
              className="w-full rounded-lg border border-border-strong bg-bg-secondary px-3 py-2 text-[0.85rem] text-text-primary placeholder:text-text-muted"
            />
            {/* Described by the textarea AND a live region, because going
                over the limit disables Send. Colour alone was the only
                signal, which is WCAG 1.4.1 and, more practically, leaves
                somebody pasting a long note with a dead button and no
                stated reason. Polite, so it waits for a pause in typing
                rather than interrupting every keystroke. */}
            <div
              id={ids.count}
              aria-live="polite"
              className={`mt-1 text-[0.7rem] ${tooLong ? "text-[#ff8080]" : "text-text-muted"}`}
            >
              {used}/{CONNECTION_NOTE_MAX}
              {tooLong && ` — too long to send, shorten it by ${used - CONNECTION_NOTE_MAX}`}
            </div>
          </div>
          {error && (
            <p role="alert" className="text-[0.8rem] text-[#ff8080]">{error}</p>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={closeDialog} disabled={sending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={sending}
            disabled={tooLong || !consentVersion}
            onClick={onSend}
          >
            Send request
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
