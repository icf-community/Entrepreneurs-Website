import type { ComponentProps, ReactNode, Ref } from "react";

// ════════════════════════════════════════════════════════════════════
// Foundry · Checkbox (Lumen)
//
// A real <input type="checkbox"> redrawn: a rounded square that lights amber with
// a drawn tick when on. Native semantics are untouched (focus, space to toggle,
// checked, indeterminate, form value, accessible name), only the face changes.
//
//   label    the words beside the box. With a label it renders <label><input/><span/></label>
//            so the whole line is the target and names the box. Without one it renders the
//            bare input: give it an aria-label (a table's select-row box).
//   hint     a second line under the label, in muted ink. It sits inside the label, so it is
//            read with the name.
//   card     the whole row is a bordered card that lights when chosen (a short list of options)
//   indeterminate   the dash state of a "select all" box (a property, not an attribute)
//
// `className` goes on the outer element: the label when there is one, the input when not.
// An error belongs in the surrounding <Field group error> or in a data-invalid wrapper, which
// turns the box's edge to danger.
// ════════════════════════════════════════════════════════════════════

type CheckProps = Omit<ComponentProps<"input">, "type"> & {
  label?: ReactNode;
  hint?: ReactNode;
  card?: boolean;
  indeterminate?: boolean;
};

function assign<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

export function Checkbox({ label, hint, card = false, indeterminate, className = "", ref, ...rest }: CheckProps) {
  // `indeterminate` is a DOM property with no attribute, so it is set through a ref; without the prop the caller's ref passes straight through
  const setRef =
    indeterminate === undefined
      ? ref
      : (el: HTMLInputElement | null) => {
          if (el) el.indeterminate = indeterminate;
          assign(ref, el);
        };
  const input = <input {...rest} type="checkbox" ref={setRef} className={`lm-check ${label === undefined ? className : ""}`} />;
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
