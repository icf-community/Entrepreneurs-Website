"use client";

import { useState, useTransition } from "react";
import { previewGraduates, promptGraduates } from "./actions";
import { ErrorBanner } from "@/components/forms/Banners";
import { Field } from "@/components/forms/Field";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormActions } from "@/components/ui/FormActions";
import { FormSection } from "@/components/ui/FormSection";
import { Input } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";

type Preview = {
  count: number;
  sample: { id: string; firstName: string; surname: string; gradYear: number }[];
};

type Done = { prompted: number; emailsQueued: number };

// Graduates keep their accounts (20261011000005). This asks the students
// due to graduate to confirm it, once each; nothing is deleted here.
//
// Two steps on one page, so the page reads top to bottom: pick the cutoff and
// preview who it would reach; then, only once there is a preview, ask them. The
// button that matters is the primary one at each step.
export default function GraduatesClient({ defaultCutoff }: { defaultCutoff: number }) {
  const [cutoff, setCutoff] = useState<string>(defaultCutoff.toString());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<Done | null>(null);

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
    <div className="grid gap-6">
      <CutoffPanel
        cutoff={cutoff}
        onCutoff={setCutoff}
        valid={cutoffValid}
        loading={pending && !confirming}
        hasPreview={preview !== null}
        onPreview={handlePreview}
        error={error}
        done={done}
      />
      {preview && (
        <PreviewPanel
          preview={preview}
          confirming={confirming}
          pending={pending}
          onAsk={() => setConfirming(true)}
          onSend={handleSend}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

/** Step one: which year, and a preview of who it reaches. */
function CutoffPanel({
  cutoff, onCutoff, valid, loading, hasPreview, onPreview, error, done,
}: {
  cutoff: string;
  onCutoff: (next: string) => void;
  valid: boolean;
  loading: boolean;
  hasPreview: boolean;
  onPreview: () => void;
  error: string;
  done: Done | null;
}) {
  return (
    <FormSection>
      <div>
        <Field label="Cutoff graduation year">
          <Input
            id="cutoff"
            type="number"
            value={cutoff}
            onChange={(e) => onCutoff(e.target.value)}
            min={1950}
            max={2099}
            data-spin="off"
            aria-describedby="cutoff-help"
            className="w-[200px]"
          />
        </Field>
        <p id="cutoff-help" className="mt-2 text-small text-text-muted">
          Students whose graduation year is at or before this are asked once whether they&apos;ve graduated.
        </p>
      </div>
      <FormActions>
        <Button type="button" size="md" variant={hasPreview ? "ghost" : "primary"} onClick={onPreview} disabled={!valid} loading={loading}>
          Preview who will be asked
        </Button>
      </FormActions>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {done && (
        <Notice tone="success" role="status">
          Asked {done.prompted} student{done.prompted === 1 ? "" : "s"}; {done.emailsQueued} email{done.emailsQueued === 1 ? "" : "s"} queued.
        </Notice>
      )}
    </FormSection>
  );
}

/** Step two: who would be asked, and the question that sends it. */
function PreviewPanel({
  preview, confirming, pending, onAsk, onSend, onCancel,
}: {
  preview: Preview;
  confirming: boolean;
  pending: boolean;
  onAsk: () => void;
  onSend: () => void;
  onCancel: () => void;
}) {
  const plural = preview.count === 1 ? "" : "s";
  return (
    <Panel as="section" aria-labelledby="grad-preview" className="grid gap-5 p-5 sm:p-6">
      <h2 id="grad-preview" className="font-display text-title text-text-primary">
        {preview.count} student{plural} will be asked
      </h2>
      {preview.count === 0 ? (
        <EmptyState bare size="compact" icon="user-check">
          Nobody to ask at this cutoff, or everyone due has been asked already.
        </EmptyState>
      ) : (
        <>
          <ul className="grid gap-3">
            {preview.sample.map((m) => (
              <li key={m.id} className="flex items-center gap-3 text-body text-text-secondary">
                <Avatar name={`${m.firstName} ${m.surname}`} size="sm" />
                <span>
                  {m.firstName} {m.surname} <span className="text-text-muted">· grad {m.gradYear}</span>
                </span>
              </li>
            ))}
            {preview.count > preview.sample.length && (
              <li className="text-body text-text-muted">+ {preview.count - preview.sample.length} more</li>
            )}
          </ul>
          {confirming ? (
            <Notice
              tone="lit"
              action={
                <>
                  <Button type="button" size="sm" onClick={onSend} loading={pending}>Send</Button>
                  <Button type="button" size="sm" variant="quiet" onClick={onCancel} disabled={pending}>Cancel</Button>
                </>
              }
            >
              Email {preview.count} student{plural} and show them the prompt?
            </Notice>
          ) : (
            <div>
              <Button type="button" size="md" onClick={onAsk}>Ask them to confirm</Button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
