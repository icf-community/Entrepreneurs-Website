"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Field } from "@/components/forms/Field";
import { ErrorBanner } from "@/components/forms/Banners";
import { inputCls } from "@/components/forms/styles";
import { TurnstileWidget } from "@/components/forms/TurnstileWidget";
import { turnstileConfigured } from "@/lib/turnstileConfig";
import { submitVcGrant, updateOwnVcGrant } from "@/app/vcs/actions";
import { vcGrantSchema, type VcGrantPayload } from "@/lib/validation/listings";
import { collectFieldErrors, showFieldErrors, FORM_ERROR, type FieldErrors } from "@/lib/validation/fields";
import { Button } from "@/components/ui/Button";
import RevisionQueuedNotice from "@/components/forms/RevisionQueuedNotice";
import { track } from "@/lib/analytics/track";

type Mode = "user" | "admin";
type Router = ReturnType<typeof useRouter>;

export type VcInitialValues = {
  kind: "vc" | "grant";
  name: string;
  description: string;
  link: string;
  amount: string;
  deadline: string;
  stage: string;
};

type Props = {
  mode: Mode;
  editingId?: string;
  editVersion?: number;
  initialValues?: VcInitialValues;
  /** Already approved: saving proposes a revision an admin reviews. */
  reviewOnSave?: boolean;
};

// Collapses the `iv?.field ?? default` pair every field used to compute
// inline, one per useState call, into a single fallback lookup.
function initialVcValues(iv: VcInitialValues | undefined): VcInitialValues {
  return iv ?? {
    kind: "vc",
    name: "",
    description: "",
    link: "",
    amount: "",
    deadline: "",
    stage: "",
  };
}

type ValidationResult =
  | { ok: true; data: VcGrantPayload }
  | { ok: false; formError?: string; fieldErrors: FieldErrors };

// Same schema the server action runs, so every failing field is reported
// at once and the two definitions can't drift apart.
function validateVcForm(values: {
  kind: "vc" | "grant";
  name: string;
  description: string;
  link: string;
  amount: string;
  deadline: string;
  stage: string;
}): ValidationResult {
  const parsed = collectFieldErrors(vcGrantSchema, {
    kind:        values.kind,
    name:        values.name.trim(),
    description: values.description.trim(),
    link:        values.link.trim(),
    amount:      values.amount.trim() || null,
    deadline:    values.deadline || null,
    stage:       values.stage.trim() || null,
  });
  if (!parsed.ok) return { ok: false, formError: parsed.errors[FORM_ERROR], fieldErrors: parsed.errors };
  return { ok: true, data: parsed.data };
}

// The submit outcomes: a tag the component branches on, instead of each
// async path poking isLoading directly, so that one piece of state stays
// owned by handleSubmit — the invariant no-unowned-async-error-clear
// checks for.
type EditSubmitOutcome =
  | { tag: "error"; error: string }
  | { tag: "staged" }
  | { tag: "done" };

async function submitEditedVcGrant(
  editingId: string,
  payload: VcGrantPayload,
  editVersion: number | undefined,
  mode: Mode,
  router: Router,
): Promise<EditSubmitOutcome> {
  const res = await updateOwnVcGrant(editingId, payload, editVersion);
  if (!res.ok) return { tag: "error", error: res.error };

  track("listing_edited", { kind: "vc_grant", mode });
  if (res.data.staged) return { tag: "staged" };

  router.replace("/my-submissions");
  router.refresh();
  return { tag: "done" };
}

type NewSubmitOutcome = { tag: "error"; error: string } | { tag: "done" };

async function submitNewVcGrant(
  mode: Mode,
  turnstileToken: string,
  payload: VcGrantPayload,
  router: Router,
): Promise<NewSubmitOutcome> {
  const res = await submitVcGrant({ mode, turnstileToken, payload });
  if (!res.ok) return { tag: "error", error: res.error };

  track("listing_submitted", { kind: "vc_grant", mode });
  router.replace(mode === "admin" ? "/admin/vcs" : "/vcs?submitted=1");
  router.refresh();
  return { tag: "done" };
}

function applyEditOutcome(
  outcome: EditSubmitOutcome,
  setError: (error: string) => void,
  setStaged: (staged: boolean) => void,
  setIsLoading: (loading: boolean) => void,
) {
  if (outcome.tag === "error") {
    setError(outcome.error);
    setIsLoading(false);
    return;
  }
  if (outcome.tag === "staged") {
    setStaged(true);
    setIsLoading(false);
    return;
  }
  // "done" navigated away; isLoading intentionally stays true.
}

function applyNewOutcome(
  outcome: NewSubmitOutcome,
  setError: (error: string) => void,
  setIsLoading: (loading: boolean) => void,
) {
  if (outcome.tag === "error") {
    setError(outcome.error);
    setIsLoading(false);
  }
  // "done" navigated away; isLoading intentionally stays true.
}

function submitButtonLabel(editingId: string | undefined, reviewOnSave: boolean | undefined, mode: Mode) {
  if (editingId) return reviewOnSave ? "Submit changes for review" : "Save changes";
  return mode === "admin" ? "Publish listing" : "Submit for review";
}

function ErrorBannerIfAny({ error }: { error: string }) {
  if (!error) return null;
  return <ErrorBanner>{error}</ErrorBanner>;
}

