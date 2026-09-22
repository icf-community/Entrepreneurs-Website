"use client";

import { useState } from "react";
import { Dialog, closeDialog, dialogCloser } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { respondToConnectionRequest } from "@/app/connections/actions";

// ════════════════════════════════════════════════════════════════════
// Foundry · The accept dialog — the consent moment
//
// This is the act that releases two email addresses, and under Art. 7(1)
// consent has to be informed and demonstrable. Demonstrable is the
// consent_version stamped on the row by the RPC. Informed is this copy,
// and specifically the fact that it names the LITERAL ADDRESS BEING
// RELEASED rather than saying "your email".
//
// That distinction is the whole point. Members sign up with one address
// and live in another; alumni and angels in particular pass review with
// a personal address they may not be thinking of. "Priya will be able to
// see tom.whitfield@gmail.com" is a sentence someone can act on.
// "They'll see your email" is not.
//
// The other party's address is NOT shown here, because it is not known
// here — accepting is what discloses it. It appears on the card the
// moment this returns, which is the honest ordering.
// ════════════════════════════════════════════════════════════════════

export function AcceptDialog({
  connectionId,
  theirName,
  myEmail,
  consentVersion,
  onClose,
  onAccepted,
}: {
  connectionId: string;
  theirName: string;
  myEmail: string;
  consentVersion: string;
  onClose: () => void;
  onAccepted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept(e: { currentTarget: HTMLElement }) {
    // Resolved BEFORE the await: React clears e.currentTarget once the
    // event finishes dispatching, so closeDialog(e) after the round trip
    // closes nothing and leaves this sitting open over a completed accept.
    const close = dialogCloser(e);
    setBusy(true);
    setError(null);
    const res = await respondToConnectionRequest({
      connectionId,
      accept: true,
      consentVersion,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onAccepted();
    close();
  }

  return (
    <Dialog
      onClose={onClose}
      label={`Accept ${theirName}'s connection request`}
      className="w-full max-w-[480px] rounded-2xl bg-bg-card border border-border shadow-2xl my-auto"
    >
      <div className="px-6 py-5">
        <h2 className="font-display text-[1.15rem] text-text-primary tracking-tight">
          Connect with {theirName}?
        </h2>

        <div className="mt-3 space-y-3 text-[0.85rem] text-text-secondary leading-relaxed">
          <p>
            {theirName} will be able to see{" "}
            <strong className="text-text-primary break-all">{myEmail}</strong>, and you&apos;ll
            be able to see their address.
          </p>
          <p>
            Either of you can remove the connection later, which stops it being shown in
            Foundry — but it can&apos;t un-send an address someone already has.
          </p>
        </div>

        {error && <p role="alert" className="mt-3 text-[0.8rem] text-[#ff8080]">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={closeDialog} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" loading={busy} onClick={accept}>
            Accept and share
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
