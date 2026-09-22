"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { browserClient } from "@/lib/supabase/browser";
import { sendConnectionRequest, unblockMember } from "@/app/connections/actions";
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
  | "blocked_by_me"
  | "unavailable"
  | "error";

export function ConnectControl({
  memberId,
  firstName,
}: {
  memberId: string;
  firstName: string;
}) {
  const [state, setState] = useState<State>("loading");
  const [consentVersion, setConsentVersion] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Both reads on open, in one round. connection_state_with is
  // sub-millisecond (it is one lookup on the canonical-pair index); the
  // consent version is a single app_config row.
  useEffect(() => {
    let cancelled = false;
    const db = browserClient();

    Promise.all([
      db.rpc("connection_state_with", { p_member: memberId }),
      db.rpc("connection_consent_version"),
    ]).then(
      ([stateRes, versionRes]) => {
        if (cancelled) return;
        if (stateRes.error || versionRes.error) {
          console.error("Failed to load connection state:", stateRes.error ?? versionRes.error);
          setState("error");
          return;
        }
        const row = Array.isArray(stateRes.data) ? stateRes.data[0] : stateRes.data;
        setState((row?.state as State) ?? "error");
        setConsentVersion(typeof versionRes.data === "string" ? versionRes.data : null);
      },
      (e: unknown) => {
        if (cancelled) return;
        console.error("Failed to load connection state:", e);
        setState("error");
      },
    );

    return () => { cancelled = true; };
  }, [memberId]);

  async function send() {
    if (!consentVersion) return;
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
    const { data } = await browserClient().rpc("connection_state_with", { p_member: memberId });
    const row = Array.isArray(data) ? data[0] : data;
    setState((row?.state as State) ?? "pending_outgoing");
    setComposing(false);
    setNote("");
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

  if (state === "pending_outgoing") {
    return (
      <Footer>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[0.8rem] text-text-secondary">Request sent — waiting for a reply.</p>
          <Link
            href="/connections?tab=sent"
            className="shrink-0 rounded-lg border border-border-strong bg-white/[0.05] px-3 py-1.5 text-[0.75rem] text-text-primary no-underline transition-colors hover:border-accent hover:bg-white/[0.10]"
          >
            Manage
          </Link>
        </div>
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
  if (state === "unavailable") {
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

  return (
    <Footer>
      {!composing ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[0.8rem] text-text-muted">
            Connect to exchange email addresses.
          </p>
          <Button variant="ghost" size="sm" onClick={() => setComposing(true)} className="shrink-0">
            Connect
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[0.8rem] text-text-secondary">
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

          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              loading={sending}
              disabled={tooLong || !consentVersion}
              onClick={send}
            >
              Send request
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setComposing(false); setError(null); }}
              disabled={sending}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Footer>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return <section className="pt-4 border-t border-border-subtle">{children}</section>;
}
