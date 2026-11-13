"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { closeDialog } from "@/components/ui/dialogCloser";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/forms/Field";
import { ErrorBanner } from "@/components/forms/Banners";
import { reportConnection } from "@/app/connections/actions";
import { CONNECTION_REPORT_CATEGORIES } from "@/lib/validation/connections";
import { settle } from "@/lib/settle";

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
    const res = await settle(reportConnection({ connectionId, category, reason }));
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDone(true);
  }

  // A receipt, not a silent close — the same pattern the community report
  // dialog uses (`app/community/PostCard.tsx`). Reporting somebody takes nerve and
  // produces nothing visible: nothing is taken down, the other member is
  // never told, and a dialog that just vanishes is indistinguishable from
  // one that failed. Saying what happens next is the whole of the feedback
  // this action can give.
  if (done) {
    return (
      <Dialog
        onClose={onClose}
        label="Report received"
        className="w-full max-w-[480px] p-6 sm:p-7 my-auto"
      >
        <h2 className="font-display text-title text-text-primary">
          Thanks — that&rsquo;s with us
        </h2>
        <p className="mt-3 text-body leading-relaxed text-text-secondary">
          An admin will look at this and email you once they&rsquo;ve decided, either way.{" "}
          {theirName} is not told that you reported them.
        </p>
        <p className="mt-2 text-body leading-relaxed text-text-muted">
          If you&rsquo;d rather not hear from them again in the meantime, blocking them is
          separate from this and takes effect immediately.
        </p>
        <div className="mt-7 flex justify-end">
          <Button variant="ghost" size="md" onClick={closeDialog}>
            Close
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      onClose={onClose}
      label={`Report ${theirName}`}
      className="w-full max-w-[480px] p-6 sm:p-7 my-auto"
    >
      <h2 className="font-display text-title text-text-primary">
        Report {theirName}
      </h2>
      <p className="mt-3 text-body leading-relaxed text-text-muted">
        This goes to Foundry admins. They can read any note that was sent with the
        original request, and every read of one is logged.
      </p>

      <div className="mt-5 grid gap-4">
        <Field label="Reason">
          <Select
            id="report-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Choose a reason…</option>
            {CONNECTION_REPORT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </Select>
        </Field>

        <Field label="What happened?">
          <Textarea
            id="report-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            maxLength={1000}
            placeholder="Tell us a little more so an admin can act on this."
          />
        </Field>
      </div>

      {error && <div className="mt-4"><ErrorBanner>{error}</ErrorBanner></div>}

      <div className="mt-7 flex flex-wrap items-center justify-end gap-2">
        <Button variant="quiet" size="md" onClick={closeDialog} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="danger"
          size="md"
          loading={busy}
          disabled={!category || reason.trim().length < 10}
          onClick={submit}
        >
          Send report
        </Button>
      </div>
    </Dialog>
  );
}
