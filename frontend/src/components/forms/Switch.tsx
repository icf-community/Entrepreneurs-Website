// A labelled on/off switch: a real checkbox with role="switch", so it is
// focusable, announced with its state, and toggled by space.
export function Switch({
  id, checked, busy, onChange, label, hint,
}: {
  id: string;
  checked: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-[0.85rem] text-text-primary cursor-pointer">
          {label}
        </label>
        <p className="mt-0.5 text-[0.75rem] text-text-muted leading-relaxed">{hint}</p>
      </div>
      {/* A real checkbox with role="switch", not a div: it is focusable,
          it is announced with its state, and space toggles it — none of
          which a styled div gets for free. */}
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={busy}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-5 w-5 shrink-0 cursor-pointer accent-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
      />
    </div>
  );
}
