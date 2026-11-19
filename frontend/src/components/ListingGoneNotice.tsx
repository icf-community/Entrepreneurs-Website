import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

// Rendered inside an expanded listing card when useListingFreshness
// reports the row is gone. The viewer gets a friendly message and a
// button to remove the now-irrelevant card from their local list.
// Drawn as a compact EmptyState inside the card, under a hairline: where the
// card is a Disclosure its panel already draws that rule, so this one steps
// aside there rather than doubling it.

export function ListingGoneNotice({
  kind, onDismiss,
}: {
  kind: "opportunity" | "event" | "VC/grant";
  onDismiss: () => void;
}) {
  return (
    <div className="border-t border-border-subtle [.lm-disclosure__body_&]:border-t-0">
      <EmptyState
        bare
        size="compact"
        icon="eye-off"
        title={<>Sorry — this {kind} is no longer available.</>}
        action={
          <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
            Remove from list
          </Button>
        }
      >
        The poster may have removed it, or an admin pulled it from the directory. Refresh the page to see the latest set.
      </EmptyState>
    </div>
  );
}
