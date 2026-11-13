"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { Icon } from "@/design-system/icons/Icon";
import type { JobRequirements, SpecAtom } from "@/lib/ai/types";
import { confirmRequirements, loadJobRequirements } from "./actions";

// ════════════════════════════════════════════════════════════════════
// The poster confirms what the job requires before a recruiter search
// runs (AI-plan §7.1, §14.3). The list was read from the job's own text;
// the poster can drop anything wrong and say which items are must-haves.
// Nothing here is invented: an item is a dictionary skill or a phrase
// copied from the advert. Editing the job's text sends it back here.
//
// Drawn as a ruled list, one requirement a row: its words on the left, and on
// the right the must-have toggle (a chip: aria-pressed, lit with a tick when
// it is a must-have) and a quiet Remove. A list reads faster than a wrap of
// chips when each one carries two controls.
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
    let res: Awaited<ReturnType<typeof confirmRequirements>>;
    try {
      res = await confirmRequirements(jobId, atoms.map((a) => ({ id: a.id, required: a.required })), reqs!.content_version);
    } finally {
      setSaving(false);
    }
    if (!res.ok) { setError(res.error); return; }
    onConfirmed();
  };

  const pending = !reqs || reqs.status === "pending";
  return (
    <Panel as="section" className="p-5 sm:p-6" aria-labelledby="req-heading">
      <h2 id="req-heading" className="font-display text-title text-text-primary">Confirm what this job requires</h2>
      <p className="mt-2 max-w-[62ch] text-body text-text-secondary">
        {pending
          ? "We're still reading this job's description. Check back in a minute."
          : reqs?.status === "failed"
            ? "We couldn't read the requirements automatically. You can still search by describing who you need."
            : "Remove anything that's wrong and mark the must-haves."}
      </p>
      {!pending && atoms.length > 0 && (
        <ul className="mt-5 divide-y divide-border-subtle border-y border-border-subtle">
          {atoms.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
              <span className="min-w-0 text-body text-text-primary">{a.label}</span>
              <span className="flex flex-wrap items-center gap-2">
                <Chip
                  size="sm"
                  pressed={a.required}
                  onClick={() => setAtoms((xs) => xs.map((x) => (x.id === a.id ? { ...x, required: !x.required } : x)))}
                >
                  {a.required ? "Must have" : "Nice to have"}
                </Chip>
                <Button
                  variant="quiet"
                  size="sm"
                  type="button"
                  leading={<Icon name="close" size={16} />}
                  onClick={() => setAtoms((xs) => xs.filter((x) => x.id !== a.id))}
                  aria-label={`Remove ${a.label}`}
                >
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && <Notice tone="danger" role="alert" className="mt-4">{error}</Notice>}
      {!pending && (
        <Button className="mt-5" size="sm" lit loading={saving} onClick={save}>
          Confirm requirements
        </Button>
      )}
    </Panel>
  );
}
