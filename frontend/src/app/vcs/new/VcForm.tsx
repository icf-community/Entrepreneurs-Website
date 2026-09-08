"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Field } from "@/components/forms/Field";
import { ErrorBanner } from "@/components/forms/Banners";
import { inputCls } from "@/components/forms/styles";
import { TurnstileWidget, turnstileConfigured } from "@/components/forms/TurnstileWidget";
import { submitVcGrant, updateOwnVcGrant } from "@/app/vcs/actions";
import { vcGrantSchema } from "@/lib/validation/listings";
import { collectFieldErrors, showFieldErrors, FORM_ERROR, type FieldErrors } from "@/lib/validation/fields";
import { Button } from "@/components/ui/Button";
import RevisionQueuedNotice from "@/components/forms/RevisionQueuedNotice";
import { track } from "@/components/analytics/PostHogProvider";

type Mode = "user" | "admin";

export type VcInitialValues = {
  kind: "vc" | "grant";
  name: string;
  description: string;
  link: string;
  amount: string;
  deadline: string;
  stage: string;
};

export default function VcForm({
  mode, editingId, initialValues, reviewOnSave,
}: {
  mode: Mode;
  editingId?: string;
  initialValues?: VcInitialValues;
  /** Already approved: saving proposes a revision an admin reviews. */
  reviewOnSave?: boolean;
}) {
  const router = useRouter();

  const iv = initialValues;

  const [kind, setKind] = useState<"vc" | "grant">(iv?.kind ?? "vc");
  const [name, setName] = useState(iv?.name ?? "");
  const [description, setDescription] = useState(iv?.description ?? "");
  const [link, setLink] = useState(iv?.link ?? "");
  const [amount, setAmount] = useState(iv?.amount ?? "");
  const [deadline, setDeadline] = useState(iv?.deadline ?? "");
  const [stage, setStage] = useState(iv?.stage ?? "");

  const [isLoading, setIsLoading] = useState(false);
  // Set once the server confirms the edit was staged rather than applied.
  const [staged, setStaged] = useState(false);
  const [error, setError] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const formRef = useRef<HTMLFormElement>(null);

  const showTurnstile = mode === "user" && !editingId && turnstileConfigured;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setFieldErrors({});

    if (showTurnstile && !turnstileToken) {
      setError("Please complete the verification challenge below."); return;
    }

    // Same schema the server action runs, so every failing field is
    // reported at once and the two definitions can't drift apart.
    const parsed = collectFieldErrors(vcGrantSchema, {
      kind,
      name:        name.trim(),
      description: description.trim(),
      link:        link.trim(),
      amount:      amount.trim() || null,
      deadline:    deadline || null,
      stage:       stage.trim() || null,
    });
    if (!parsed.ok) {
      if (parsed.errors[FORM_ERROR]) setError(parsed.errors[FORM_ERROR]);
      showFieldErrors(parsed.errors, setFieldErrors, formRef.current);
      return;
    }
    const payload = parsed.data;

    setIsLoading(true);

    if (editingId) {
      const res = await updateOwnVcGrant(editingId, payload);
      if (!res.ok) {
        setError(res.error);
        setIsLoading(false);
        return;
      }
      track("listing_edited", { kind: "vc_grant", mode });
      if (res.data.staged) { setStaged(true); setIsLoading(false); return; }
      router.replace("/my-submissions");
      router.refresh();
      return;
    }

    const res = await submitVcGrant({ mode, turnstileToken, payload });

    if (!res.ok) {
      setError(res.error);
      setIsLoading(false);
      return;
    }

    track("listing_submitted", { kind: "vc_grant", mode });
    router.replace(mode === "admin" ? "/admin/vcs" : "/vcs?submitted=1");
    router.refresh();
  };

  if (staged) return <RevisionQueuedNotice noun="listing" />;

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-5 rounded-2xl bg-bg-card border border-border p-8">
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <Field label="Kind" required group error={fieldErrors.kind}>
        <div className="grid grid-cols-2 gap-3">
          <label className={`px-4 py-3 rounded-lg border cursor-pointer transition-colors ${kind === "vc" ? "bg-accent-muted border-accent/50 text-accent-light" : "bg-white/[0.02] border-border text-text-secondary hover:border-accent"}`}>
            <input type="radio" name="kind" value="vc" checked={kind === "vc"} onChange={() => setKind("vc")} className="mr-2" />
            Venture capital
          </label>
          <label className={`px-4 py-3 rounded-lg border cursor-pointer transition-colors ${kind === "grant" ? "bg-accent-muted border-accent/50 text-accent-light" : "bg-white/[0.02] border-border text-text-secondary hover:border-accent"}`}>
            <input type="radio" name="kind" value="grant" checked={kind === "grant"} onChange={() => setKind("grant")} className="mr-2" />
            Grant
          </label>
        </div>
      </Field>

      <Field label="Name" required error={fieldErrors.name}>
        <input type="text" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} required />
      </Field>

      <Field label="Description" required hint={`${description.length}/5000`} error={fieldErrors.description}>
        <textarea rows={5} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} className={`${inputCls} resize-none`} required />
      </Field>

      <Field label="Link" required hint="Their site, application form, or fund page" error={fieldErrors.link}>
        <input type="url" maxLength={512} placeholder="https://example.com" value={link} onChange={(e) => setLink(e.target.value)} className={inputCls} required />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Amount" hint="optional" error={fieldErrors.amount}>
          <input type="text" placeholder="e.g. £25k–£500k" maxLength={100} value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Stage" hint="optional" error={fieldErrors.stage}>
          <input type="text" placeholder="e.g. Pre-seed, Seed" maxLength={100} value={stage} onChange={(e) => setStage(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Deadline" hint="optional" error={fieldErrors.deadline}>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={inputCls} />
        </Field>
      </div>

      {showTurnstile && <TurnstileWidget onToken={setTurnstileToken} />}

      <Button
        type="submit"
        loading={isLoading}
        variant="primary"
        size="lg"
        className="w-full mt-3"
      >
        {editingId ? (
          reviewOnSave ? "Submit changes for review" : "Save changes"
        ) : mode === "admin" ? (
          "Publish listing"
        ) : (
          "Submit for review"
        )}
      </Button>
    </form>
  );
}

