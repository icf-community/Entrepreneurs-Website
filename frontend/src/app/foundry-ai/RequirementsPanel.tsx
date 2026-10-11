"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import type { JobRequirements, SpecAtom } from "@/lib/ai/types";
import { confirmRequirements, loadJobRequirements } from "./actions";

// ════════════════════════════════════════════════════════════════════
// The poster confirms what the job requires before a recruiter search
// runs (AI-plan §7.1, §14.3). The list was read from the job's own text;
// the poster can drop anything wrong and say which items are must-haves.
// Nothing here is invented: an item is a dictionary skill or a phrase
// copied from the advert. Editing the job's text sends it back here.
// ════════════════════════════════════════════════════════════════════

export function RequirementsPanel({ jobId, onConfirmed }: { jobId: string; onConfirmed: () => void }) {
  const [reqs, setReqs] = useState<JobRequirements | undefined>(undefined);
  const [atoms, setAtoms] = useState<SpecAtom[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Remounted per job (key={jobId}), so the first render is the loading state.
    let cancelled = false;
    loadJobRequirements(jobId).then((res) => {
      if (cancelled) return;
      if (!res.ok) { setError(res.error); setReqs(null); return; }
      setReqs(res.data);
      setAtoms(res.data?.atoms ?? []);
    });
    return () => { cancelled = true; };
  }, [jobId]);

  if (reqs === undefined) return <Skeleton className="h-24 w-full rounded-2xl" />;

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await confirmRequirements(jobId, atoms.map((a) => ({ id: a.id, required: a.required })), reqs!.content_version);
    setSaving(false);
    if (!res.ok) { setError(res.error); return; }
    onConfirmed();
  };

  const pending = !reqs || reqs.status === "pending";
  return (
    <section className="rounded-2xl border border-border bg-bg-card p-5" aria-labelledby="req-heading">
      <h2 id="req-heading" className="text-[0.95rem] font-medium text-text-primary">Confirm what this job requires</h2>
      <p className="mt-1 text-[0.8rem] text-text-muted">
        {pending
          ? "We're still reading this job's description. Check back in a minute."
          : reqs?.status === "failed"
            ? "We couldn't read the requirements automatically. You can still search by describing who you need."
            : "Remove anything that's wrong and mark the must-haves."}
      </p>
      {!pending && atoms.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {atoms.map((a) => (
            <li key={a.id} className="inline-flex items-center gap-1 rounded-lg border border-border-strong bg-white/[0.04] px-2.5 py-1.5 text-[0.8rem]">
              <span className="text-text-primary">{a.label}</span>
              <button
                type="button"
                className="cursor-pointer rounded-md border border-border-strong bg-white/[0.05] px-2 py-1 text-[0.7rem] text-text-secondary hover:border-accent"
                onClick={() => setAtoms((xs) => xs.map((x) => (x.id === a.id ? { ...x, required: !x.required } : x)))}
                aria-pressed={a.required}
              >
                {a.required ? "Must have" : "Nice to have"}
              </button>
              <button
                type="button"
                className="cursor-pointer rounded-md border border-border-strong bg-white/[0.05] px-2 py-1 text-[0.7rem] text-text-secondary hover:border-accent"
                onClick={() => setAtoms((xs) => xs.filter((x) => x.id !== a.id))}
                aria-label={`Remove ${a.label}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-3 text-[0.8rem] text-[#ff8080]">{error}</p>}
      {!pending && (
        <Button className="mt-4" size="sm" loading={saving} onClick={save}>
          Confirm requirements
        </Button>
      )}
    </section>
  );
}
