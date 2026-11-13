"use client";

import { useState, useTransition } from "react";
import { previewGraduates, promptGraduates } from "./actions";
import { ErrorBanner } from "@/components/forms/Banners";
import { Button } from "@/components/ui/Button";

type Preview = {
  count: number;
  sample: { id: string; firstName: string; surname: string; gradYear: number }[];
};

// Graduates keep their accounts (20261011000005). This asks the students
// due to graduate to confirm it, once each; nothing is deleted here.
export default function GraduatesClient({ defaultCutoff }: { defaultCutoff: number }) {
  const [cutoff, setCutoff] = useState<string>(defaultCutoff.toString());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<{ prompted: number; emailsQueued: number } | null>(null);

  const cutoffNum = parseInt(cutoff, 10);
  const cutoffValid = Number.isFinite(cutoffNum) && cutoffNum >= 1950 && cutoffNum <= 2099;

  const handlePreview = () => {
    setError("");
    setDone(null);
    if (!cutoffValid) { setError("Cutoff year must be between 1950 and 2099."); return; }
    startTransition(async () => {
      const res = await previewGraduates(cutoffNum);
      if (!res.ok) { setError(res.error); return; }
      setPreview(res);
    });
  };

  const handleSend = () => {
    setError("");
    startTransition(async () => {
      const res = await promptGraduates(cutoffNum);
      setConfirming(false);
      if (!res.ok) { setError(res.error); return; }
      setDone({ prompted: res.prompted, emailsQueued: res.emailsQueued });
      setPreview(null);
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-5 rounded-2xl border border-border bg-bg-card p-6">
        <div>
          <label htmlFor="cutoff" className="mb-1.5 block text-small text-text-muted">Cutoff graduation year</label>
          <input
            id="cutoff"
            type="number"
            value={cutoff}
            onChange={(e) => setCutoff(e.target.value)}
            min={1950}
            max={2099}
            className="w-[200px] rounded-lg border border-border-strong bg-tint-1 px-4 py-3 text-body text-text-primary focus:border-accent/50"
          />
          <p className="mt-1.5 text-small text-text-muted">
            Students whose graduation year is at or before this are asked once whether they&apos;ve graduated.
          </p>
        </div>
        <Button type="button" onClick={handlePreview} disabled={!cutoffValid} loading={pending && !confirming}>
          Preview who will be asked
        </Button>
        {error && <ErrorBanner>{error}</ErrorBanner>}
        {done && (
          <p role="status" className="text-body text-text-secondary">
            Asked {done.prompted} student{done.prompted === 1 ? "" : "s"}; {done.emailsQueued} email{done.emailsQueued === 1 ? "" : "s"} queued.
          </p>
        )}
      </div>

      {preview && (
        <section aria-labelledby="grad-preview" className="rounded-2xl border border-border bg-bg-card p-6">
          <h2 id="grad-preview" className="mb-4 font-display text-lead text-text-primary">
            {preview.count} student{preview.count === 1 ? "" : "s"} will be asked
          </h2>
          {preview.count === 0 ? (
            <p className="text-body text-text-muted">Nobody to ask at this cutoff, or everyone due has been asked already.</p>
          ) : (
            <>
              <ul className="mb-5 space-y-2">
                {preview.sample.map((m) => (
                  <li key={m.id} className="text-body text-text-secondary">
                    {m.firstName} {m.surname} <span className="text-text-muted">· grad {m.gradYear}</span>
                  </li>
                ))}
                {preview.count > preview.sample.length && (
                  <li className="text-body italic text-text-muted">+ {preview.count - preview.sample.length} more</li>
                )}
              </ul>
              {confirming ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-body text-text-secondary">Email {preview.count} student{preview.count === 1 ? "" : "s"} and show them the prompt?</span>
                  <Button type="button" onClick={handleSend} loading={pending}>Send</Button>
                  <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>Cancel</Button>
                </div>
              ) : (
                <Button type="button" onClick={() => setConfirming(true)}>Ask them to confirm</Button>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
