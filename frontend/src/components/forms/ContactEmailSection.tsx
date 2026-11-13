import type { ReactNode } from "react";
import { FieldError } from "@/components/forms/Field";
import { inputCls } from "@/components/forms/styles";
import { Checkbox } from "@/components/ui/Checkbox";
import { FieldGroup } from "@/components/ui/FormSection";

// Shared by the event, opportunity and VC listing forms: pick between the
// signup email and a custom one as the public contact, with a toggle for
// whether it's shown on the listing at all. `description` and
// `visibleHelp` carry the one or two sentences that differ per listing
// type; everything else about the control is identical.
export function ContactEmailSection({
  signupEmail, useCustomContact, onUseCustomContactChange, customContactEmail, onCustomContactEmailChange,
  contactEmailVisible, onContactEmailVisibleChange, error, description, visibleLabel, visibleHelp,
}: {
  signupEmail: string;
  useCustomContact: boolean;
  onUseCustomContactChange: (checked: boolean) => void;
  customContactEmail: string;
  onCustomContactEmailChange: (value: string) => void;
  contactEmailVisible: boolean;
  onContactEmailVisibleChange: (checked: boolean) => void;
  error?: string;
  description: ReactNode;
  visibleLabel: ReactNode;
  visibleHelp: ReactNode;
}) {
  return (
    <FieldGroup legend="Contact email" description={description}>
      <Checkbox
        label="Use a different contact email"
        checked={useCustomContact}
        onChange={(e) => onUseCustomContactChange(e.target.checked)}
      />
      <div data-invalid={error ? "" : undefined}>
        {useCustomContact ? (
          <input type="email" aria-label="Contact email" placeholder="contact@example.com" value={customContactEmail} onChange={(e) => onCustomContactEmailChange(e.target.value)} className={inputCls} required />
        ) : (
          <div className="lm-static">{signupEmail}</div>
        )}
        <FieldError>{error}</FieldError>
      </div>
      <Checkbox
        label={visibleLabel}
        hint={visibleHelp}
        checked={contactEmailVisible}
        onChange={(e) => onContactEmailVisibleChange(e.target.checked)}
      />
    </FieldGroup>
  );
}
