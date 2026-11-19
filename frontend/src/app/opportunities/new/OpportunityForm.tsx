"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Field, FieldError } from "@/components/forms/Field";
import { ContactEmailSection } from "@/components/forms/ContactEmailSection";
import { ChipGroup, type ChipItem } from "@/components/forms/ChipGroup";
import { ErrorBanner } from "@/components/forms/Banners";
import { TurnstileWidget } from "@/components/forms/TurnstileWidget";
import { turnstileConfigured } from "@/lib/turnstileConfig";
import { submitOpportunity, updateOwnOpportunity } from "@/app/opportunities/actions";
import { opportunitySchema, type OpportunityPayload } from "@/lib/validation/listings";
import { collectFieldErrors, showFieldErrors, FORM_ERROR, type FieldErrors } from "@/lib/validation/fields";
import { Button } from "@/components/ui/Button";
import { FieldGroup, FormSection } from "@/components/ui/FormSection";
import { FormActions } from "@/components/ui/FormActions";
import { Input } from "@/components/ui/Input";
import { Radio } from "@/components/ui/Radio";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import RevisionQueuedNotice from "@/components/forms/RevisionQueuedNotice";
import { track } from "@/lib/analytics/track";

type Lookup = ChipItem;
type Mode = "user" | "admin";
type Router = ReturnType<typeof useRouter>;

export type OpportunityInitialValues = {
  positionName: string;
  company: string;
  pay: string;
  locationType: "remote" | "hybrid" | "onsite";
  locationText: string;
  description: string;
  startMonth: string;
  startYear: string;
  applicationDeadline: string;
  contactEmail: string;
  contactEmailVisible: boolean;
  applyMethod: "email" | "link";
  applyUrl: string;
  skillIds: number[];
  sectorIds: number[];
  /** Null for a job approved before audiences existed: the poster chooses on edit. */
  eligibleAudience: Audience | null;
};

type Audience = "students" | "graduates" | "both";

const AUDIENCES: { value: Audience; label: string }[] = [
  { value: "students", label: "Students" },
  { value: "graduates", label: "Graduates" },
  { value: "both", label: "Both" },
];

