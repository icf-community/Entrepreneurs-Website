import { cloneElement, isValidElement, useId, type ReactNode } from "react";
import { Icon } from "@/design-system/icons/Icon";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { labelCls } from "./styles";

// Label + control pair, with an optional inline error caption.
//
// The control is nested *inside* the <label> rather than pointed at by
// htmlFor. That gives implicit label association for free — every field
// in the app announces its name to a screen reader, and clicking the
// label text focuses the control — without every call site having to
// invent and thread an id. A <label> can only name one control, so a
// field holding several (a radio group) passes `group` and gets
// fieldset/legend instead — nesting labels is invalid and would leave the
// group unnamed.
//
// The error caption sits outside the <label> deliberately: text inside a
// label becomes part of the control's accessible *name*, which would make
// it read back as "Role title Role title is required". role="alert" gets
// it announced when it appears without polluting the name. The control is
// tied to it through aria-describedby (and marked aria-invalid), which adds
// the message to the control's *description*, not its name.
//
// data-invalid is what showFieldErrors() (lib/validation/fields) looks for,
// so forms can send focus to the first failing control without every call
// site having to name itself. It is also what the stylesheet reads to turn
// the control's edge to the danger light (forms.css).
//
// The look: the label is sentence case, small, medium weight, secondary ink
// (.lm-label); the required star is a point of light and stays inside the
// label's span, so getByLabel(/^Role title/) still names the control; the
// error is a drawn mark and a sentence in the danger ink.

type ControlProps = { "aria-describedby"?: string };

// The only children Field reaches into to add aria-invalid / aria-describedby: one native control, or our wrapper of it.
const CONTROLS: readonly unknown[] = ["input", "textarea", "select", Input, Textarea, Select];

export function Field({
  label, required, hint, error, group, children,
}: {
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  /** Message to show beneath the control. Also marks the field invalid. */
  error?: string;
  /**
   * Set when the field holds several controls rather than one — a radio
   * group. Renders fieldset/legend instead, because a <label> can only name
   * one control, and wrapping several (each already in its own <label>)
   * nests labels, which is invalid and leaves the group unnamed.
   */
  group?: boolean;
  children: ReactNode;
}) {
  const errorId = useId();
  const caption = (
    <>
      {label} {required && <span className="lm-label__req">*</span>}
      {hint && <span className="lm-label__hint">{hint}</span>}
    </>
  );

  if (group) {
    return (
      <fieldset data-invalid={error ? "" : undefined} aria-describedby={error ? errorId : undefined} className="min-w-0">
        <legend className={`${labelCls} mb-2`}>{caption}</legend>
        {children}
        <FieldError id={errorId}>{error}</FieldError>
      </fieldset>
    );
  }

  // When the field is wrong, tie its control to the message. Anything that is not a single control is left exactly as the caller wrote it.
  let control = children;
  if (error && isValidElement<ControlProps>(children) && CONTROLS.includes(children.type)) {
    const describedBy = [children.props["aria-describedby"], errorId].filter(Boolean).join(" ");
    control = cloneElement(children, { "aria-invalid": true, "aria-describedby": describedBy } as ControlProps);
  }

  return (
    <div data-invalid={error ? "" : undefined}>
      <label className="block">
        <span className={`${labelCls} mb-2`}>{caption}</span>
        {control}
      </label>
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

/**
 * The error caption on its own, for the handful of controls that sit
 * outside a Field (the contact-email and apply-link blocks, and the
 * contact form, which have their own bespoke layout). Wrap those in an
 * element carrying data-invalid so showFieldErrors() can still reach them.
 * A drawn mark and the sentence; `id` lets a control point at it.
 */
export function FieldError({ children, id }: { children?: string; id?: string }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="lm-error">
      <Icon name="error" size={18} />
      {children}
    </p>
  );
}
