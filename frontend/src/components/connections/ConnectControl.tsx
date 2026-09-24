"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Dialog, closeDialog, dialogCloser } from "@/components/ui/Dialog";
import { ConfirmDialog } from "@/components/connections/ConfirmDialog";
import { browserClient } from "@/lib/supabase/browser";
import { sendConnectionRequest, unblockMember, withdrawConnectionRequest } from "@/app/connections/actions";
import { CONNECTION_NOTE_MAX, cleanNote, noteLength } from "@/lib/validation/connections";

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

function formatWhen(iso: string): string {
  const at = new Date(iso);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, year: "numeric", month: "2-digit", day: "2-digit" });
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hour: "2-digit", minute: "2-digit" }).format(at);
  const now = new Date();
  if (day.format(at) === day.format(now)) return `${time} today`;
  if (day.format(at) === day.format(new Date(now.getTime() + 86_400_000))) return `${time} tomorrow`;
  return new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, weekday: "short", day: "numeric", month: "short" }).format(at);
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

export function ConnectControl({
  memberId,
  firstName,
  surname,
}: {
  memberId: string;
  firstName: string;
  surname: string;
}) {
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

  // All three reads on open, in one round. connection_state_with is
  // sub-millisecond (it is one lookup on the canonical-pair index); the
  // consent version and the kill switch are each a single app_config row.
  useEffect(() => {
    let cancelled = false;
    const db = browserClient();

    Promise.all([
      db.rpc("connection_state_with", { p_member: memberId }),
      db.rpc("connection_consent_version"),
      db.rpc("connections_enabled"),
      db.rpc("my_connection_quota"),
    ]).then(
      ([stateRes, versionRes, enabledRes, quotaRes]) => {
        if (cancelled) return;
        if (stateRes.error || versionRes.error) {
          console.error("Failed to load connection state:", stateRes.error ?? versionRes.error);
          setState("error");
          return;
        }
        const row = Array.isArray(stateRes.data) ? stateRes.data[0] : stateRes.data;
        setState((row?.state as State) ?? "error");
        setConnectionId(row?.connection_id ?? null);
        setAvailableAt(row?.available_at ?? null);
        const quotaRow = Array.isArray(quotaRes.data) ? quotaRes.data[0] : null;
        setQuota(quotaRes.error ? null : (quotaRow as Quota | undefined) ?? null);
        setConsentVersion(typeof versionRes.data === "string" ? versionRes.data : null);
        // Fail open on this one read only: a failed kill-switch check must
        // not itself hide the Connect button — the RPC's own gate is still
        // the enforcement, this is only what the button says beforehand.
        setEnabled(enabledRes.error ? true : enabledRes.data !== false);
      },
      (e: unknown) => {
        if (cancelled) return;
        console.error("Failed to load connection state:", e);
        setState("error");
      },
    );

    return () => { cancelled = true; };
  }, [memberId]);

  // Re-read after any action rather than assuming its outcome.
  async function refresh() {
    const db = browserClient();
    const [stateRes, quotaRes] = await Promise.all([
      db.rpc("connection_state_with", { p_member: memberId }),
      db.rpc("my_connection_quota"),
    ]);
    const row = Array.isArray(stateRes.data) ? stateRes.data[0] : null;
    setState((row?.state as State) ?? "error");
    setConnectionId(row?.connection_id ?? null);
    setAvailableAt(row?.available_at ?? null);
    const quotaRow = Array.isArray(quotaRes.data) ? quotaRes.data[0] : null;
    setQuota(quotaRes.error ? null : (quotaRow as Quota | undefined) ?? null);
  }

  async function send(e: { currentTarget: HTMLElement }) {
    if (!consentVersion) return;
    // Resolved before the await — see dialogCloser.
    const close = dialogCloser(e);
    setSending(true);
    setError(null);
    const res = await sendConnectionRequest({
      memberId,
      note: note || undefined,
      consentVersion,
    });
    setSending(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }
    // The RPC accepts on the spot when they already had a request out to
    // you — two people agreeing is not a conflict — so the outcome is not
    // always "pending". Re-read rather than assuming.
    await refresh();
    setNote("");
    close();
  }

  // Nothing at all for your own profile, and nothing while we are still
  // finding out — a Connect button that might turn into "Connected" a
  // moment later is worse than a beat of nothing.
  if (state === "loading" || state === "self") return null;

  if (state === "error") {
    return (
      <Footer>
        <p className="text-[0.8rem] text-text-muted">
          Couldn&apos;t check your connection status. Refresh to try again.
        </p>
      </Footer>
    );
  }

  if (state === "connected") {
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

  // LinkedIn's shape: the Connect button becomes Pending, and Pending is
  // where you withdraw. Withdrawing holds only YOU for three weeks — the
  // dialog says so, and says they can still reach you.
  if (state === "pending_outgoing") {
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
            onConfirm={() => withdrawConnectionRequest({ connectionId })}
            onSuccess={() => { void refresh(); }}
            onClose={() => setWithdrawing(false)}
          />
        )}
      </Footer>
    );
  }

  if (state === "withdrawn_by_me") {
    return (
      <Footer>
        <p className="text-[0.8rem] text-text-muted">
          You withdrew your request.
          {availableAt && <> You can send {firstName} a new one from {formatWhen(availableAt)}.</>}
        </p>
      </Footer>
    );
  }

  if (state === "pending_incoming") {
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

  if (state === "blocked_by_me") {
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
            onClick={async () => {
              setSending(true);
              setError(null);
              const res = await unblockMember({ memberId });
              setSending(false);
              if (!res.ok) { setError(res.error); return; }
              // Unblocking deletes the row, so the pair is back to having
              // no history at all — which is `none`, not `connected`.
              setState("none");
            }}
          >
            Unblock
          </Button>
        </div>
        {error && <p role="alert" className="mt-2 text-[0.8rem] text-[#ff8080]">{error}</p>}
      </Footer>
    );
  }

  // `unavailable` is the one message four different situations share, and
  // it says nothing about which. That is the point.
  //
  // A paused kill switch joins the same message rather than getting its
  // own: `send_connection_request` refuses on it just like block/cooldown/
  // paused-recipient do, so a `none` pair under a paused switch is really a
  // fifth case of the same thing, not a new one that needs distinguishing.
  if (state === "unavailable" || (state === "none" && !enabled)) {
    return (
      <Footer>
        <p className="text-[0.8rem] text-text-muted">
          You can&apos;t send a request to this member right now.
        </p>
      </Footer>
    );
  }

  // state === "none"
  const cleaned = cleanNote(note);
  const used = cleaned ? noteLength(cleaned) : 0;
  const tooLong = used > CONNECTION_NOTE_MAX;

  const limited = limitMessage(quota);

  return (
    <Footer>
      <div className="flex items-center justify-between gap-3">
        <p id="connect-status" className="text-[0.8rem] text-text-muted">
          {limited ?? "Connect to exchange email addresses."}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setComposing(true)}
          className="shrink-0"
          disabled={!!limited}
          aria-describedby={limited ? "connect-status" : undefined}
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
        <Dialog
          onClose={() => { setComposing(false); setError(null); }}
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
                  htmlFor="connect-note"
                  className="block text-[0.7rem] uppercase tracking-wider text-text-muted mb-1.5"
                >
                  Add a note (optional)
                </label>
                <textarea
                  id="connect-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  // maxLength is generous rather than exact: the note is
                  // cleaned before it is counted, so trailing whitespace is
                  // not part of the budget and a hard stop at 300 raw
                  // characters would cut a legitimate note short.
                  maxLength={CONNECTION_NOTE_MAX * 2}
                  placeholder="Why you'd like to connect."
                  aria-describedby="connect-note-count"
                  className="w-full rounded-lg border border-border-strong bg-bg-secondary px-3 py-2 text-[0.85rem] text-text-primary placeholder:text-text-muted"
                />
                {/* Described by the textarea AND a live region, because going
                    over the limit disables Send. Colour alone was the only
                    signal, which is WCAG 1.4.1 and, more practically, leaves
                    somebody pasting a long note with a dead button and no
                    stated reason. Polite, so it waits for a pause in typing
                    rather than interrupting every keystroke. */}
                <div
                  id="connect-note-count"
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
                onClick={send}
              >
                Send request
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </Footer>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return <section className="pt-4 border-t border-border-subtle">{children}</section>;
}
