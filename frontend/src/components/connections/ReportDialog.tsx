"use client";

import { useState } from "react";
import { Dialog, closeDialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { reportConnection } from "@/app/connections/actions";
import { CONNECTION_REPORT_CATEGORIES } from "@/lib/validation/connections";

// ════════════════════════════════════════════════════════════════════
// Foundry · Reporting a connection
//
// The same categories and the same shape as a community post report,
// deliberately: members should not have to learn two vocabularies for
// "this was inappropriate".
//
// What differs is what happens next. A post report is about content
// thousands of people can see, so it emails the moderation inbox. This
// is about a one-to-one interaction nobody else can see, so it goes into
// the admin queue and nothing is taken down — there is nothing public to
// take down. The RPC snapshots the note text at report time, because the
// connection row is eventually hard-deleted and a report pointing at a
// deleted row would be unadjudicable.
// ════════════════════════════════════════════════════════════════════

export function ReportDialog({
  connectionId,
  theirName,
  onClose,
}: {
  connectionId: string;
  theirName: string;
  onClose: () => void;
}) {
  const [category, setCategory] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await reportConnection({ connectionId, category, reason });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDone(true);
  }

  // A receipt, not a silent close — the same pattern the community report
  // uses (`app/community/PostCard.tsx`). Reporting somebody takes nerve and
  // produces nothing visible: nothing is taken down, the other member is
  // never told, and a dialog that just vanishes is indistinguishable from
  // one that failed. Saying what happens next is the whole of the feedback
  // this action can give.
  if (done) {
    return (
      <Dialog
        onClose={onClose}
        label="Report received"
        className="w-full max-w-[480px] rounded-2xl bg-bg-card border border-border shadow-2xl my-auto"
      >
        <div className="px-6 py-5">
          <h2 className="font-display text-[1.15rem] text-text-primary tracking-tight">
            Thanks — that&rsquo;s with us
          </h2>
          <p className="mt-2 text-[0.85rem] text-text-secondary leading-relaxed">
            An admin will look at this and email you once they&rsquo;ve decided, either way.{" "}
            {theirName} is not told that you reported them.
          </p>
          <p className="mt-2 text-[0.8rem] text-text-muted leading-relaxed">
            If you&rsquo;d rather not hear from them again in the meantime, blocking them is
            separate from this and takes effect immediately.
          </p>
          <div className="mt-5 flex justify-end">
            <Button variant="ghost" size="sm" onClick={closeDialog}>
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      onClose={onClose}
      label={`Report ${theirName}`}
      className="w-full max-w-[480px] rounded-2xl bg-bg-card border border-border shadow-2xl my-auto"
    >
      <div className="px-6 py-5">
        <h2 className="font-display text-[1.15rem] text-text-primary tracking-tight">
          Report {theirName}
        </h2>
        <p className="mt-2 text-[0.8rem] text-text-muted leading-relaxed">
          This goes to Foundry admins. They can read any note that was sent with the
          original request, and every read of one is logged.
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="report-category"
              className="block text-[0.7rem] uppercase tracking-wider text-text-muted mb-1.5"
            >
              Reason
            </label>
            <select
              id="report-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-border-strong bg-bg-secondary px-3 py-2 text-[0.85rem] text-text-primary"
            >
              <option value="">Choose a reason…</option>
              {CONNECTION_REPORT_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="report-reason"
              className="block text-[0.7rem] uppercase tracking-wider text-text-muted mb-1.5"
            >
              What happened?
            </label>
            <textarea
              id="report-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              maxLength={1000}
              placeholder="Tell us a little more so an admin can act on this."
              className="w-full rounded-lg border border-border-strong bg-bg-secondary px-3 py-2 text-[0.85rem] text-text-primary placeholder:text-text-muted"
            />
          </div>
        </div>

        {error && <p role="alert" className="mt-3 text-[0.8rem] text-[#ff8080]">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={closeDialog} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={busy}
            disabled={!category || reason.trim().length < 10}
            onClick={submit}
          >
            Send report
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