function TurnstileSection({ show, onToken }: { show: boolean; onToken: (token: string) => void }) {
  if (!show) return null;
  return <TurnstileWidget onToken={onToken} />;
}

function KindField({
  value, onChange, error,
}: {
  value: "vc" | "grant";
  onChange: (value: "vc" | "grant") => void;
  error?: string;
}) {
  return (
    <Field label="Kind" required group error={error}>
      <div className="grid grid-cols-2 gap-3">
        <label className={`px-4 py-3 rounded-lg border cursor-pointer transition-colors ${value === "vc" ? "bg-accent-muted border-accent/50 text-accent-light" : "bg-white/[0.02] border-border text-text-secondary hover:border-accent"}`}>
          <input type="radio" name="kind" value="vc" checked={value === "vc"} onChange={() => onChange("vc")} className="mr-2" />
          Venture capital
        </label>
        <label className={`px-4 py-3 rounded-lg border cursor-pointer transition-colors ${value === "grant" ? "bg-accent-muted border-accent/50 text-accent-light" : "bg-white/[0.02] border-border text-text-secondary hover:border-accent"}`}>
          <input type="radio" name="kind" value="grant" checked={value === "grant"} onChange={() => onChange("grant")} className="mr-2" />
          Grant
        </label>
      </div>
    </Field>
  );
}

export default function VcForm({ mode, editingId, editVersion, initialValues, reviewOnSave }: Props) {
  const router = useRouter();

  const iv = initialValues;
  const initial = initialVcValues(iv);

  const [kind, setKind] = useState<"vc" | "grant">(initial.kind);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [link, setLink] = useState(initial.link);
  const [amount, setAmount] = useState(initial.amount);
  const [deadline, setDeadline] = useState(initial.deadline);
  const [stage, setStage] = useState(initial.stage);

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
    if (isLoading) return;
    setError("");
    setFieldErrors({});

    if (showTurnstile && !turnstileToken) {
      setError("Please complete the verification challenge below."); return;
    }

    const result = validateVcForm({ kind, name, description, link, amount, deadline, stage });
    if (!result.ok) {
      if (result.formError) setError(result.formError);
      showFieldErrors(result.fieldErrors, setFieldErrors, formRef.current);
      return;
    }
    const payload = result.data;

    setIsLoading(true);
    try {
      if (editingId) {
        const outcome = await submitEditedVcGrant(editingId, payload, editVersion, mode, router);
        applyEditOutcome(outcome, setError, setStaged, setIsLoading);
        return;
      }

      const outcome = await submitNewVcGrant(mode, turnstileToken, payload, router);
      applyNewOutcome(outcome, setError, setIsLoading);
    } catch {
      // An unhandled rejection (network blip invoking the server action,
      // not a typed Result failure) would otherwise leave isLoading stuck
      // true forever, with the submit button disabled until a refresh.
      setError("Something went wrong. Please try again.");
      // react-doctor-disable-next-line react-doctor/no-unowned-async-error-clear -- overlapping submits are structurally impossible: no await between the isLoading guard and setIsLoading(true), and the submit button is disabled while loading
      setIsLoading(false);
    }
  };

  if (staged) return <RevisionQueuedNotice noun="listing" />;

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-5 rounded-2xl bg-bg-card border border-border p-8">
      <ErrorBannerIfAny error={error} />

      <KindField value={kind} onChange={setKind} error={fieldErrors.kind} />

      <Field label="Name" required error={fieldErrors.name}>
        <input type="text" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} required />
      </Field>

      <Field label="Description" required hint={`${description.length}/5000`} error={fieldErrors.description}>
        <textarea rows={5} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} className={`${inputCls} resize-none`} required />
      </Field>

      <Field label="Link" required hint="Their site, application form, or fund page" error={fieldErrors.link}>
        {/* react-doctor-disable-next-line react-doctor/no-placeholder-only-field -- input is a child of the shared <Field label=...> wrapper, which already renders a real associated <label> */}
        <input type="url" maxLength={512} placeholder="https://example.com" value={link} onChange={(e) => setLink(e.target.value)} className={inputCls} required />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Amount" hint="optional" error={fieldErrors.amount}>
          {/* react-doctor-disable-next-line react-doctor/no-placeholder-only-field -- input is a child of the shared <Field label=...> wrapper, which already renders a real associated <label> */}
          <input type="text" placeholder="e.g. £25k–£500k" maxLength={100} value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Stage" hint="optional" error={fieldErrors.stage}>
          {/* react-doctor-disable-next-line react-doctor/no-placeholder-only-field -- input is a child of the shared <Field label=...> wrapper, which already renders a real associated <label> */}
          <input type="text" placeholder="e.g. Pre-seed, Seed" maxLength={100} value={stage} onChange={(e) => setStage(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Deadline" hint="optional" error={fieldErrors.deadline}>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={inputCls} />
        </Field>
      </div>

      <TurnstileSection show={showTurnstile} onToken={setTurnstileToken} />

      <Button
        type="submit"
        loading={isLoading}
        variant="primary"
        size="lg"
        className="w-full mt-3"
      >
        {submitButtonLabel(editingId, reviewOnSave, mode)}
      </Button>
    </form>
  );
}