type Props = {
  signupEmail: string;
  skills: Lookup[];
  sectors: Lookup[];
  mode: Mode;
  editingId?: string;
  editVersion?: number;
  initialValues?: OpportunityInitialValues;
  /** Already approved: saving proposes a revision an admin reviews. */
  reviewOnSave?: boolean;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const START_YEARS = (() => {
  const now = new Date().getFullYear();
  const out: number[] = [];
  for (let y = now; y <= now + 5; y++) out.push(y);
  return out;
})();

// Collapses the `iv?.field ?? default` pair every non-contact field used
// to compute inline, one per useState call, into a single fallback lookup.
function initialOpportunityValues(iv: OpportunityInitialValues | undefined) {
  if (iv) {
    return {
      positionName: iv.positionName,
      company: iv.company,
      pay: iv.pay,
      locationType: iv.locationType,
      locationText: iv.locationText,
      description: iv.description,
      startMonth: iv.startMonth,
      startYear: iv.startYear,
      applicationDeadline: iv.applicationDeadline,
      contactEmailVisible: iv.contactEmailVisible,
      applyMethod: iv.applyMethod,
      applyUrl: iv.applyUrl,
      skillIds: iv.skillIds,
      sectorIds: iv.sectorIds,
      eligibleAudience: iv.eligibleAudience ?? ("" as const),
    };
  }
  const now = new Date();
  return {
    positionName: "",
    company: "",
    pay: "",
    locationType: "hybrid" as const,
    locationText: "",
    description: "",
    startMonth: String(now.getMonth() + 1),
    startYear: String(now.getFullYear()),
    applicationDeadline: "",
    contactEmailVisible: false,
    applyMethod: "email" as const,
    applyUrl: "",
    skillIds: [] as number[],
    sectorIds: [] as number[],
    eligibleAudience: "" as const,
  };
}

type ValidationResult =
  | { ok: true; data: OpportunityPayload }
  | { ok: false; formError?: string; fieldErrors: FieldErrors };

// Validated against the same schema the server action uses, so every
// failing field is reported at once, beside itself, and the two can't
// disagree.
function validateOpportunityForm(values: {
  positionName: string;
  company: string;
  pay: string;
  locationType: "remote" | "hybrid" | "onsite";
  locationText: string;
  description: string;
  startMonth: string;
  startYear: string;
  applicationDeadline: string;
  contactEmail: string;
  contactEmailVisible: boolean;
  applyMethod: "email" | "link";
  applyUrl: string;
  skillIds: Set<number>;
  sectorIds: Set<number>;
  eligibleAudience: Audience | "";
}): ValidationResult {
  const parsed = collectFieldErrors(opportunitySchema, {
    positionName:        values.positionName.trim(),
    company:             values.company.trim(),
    pay:                 values.pay.trim(),
    locationType:        values.locationType,
    locationText:        values.locationText.trim() || null,
    description:         values.description.trim(),
    startMonth:          parseInt(values.startMonth, 10),
    startYear:           parseInt(values.startYear,  10),
    applicationDeadline: values.applicationDeadline,
    contactEmail:        values.contactEmail,
    contactEmailVisible: values.contactEmailVisible,
    applyMethod:         values.applyMethod,
    applyUrl:            values.applyMethod === "link" ? values.applyUrl.trim() : null,
    skillIds:            Array.from(values.skillIds),
    sectorIds:           Array.from(values.sectorIds),
    eligibleAudience:    values.eligibleAudience || undefined,
  });
  if (!parsed.ok) {
    // Schema-level rules that aren't tied to one field still need somewhere
    // to land.
    return { ok: false, formError: parsed.errors[FORM_ERROR], fieldErrors: parsed.errors };
  }
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

async function submitEditedOpportunity(
  editingId: string,
  payload: OpportunityPayload,
  editVersion: number | undefined,
  mode: Mode,
  router: Router,
): Promise<EditSubmitOutcome> {
  // Split rather than a ternary into one `res`: the edit path returns
  // Result<{ staged }> and the submit path returns Result<void>, and a
  // union of the two only narrows by widening res.data to unknown.
  const res = await updateOwnOpportunity(editingId, payload, editVersion);
  if (!res.ok) return { tag: "error", error: res.error };

  track("listing_edited", { kind: "opportunity", mode });
  if (res.data.staged) return { tag: "staged" };

  router.replace("/my-submissions");
  router.refresh();
  return { tag: "done" };
}

type NewSubmitOutcome = { tag: "error"; error: string } | { tag: "done" };

async function submitNewOpportunity(
  mode: Mode,
  turnstileToken: string,
  payload: OpportunityPayload,
  router: Router,
): Promise<NewSubmitOutcome> {
  const res = await submitOpportunity({ mode, payload, turnstileToken });
  if (!res.ok) return { tag: "error", error: res.error };

  track("listing_submitted", { kind: "opportunity", mode });
  router.replace(mode === "admin" ? "/admin/opportunities" : "/opportunities?submitted=1");
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
  return mode === "admin" ? "Publish opportunity" : "Submit for review";
}

function ErrorBannerIfAny({ error }: { error: string }) {
  if (!error) return null;
  return <ErrorBanner>{error}</ErrorBanner>;
}

function TurnstileSection({ show, onToken }: { show: boolean; onToken: (token: string) => void }) {
  if (!show) return null;
  return <TurnstileWidget onToken={onToken} />;
}

function ApplyMethodSection({
  applyMethod, onApplyMethodChange, applyUrl, onApplyUrlChange, error,
}: {
  applyMethod: "email" | "link";
  onApplyMethodChange: (method: "email" | "link") => void;
  applyUrl: string;
  onApplyUrlChange: (value: string) => void;
  error?: string;
}) {
  return (
    <FieldGroup legend="How should applicants apply?">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Radio card name="apply-method" value="email" checked={applyMethod === "email"} onChange={() => onApplyMethodChange("email")} label="Contact me directly" />
        <Radio card name="apply-method" value="link" checked={applyMethod === "link"} onChange={() => onApplyMethodChange("link")} label="Application portal link" />
      </div>
      <ApplyUrlField show={applyMethod === "link"} value={applyUrl} onChange={onApplyUrlChange} error={error} />
    </FieldGroup>
  );
}

function ApplyUrlField({
  show, value, onChange, error,
}: {
  show: boolean;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  if (!show) return null;
  return (
    <div data-invalid={error ? "" : undefined}>
      <Input type="url" aria-label="Application portal URL" maxLength={512} placeholder="https://yourcompany.com/careers/role-id" value={value} onChange={(e) => onChange(e.target.value)} required />
      <FieldError>{error}</FieldError>
    </div>
  );
}

function EligibleAudienceFieldset({
  value, onChange, error,
}: {
  value: Audience | "";
  onChange: (value: Audience) => void;
  error?: string;
}) {
  return (
    <FieldGroup
      legend={<>Who is this job for? <span className="lm-label__req">*</span></>}
      description="Graduates means anyone who has finished a degree, whatever their role here."
      data-invalid={error ? "" : undefined}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {AUDIENCES.map((a) => (
          <Radio card key={a.value} name="eligible-audience" value={a.value} checked={value === a.value} onChange={() => onChange(a.value)} label={a.label} />
        ))}
      </div>
      <FieldError>{error}</FieldError>
    </FieldGroup>
  );
}

export default function OpportunityForm({ signupEmail, skills, sectors, mode, editingId, editVersion, initialValues, reviewOnSave }: Props) {
  const router = useRouter();

  const iv = initialValues;
  const initialContactIsCustom = !!iv && iv.contactEmail.toLowerCase() !== signupEmail.toLowerCase();
  const initial = initialOpportunityValues(iv);

  const [positionName, setPositionName] = useState(initial.positionName);
  const [company, setCompany] = useState(initial.company);
  const [pay, setPay] = useState(initial.pay);
  const [locationType, setLocationType] = useState<"remote" | "hybrid" | "onsite">(initial.locationType);
  const [locationText, setLocationText] = useState(initial.locationText);
  const [description, setDescription] = useState(initial.description);
  const [startMonth, setStartMonth] = useState<string>(initial.startMonth);
  const [startYear, setStartYear] = useState<string>(initial.startYear);
  const [applicationDeadline, setApplicationDeadline] = useState<string>(initial.applicationDeadline);
  const [useCustomContact, setUseCustomContact] = useState(initialContactIsCustom);
  const [customContactEmail, setCustomContactEmail] = useState(initialContactIsCustom ? iv!.contactEmail : "");
  const [contactEmailVisible, setContactEmailVisible] = useState(initial.contactEmailVisible);
  const [applyMethod, setApplyMethod] = useState<"email" | "link">(initial.applyMethod);
  const [applyUrl, setApplyUrl] = useState(initial.applyUrl);
  const [skillIds, setSkillIds] = useState<Set<number>>(() => new Set(initial.skillIds));
  const [sectorIds, setSectorIds] = useState<Set<number>>(() => new Set(initial.sectorIds));
  const [eligibleAudience, setEligibleAudience] = useState<Audience | "">(initial.eligibleAudience);

  const [isLoading, setIsLoading] = useState(false);
  // Set once the server confirms the edit was staged rather than applied.
  const [staged, setStaged] = useState(false);
  const [error, setError] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const formRef = useRef<HTMLFormElement>(null);

  // Turnstile only gates user submissions, not admin direct-publish or edits.
  const showTurnstile = mode === "user" && !editingId && turnstileConfigured;

  const toggle = (set: Set<number>, id: number, setter: (s: Set<number>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setError("");
    setFieldErrors({});

    if (showTurnstile && !turnstileToken) {
      setError("Please complete the verification challenge below."); return;
    }

    const result = validateOpportunityForm({
      positionName, company, pay, locationType, locationText, description,
      startMonth, startYear, applicationDeadline,
      contactEmail: useCustomContact ? customContactEmail.trim() : signupEmail,
      contactEmailVisible, applyMethod, applyUrl, skillIds, sectorIds, eligibleAudience,
    });
    if (!result.ok) {
      if (result.formError) setError(result.formError);
      showFieldErrors(result.fieldErrors, setFieldErrors, formRef.current);
      return;
    }
    const payload = result.data;

    setIsLoading(true);
    try {
      if (editingId) {
        const outcome = await submitEditedOpportunity(editingId, payload, editVersion, mode, router);
        applyEditOutcome(outcome, setError, setStaged, setIsLoading);
        return;
      }

      const outcome = await submitNewOpportunity(mode, turnstileToken, payload, router);
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

  if (staged) return <RevisionQueuedNotice noun="opportunity" />;

  return (
    <FormSection as="form" ref={formRef} onSubmit={handleSubmit}>
      <ErrorBannerIfAny error={error} />

      <Field label="Role title" required error={fieldErrors.positionName}>
        <Input type="text" maxLength={200} value={positionName} onChange={(e) => setPositionName(e.target.value)} required />
      </Field>

      <Field label="Company" required error={fieldErrors.company}>
        <Input type="text" maxLength={200} value={company} onChange={(e) => setCompany(e.target.value)} required />
      </Field>

      <Field label="Salary / compensation" required hint="e.g. £80k–£100k, equity 0.1–0.5%, daily rate, etc." error={fieldErrors.pay}>
        <Input type="text" maxLength={100} value={pay} onChange={(e) => setPay(e.target.value)} required />
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Field label="Location type" required error={fieldErrors.locationType}>
          <Select value={locationType} onChange={(e) => setLocationType(e.target.value as "remote" | "hybrid" | "onsite")}>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">Onsite</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="City / region" hint={locationType === "remote" ? "Optional for remote" : "Required"} error={fieldErrors.locationText}>
            <Input type="text" maxLength={200} value={locationText} onChange={(e) => setLocationText(e.target.value)} />
          </Field>
        </div>
      </div>

      <Field label="Job description" required hint={`${description.length}/5000`} error={fieldErrors.description}>
        <Textarea rows={6} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} className="resize-none" required />
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Field label="Start month" required error={fieldErrors.startMonth}>
          <Select value={startMonth} onChange={(e) => setStartMonth(e.target.value)}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </Select>
        </Field>
        <Field label="Start year" required error={fieldErrors.startYear}>
          <Select value={startYear} onChange={(e) => setStartYear(e.target.value)}>
            {START_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
        </Field>
        <Field label="Final date to apply" required error={fieldErrors.applicationDeadline}>
          <Input type="date" value={applicationDeadline} onChange={(e) => setApplicationDeadline(e.target.value)} required />
        </Field>
      </div>

      <ContactEmailSection
        signupEmail={signupEmail}
        useCustomContact={useCustomContact}
        onUseCustomContactChange={setUseCustomContact}
        customContactEmail={customContactEmail}
        onCustomContactEmailChange={setCustomContactEmail}
        contactEmailVisible={contactEmailVisible}
        onContactEmailVisibleChange={setContactEmailVisible}
        error={fieldErrors.contactEmail}
        description="We'll use the email you signed up with by default. Tick below to use a different inbox. Either way, the admin team always sees your signup email."
        visibleLabel="Make this contact email visible to community members on the listing."
        visibleHelp="If unchecked, applicants will have to reach out via LinkedIn or the application portal below."
      />

      <ApplyMethodSection
        applyMethod={applyMethod}
        onApplyMethodChange={setApplyMethod}
        applyUrl={applyUrl}
        onApplyUrlChange={setApplyUrl}
        error={fieldErrors.applyUrl}
      />

      <EligibleAudienceFieldset value={eligibleAudience} onChange={setEligibleAudience} error={fieldErrors.eligibleAudience} />

      <ChipGroup label="Skills" hint="optional" items={skills} selected={skillIds} onToggle={(id) => toggle(skillIds, id, setSkillIds)} />
      <ChipGroup label="Sectors" hint="optional" items={sectors} selected={sectorIds} onToggle={(id) => toggle(sectorIds, id, setSectorIds)} />

      <TurnstileSection show={showTurnstile} onToken={setTurnstileToken} />

      <FormActions>
        <Button type="submit" loading={isLoading} variant="primary" size="lg">
          {submitButtonLabel(editingId, reviewOnSave, mode)}
        </Button>
      </FormActions>
    </FormSection>
  );
}
