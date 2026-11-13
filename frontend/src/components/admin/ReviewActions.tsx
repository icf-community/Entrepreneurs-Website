import { Button } from "@/components/ui/Button";

// Shared by the events/opportunities/vcs/users admin review cards: the
// approve/reject footer and the reject-with-reason form it opens into.
export function ApprovalActions({ pending, onApprove, onReject }: {
  pending: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="flex gap-2 pt-3 border-t border-border-subtle">
      <Button type="button" onClick={onApprove} disabled={pending} variant="primary" size="sm">
        {pending ? "Approving…" : "Approve"}
      </Button>
      <Button type="button" onClick={onReject} disabled={pending} variant="dangerGhost" size="sm">
        Reject
      </Button>
    </div>
  );
}

export function RejectionForm({ id, reason, onReasonChange, placeholder, label, confirmLabel, pending, onConfirm, onCancel }: {
  id: string;
  reason: string;
  onReasonChange: (v: string) => void;
  placeholder?: string;
  label: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-3 pt-3 border-t border-border-subtle">
      <label htmlFor={id} className="block text-small text-text-muted">
        {label}
      </label>
      <textarea
        id={id}
        rows={2}
        value={reason}
        onChange={(e) => onReasonChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-tint-1 border border-border rounded-lg text-body text-text-primary placeholder:text-text-muted focus:border-accent/50 resize-none"
      />
      <div className="flex gap-2">
        <Button type="button" onClick={onConfirm} disabled={pending || !reason.trim()} variant="danger" size="sm">
          {pending ? "Rejecting…" : confirmLabel}
        </Button>
        <Button type="button" onClick={onCancel} disabled={pending} variant="ghost" size="sm">
          Cancel
        </Button>
      </div>
    </div>
  );
}
