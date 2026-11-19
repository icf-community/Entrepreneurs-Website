import type { ComponentProps, ReactNode } from "react";

// ════════════════════════════════════════════════════════════════════
// Foundry · Radio (Lumen)
//
// A real <input type="radio"> redrawn: a ring with a small lit body in it when
// chosen. Native semantics are untouched, so arrow keys move between the radios
// that share a `name`, and the group is named by its <fieldset><legend> (or
// <Field group>). A set of radios is exclusive, so a short one reads best as cards.
//
//   label   the words beside the ring (renders <label><input/><span/></label>); without
//           it the bare input, which needs an aria-label
//   hint    a second line under the label, inside it
//   card    the whole row is a bordered card that lights when chosen: "Students / Graduates /
//           Both", "Contact me directly / Application portal link"
//
// `className` goes on the outer element: the label when there is one, the input when not.
// ════════════════════════════════════════════════════════════════════

export function Radio({
  label,
  hint,
  card = false,
  className = "",
  ...rest
}: Omit<ComponentProps<"input">, "type"> & { label?: ReactNode; hint?: ReactNode; card?: boolean }) {
  const input = <input {...rest} type="radio" className={`lm-radio ${label === undefined ? className : ""}`} />;
  if (label === undefined) return input;
  return (
    <label className={`lm-choice ${className}`} data-card={card || undefined}>
      {input}
      <span className="lm-choice__text">
        {label}
        {hint ? <span className="lm-choice__hint">{hint}</span> : null}
      </span>
    </label>
  );
}
