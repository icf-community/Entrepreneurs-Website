// A labelled on/off switch: a real checkbox with role="switch", so it is
// focusable, announced with its state, and toggled by space. The label and
// the one-line hint sit on the left; the switch is a pill track with a ring for
// a knob, which travels and lights amber when on (.lm-switch in forms.css).
// While a request is in flight (`busy`) it is disabled and the knob's ring
// turns dotted and spins, so waiting is not mistaken for "off".
export function Switch({
  id, checked, busy, onChange, label, hint, disabled = false,
}: {
  id: string;
  checked: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint: string;
  /** Not available right now (a setting that depends on another one): quieter, and not a request in flight. */
  disabled?: boolean;
}) {
  const hintId = `${id}-hint`;
  return (
    <div className="flex items-start justify-between gap-5">
      <div className="min-w-0">
        <label htmlFor={id} className="block cursor-pointer text-body text-text-primary">
          {label}
        </label>
        <p id={hintId} className="mt-0.5 text-small leading-relaxed text-text-muted">{hint}</p>
      </div>
      {/* A real checkbox with role="switch", not a div: it is focusable,
          it is announced with its state, and space toggles it — none of
          which a styled div gets for free. The hint is its description. */}
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={busy || disabled}
        aria-busy={busy || undefined}
        aria-describedby={hintId}
        onChange={(e) => onChange(e.target.checked)}
        className="lm-switch -mt-0.5"
      />
    </div>
  );
}
