"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Field, FieldError } from "@/components/forms/Field";
import { ChipGroup, type ChipItem } from "@/components/forms/ChipGroup";
import { ErrorBanner } from "@/components/forms/Banners";
import { inputCls } from "@/components/forms/styles";
import { TurnstileWidget, turnstileConfigured } from "@/components/forms/TurnstileWidget";
import { submitOpportunity, updateOwnOpportunity } from "@/app/opportunities/actions";
import { opportunitySchema } from "@/lib/validation/listings";
import { collectFieldErrors, showFieldErrors, FORM_ERROR, type FieldErrors } from "@/lib/validation/fields";
import { Button } from "@/components/ui/Button";
import RevisionQueuedNotice from "@/components/forms/RevisionQueuedNotice";
import { track } from "@/components/analytics/PostHogProvider";

type Lookup = ChipItem;
type Mode = "user" | "admin";

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
};

type Props = {
  signupEmail: string;
  skills: Lookup[];
  sectors: Lookup[];
  mode: Mode;
  editingId?: string;
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

export default function OpportunityForm({ signupEmail, skills, sectors, mode, editingId, initialValues, reviewOnSave }: Props) {
  const router = useRouter();

  const iv = initialValues;
  const initialContactIsCustom = !!iv && iv.contactEmail.toLowerCase() !== signupEmail.toLowerCase();

  const [positionName, setPositionName] = useState(iv?.positionName ?? "");
  const [company, setCompany] = useState(iv?.company ?? "");
  const [pay, setPay] = useState(iv?.pay ?? "");
  const [locationType, setLocationType] = useState<"remote" | "hybrid" | "onsite">(iv?.locationType ?? "hybrid");
  const [locationText, setLocationText] = useState(iv?.locationText ?? "");
  const [description, setDescription] = useState(iv?.description ?? "");
  const [startMonth, setStartMonth] = useState<string>(iv?.startMonth ?? String(new Date().getMonth() + 1));
  const [startYear, setStartYear] = useState<string>(iv?.startYear ?? String(new Date().getFullYear()));
  const [applicationDeadline, setApplicationDeadline] = useState<string>(iv?.applicationDeadline ?? "");
  const [useCustomContact, setUseCustomContact] = useState(initialContactIsCustom);
  const [customContactEmail, setCustomContactEmail] = useState(initialContactIsCustom ? iv!.contactEmail : "");
  const [contactEmailVisible, setContactEmailVisible] = useState(iv?.contactEmailVisible ?? false);
  const [applyMethod, setApplyMethod] = useState<"email" | "link">(iv?.applyMethod ?? "email");
  const [applyUrl, setApplyUrl] = useState(iv?.applyUrl ?? "");
  const [skillIds, setSkillIds] = useState<Set<number>>(new Set(iv?.skillIds ?? []));
  const [sectorIds, setSectorIds] = useState<Set<number>>(new Set(iv?.sectorIds ?? []));

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
    setError("");
    setFieldErrors({});

    if (showTurnstile && !turnstileToken) {
      setError("Please complete the verification challenge below."); return;
    }

    // Validated against the same schema the server action uses, so every
    // failing field is reported at once, beside itself, and the two can't
    // disagree.
    const parsed = collectFieldErrors(opportunitySchema, {
      positionName:        positionName.trim(),
      company:             company.trim(),
      pay:                 pay.trim(),
      locationType,
      locationText:        locationText.trim() || null,
      description:         description.trim(),
      startMonth:          parseInt(startMonth, 10),
      startYear:           parseInt(startYear,  10),
      applicationDeadline,
      contactEmail:        useCustomContact ? customContactEmail.trim() : signupEmail,
      contactEmailVisible,
      applyMethod,
      applyUrl:            applyMethod === "link" ? applyUrl.trim() : null,
      skillIds:            Array.from(skillIds),
      sectorIds:           Array.from(sectorIds),
    });
    if (!parsed.ok) {
      // Schema-level rules that aren't tied to one field still need somewhere
      // to land.
      if (parsed.errors[FORM_ERROR]) setError(parsed.errors[FORM_ERROR]);
      showFieldErrors(parsed.errors, setFieldErrors, formRef.current);
      return;
    }
    const payload = parsed.data;

    setIsLoading(true);

    // Split rather than a ternary into one `res`: the edit path returns
    // Result<{ staged }> and the submit path returns Result<void>, and a
    // union of the two only narrows by widening res.data to unknown.
    if (editingId) {
      const res = await updateOwnOpportunity(editingId, payload);
      if (!res.ok) {
        setError(res.error);
        setIsLoading(false);
        return;
      }
      track("listing_edited", { kind: "opportunity", mode });
      if (res.data.staged) { setStaged(true); setIsLoading(false); return; }
      router.replace("/my-submissions");
      router.refresh();
      return;
    }

    const res = await submitOpportunity({ mode, payload, turnstileToken });

    if (!res.ok) {
      setError(res.error);
      setIsLoading(false);
      return;
    }

    track("listing_submitted", { kind: "opportunity", mode });
    router.replace(mode === "admin" ? "/admin/opportunities" : "/opportunities?submitted=1");
    router.refresh();
  };

  if (staged) return <RevisionQueuedNotice noun="opportunity" />;

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-5 rounded-2xl bg-bg-card border border-border p-8">
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <Field label="Role title" required error={fieldErrors.positionName}>
        <input type="text" maxLength={200} value={positionName} onChange={(e) => setPositionName(e.target.value)} className={inputCls} required />
      </Field>

      <Field label="Company" required error={fieldErrors.company}>
        <input type="text" maxLength={200} value={company} onChange={(e) => setCompany(e.target.value)} className={inputCls} required />
      </Field>

      <Field label="Salary / compensation" required hint="e.g. £80k–£100k, equity 0.1–0.5%, daily rate, etc." error={fieldErrors.pay}>
        <input type="text" maxLength={100} value={pay} onChange={(e) => setPay(e.target.value)} className={inputCls} required />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Location type" required error={fieldErrors.locationType}>
          <select value={locationType} onChange={(e) => setLocationType(e.target.value as "remote" | "hybrid" | "onsite")} className={inputCls}>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">Onsite</option>
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="City / region" hint={locationType === "remote" ? "Optional for remote" : "Required"} error={fieldErrors.locationText}>
            <input type="text" maxLength={200} value={locationText} onChange={(e) => setLocationText(e.target.value)} className={inputCls} />
          </Field>
        </div>
      </div>

      <Field label="Job description" required hint={`${description.length}/5000`} error={fieldErrors.description}>
        <textarea rows={6} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} className={`${inputCls} resize-none`} required />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Start month" required error={fieldErrors.startMonth}>
          <select value={startMonth} onChange={(e) => setStartMonth(e.target.value)} className={inputCls}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </Field>
        <Field label="Start year" required error={fieldErrors.startYear}>
          <select value={startYear} onChange={(e) => setStartYear(e.target.value)} className={inputCls}>
            {START_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </Field>
        <Field label="Final date to apply" required error={fieldErrors.applicationDeadline}>
          <input type="date" value={applicationDeadline} onChange={(e) => setApplicationDeadline(e.target.value)} className={inputCls} required />
        </Field>
      </div>

      <div className="pt-2 border-t border-border-subtle">
        <div className="text-[0.85rem] text-text-primary mb-3 mt-3">Contact email</div>
        <p className="text-[0.75rem] text-text-muted leading-relaxed mb-3">
          We&apos;ll use the email you signed up with by default. Tick below to use a different inbox.
          Either way, the admin team always sees your signup email.
        </p>
        <label className="flex items-center gap-2 text-[0.8rem] text-text-secondary mb-3 cursor-pointer">
          <input type="checkbox" checked={useCustomContact} onChange={(e) => setUseCustomContact(e.target.checked)} />
          Use a different contact email
        </label>
        <div data-invalid={fieldErrors.contactEmail ? "" : undefined}>
          {useCustomContact ? (
            <input type="email" aria-label="Contact email" placeholder="contact@example.com" value={customContactEmail} onChange={(e) => setCustomContactEmail(e.target.value)} className={inputCls} required />
          ) : (
            <div className="px-4 py-3 bg-white/[0.02] border border-border-subtle rounded-lg text-[0.8rem] text-text-muted">
              {signupEmail}
            </div>
          )}
          <FieldError>{fieldErrors.contactEmail}</FieldError>
        </div>
        <label className="flex items-start gap-2 text-[0.8rem] text-text-secondary mt-3 cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={contactEmailVisible} onChange={(e) => setContactEmailVisible(e.target.checked)} />
          <span>
            Make this contact email visible to community members on the listing.
            <span className="text-text-muted block text-[0.75rem] mt-0.5">If unchecked, applicants will have to reach out via LinkedIn or the application portal below.</span>
          </span>
        </label>
      </div>

      <div className="pt-2 border-t border-border-subtle">
        <div className="text-[0.85rem] text-text-primary mb-3 mt-3">How should applicants apply?</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className={`px-4 py-3 rounded-lg border cursor-pointer transition-colors ${applyMethod === "email" ? "bg-accent-muted border-accent/50 text-accent-light" : "bg-white/[0.02] border-border text-text-secondary hover:border-accent"}`}>
            <input type="radio" name="apply-method" value="email" checked={applyMethod === "email"} onChange={() => setApplyMethod("email")} className="mr-2" />
            Contact me directly
          </label>
          <label className={`px-4 py-3 rounded-lg border cursor-pointer transition-colors ${applyMethod === "link" ? "bg-accent-muted border-accent/50 text-accent-light" : "bg-white/[0.02] border-border text-text-secondary hover:border-accent"}`}>
            <input type="radio" name="apply-method" value="link" checked={applyMethod === "link"} onChange={() => setApplyMethod("link")} className="mr-2" />
            Application portal link
          </label>
        </div>
        {applyMethod === "link" && (
          <div className="mt-3" data-invalid={fieldErrors.applyUrl ? "" : undefined}>
            <input type="url" aria-label="Application portal URL" maxLength={512} placeholder="https://yourcompany.com/careers/role-id" value={applyUrl} onChange={(e) => setApplyUrl(e.target.value)} className={inputCls} required />
            <FieldError>{fieldErrors.applyUrl}</FieldError>
          </div>
        )}
      </div>

      <ChipGroup label="Skills" hint="optional" items={skills} selected={skillIds} onToggle={(id) => toggle(skillIds, id, setSkillIds)} />
      <ChipGroup label="Sectors" hint="optional" items={sectors} selected={sectorIds} onToggle={(id) => toggle(sectorIds, id, setSectorIds)} />

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
          "Publish opportunity"
        ) : (
          "Submit for review"
        )}
      </Button>
    </form>
  );
}

