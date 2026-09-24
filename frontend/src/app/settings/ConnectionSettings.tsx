"use client";

import { useState } from "react";
import { updateConnectionSettings } from "@/app/connections/actions";

// ════════════════════════════════════════════════════════════════════
// Foundry · The two connection switches
//
// Small controls, both load-bearing.
//
// DIGEST EMAILS. Not politeness. Auth mail and digests leave on the same
// sending domain, so spam complaints about a digest degrade the
// deliverability of SIGN-IN CODES. The opt-out protects the domain, which
// is why it is here and not buried.
//
// OPEN TO REQUESTS. A pause switch, and the people who need it are the
// most visible members in the directory — committee, mentors, angels.
// Without it, a swamped mentor's only options are declining forty
// requests or disengaging from the platform. Turning it off refuses new
// requests with the SAME generic message a block gives, so it cannot be
// used to work out why; existing connections and pending requests are
// untouched.
// ════════════════════════════════════════════════════════════════════

export default function ConnectionSettings({
  emailsEnabled: initialEmails,
  openToConnections: initialOpen,
}: {
  emailsEnabled: boolean;
  openToConnections: boolean;
}) {
  const [emails, setEmails] = useState(initialEmails);
  const [open, setOpen] = useState(initialOpen);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"emails" | "open" | null>(null);

  async function toggle(which: "emails" | "open", next: boolean) {
    // Optimistic, then reverted on failure. These are two booleans on the
    // caller's own row; making somebody wait on a round trip to see a
    // switch move is worse than the rare rollback.
    const setLocal = which === "emails" ? setEmails : setOpen;
    setLocal(next);
    setBusy(which);
    setError(null);

    const res = await updateConnectionSettings(
      which === "emails" ? { emailsEnabled: next } : { openToConnections: next },
    );
    setBusy(null);
    if (!res.ok) {
      setLocal(!next);
      setError(res.error);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-bg-card p-6">
      <h2 className="text-[0.95rem] font-medium text-text-primary">Connections</h2>

      <div className="mt-4 space-y-4">
        <Switch
          id="conn-open"
          checked={open}
          busy={busy === "open"}
          onChange={(v) => toggle("open", v)}
          label="Accept new connection requests"
          hint="Turn this off to pause requests without affecting the connections you already have. Nobody is told."
        />
        <Switch
          id="conn-emails"
          checked={emails}
          busy={busy === "emails"}
          onChange={(v) => toggle("emails", v)}
          label="Email me about pending requests"
          hint="One daily summary, only when something is waiting. Requests still appear in Foundry either way."
        />
      </div>

      {error && <p role="alert" className="mt-3 text-[0.8rem] text-[#ff8080]">{error}</p>}
    </section>
  );
}

function Switch({
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
