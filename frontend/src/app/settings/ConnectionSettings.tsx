"use client";

import { useState } from "react";
import { updateConnectionSettings } from "@/app/connections/actions";
import { Switch } from "@/components/forms/Switch";

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
