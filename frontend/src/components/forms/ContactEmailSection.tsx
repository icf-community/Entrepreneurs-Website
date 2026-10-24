import type { ReactNode } from "react";
import { FieldError } from "@/components/forms/Field";
import { inputCls } from "@/components/forms/styles";

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
    <div className="pt-2 border-t border-border-subtle">
      <div className="text-[0.85rem] text-text-primary mb-3 mt-3">Contact email</div>
      <p className="text-[0.75rem] text-text-muted leading-relaxed mb-3">{description}</p>
      <label className="flex items-center gap-2 text-[0.8rem] text-text-secondary mb-3 cursor-pointer">
        <input type="checkbox" checked={useCustomContact} onChange={(e) => onUseCustomContactChange(e.target.checked)} />
        Use a different contact email
      </label>
      <div data-invalid={error ? "" : undefined}>
        {useCustomContact ? (
          <input type="email" aria-label="Contact email" placeholder="contact@example.com" value={customContactEmail} onChange={(e) => onCustomContactEmailChange(e.target.value)} className={inputCls} required />
        ) : (
          <div className="px-4 py-3 bg-white/[0.02] border border-border-subtle rounded-lg text-[0.8rem] text-text-muted">
            {signupEmail}
          </div>
        )}
        <FieldError>{error}</FieldError>
      </div>
      <label className="flex items-start gap-2 text-[0.8rem] text-text-secondary mt-3 cursor-pointer">
        <input type="checkbox" className="mt-0.5" checked={contactEmailVisible} onChange={(e) => onContactEmailVisibleChange(e.target.checked)} />
        <span>
          {visibleLabel}
          <span className="text-text-muted block text-[0.75rem] mt-0.5">{visibleHelp}</span>
        </span>
      </label>
    </div>
  );
}
