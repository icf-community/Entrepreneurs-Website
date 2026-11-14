import { Button } from "@/components/ui/Button";
import { Field } from "@/components/forms/Field";
import { Textarea } from "@/components/ui/Textarea";
import { Icon } from "@/design-system/icons/Icon";
import { OrbitGlyph } from "@/design-system/OrbitGlyph";

// Shared by the events/opportunities/vcs/users admin review cards: the
// approve/reject footer and the reject-with-reason form it opens into.
//
// Row anatomy is the same on every queue: the one primary action first
// (Approve, with its mark), the destructive one beside it in a neutral skin
// that turns danger only as you reach for it, and a hairline above both so the
// footer reads as the card's own edge. While a request is in flight the mark
// becomes the orbit and the words say what is happening.
export function ApprovalActions({ pending, onApprove, onReject }: {
  pending: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 pt-4 border-t border-border-subtle">
      <Button
        type="button"
        onClick={onApprove}
        disabled={pending}
        variant="primary"
        size="sm"
        leading={pending ? <OrbitGlyph spin="fast" /> : <Icon name="check" size={18} />}
      >
        {pending ? "Approving…" : "Approve"}
      </Button>
      <Button
        type="button"
        onClick={onReject}
        disabled={pending}
        variant="dangerGhost"
        size="sm"
        leading={<Icon name="close" size={18} />}
      >
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
    <div className="grid gap-4 pt-4 border-t border-border-subtle">
      <Field label={label}>
        <Textarea
          id={id}
          rows={2}
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder={placeholder}
          className="resize-none"
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={onConfirm}
          disabled={pending || !reason.trim()}
          variant="danger"
          size="sm"
          leading={pending ? <OrbitGlyph spin="fast" /> : undefined}
        >
          {pending ? "Rejecting…" : confirmLabel}
        </Button>
        <Button type="button" onClick={onCancel} disabled={pending} variant="quiet" size="sm">
          Cancel
        </Button>
      </div>
    </div>
  );
}
