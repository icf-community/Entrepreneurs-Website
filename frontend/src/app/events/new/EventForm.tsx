"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Field } from "@/components/forms/Field";
import { ContactEmailSection } from "@/components/forms/ContactEmailSection";
import { ErrorBanner } from "@/components/forms/Banners";
import { inputCls } from "@/components/forms/styles";
import { TurnstileWidget } from "@/components/forms/TurnstileWidget";
import { turnstileConfigured } from "@/lib/turnstileConfig";
import { submitEvent, updateOwnEvent } from "@/app/events/actions";
import { eventSchema, type EventPayload } from "@/lib/validation/listings";
import { collectFieldErrors, showFieldErrors, FORM_ERROR, type FieldErrors } from "@/lib/validation/fields";
import { Button } from "@/components/ui/Button";
import RevisionQueuedNotice from "@/components/forms/RevisionQueuedNotice";
import { track } from "@/lib/analytics/track";

type Mode = "user" | "admin";
type Router = ReturnType<typeof useRouter>;

export type EventInitialValues = {
  title: string;
  description: string;
  lumaLink: string;
  eventAt: string;
  location: string;
  organiserName: string;
  contactEmail: string;
  contactEmailVisible: boolean;
};

type Props = {
  signupEmail: string;
  defaultOrganiser: string;
  mode: Mode;
  editingId?: string;
  editVersion?: number;
  initialValues?: EventInitialValues;
  /**
   * The listing is already approved, so saving proposes a revision an
   * admin reviews rather than writing through (20260907000005). Only
   * changes the wording here — the database decides which path runs.
   */
  reviewOnSave?: boolean;
};

// The two submit outcomes that leave isLoading untouched (the component
// navigates away instead) vs. the ones that need it cleared so the form
// is usable again. Letting the branches hand back a tag, instead of each
// poking isLoading directly, keeps that one piece of state owned in one
// place (handleSubmit) — preserving the invariant the no-unowned-async-
// error-clear rule checks for.
type EditSubmitOutcome =
  | { tag: "error"; error: string }
  | { tag: "staged"; remindAboutLuma: boolean }
  | { tag: "done" };

async function submitEditedEvent(
  editingId: string,
  payload: EventPayload,
  editVersion: number | undefined,
  iv: EventInitialValues | undefined,
  mode: Mode,
  router: Router,
): Promise<EditSubmitOutcome> {
  const res = await updateOwnEvent(editingId, payload, editVersion);
  if (!res.ok) return { tag: "error", error: res.error };

  track("listing_edited", { kind: "event", mode });
  if (res.data.staged) {
    // Only time and place get the Luma reminder: those are the two
    // fields somebody who already registered has to be told about.
    return {
      tag: "staged",
      remindAboutLuma:
        payload.eventAtIso !== (iv?.eventAt ? new Date(iv.eventAt).toISOString() : "")
        || payload.location !== iv?.location,
    };
  }

  router.replace("/my-submissions");
  router.refresh();
  return { tag: "done" };
}

type NewSubmitOutcome = { tag: "error"; error: string } | { tag: "done" };

async function submitNewEvent(
  mode: Mode,
  turnstileToken: string,
  payload: EventPayload,
  router: Router,
): Promise<NewSubmitOutcome> {
  const res = await submitEvent({ mode, turnstileToken, payload });
  if (!res.ok) return { tag: "error", error: res.error };

  track("listing_submitted", { kind: "event", mode });
  router.replace(mode === "admin" ? "/admin/events" : "/events?submitted=1");
  router.refresh();
  return { tag: "done" };
}

function submitButtonLabel(editingId: string | undefined, reviewOnSave: boolean | undefined, mode: Mode) {
  if (editingId) return reviewOnSave ? "Submit changes for review" : "Save changes";
  return mode === "admin" ? "Publish event" : "Submit for review";
}

// Collapses every `iv?.field ?? default` pair the component used to
// compute inline, one per useState call, into a single fallback lookup.
function initialEventValues(iv: EventInitialValues | undefined, defaultOrganiser: string): EventInitialValues {
  return iv ?? {
    title: "",
    description: "",
    lumaLink: "",
    eventAt: "",
    location: "",
    organiserName: defaultOrganiser,
    contactEmail: "",
    contactEmailVisible: false,
  };
}

type ValidationResult =
  | { ok: true; data: EventPayload }
  | { ok: false; formError?: string; fieldErrors: FieldErrors };

// Same schema the server action runs, so every failing field is reported
// at once and the two definitions can't drift apart.
function validateEventForm(values: {
  title: string;
  description: string;
  lumaLink: string;
  eventAt: string;
  location: string;
  organiserName: string;
  contactEmail: string;
  contactEmailVisible: boolean;
  isSocietyEvent?: boolean;
}): ValidationResult {
  const parsed = collectFieldErrors(eventSchema, {
    title:                 values.title.trim(),
    description:           values.description.trim(),
    lumaLink:               values.lumaLink.trim(),
    eventAtIso:             values.eventAt ? new Date(values.eventAt).toISOString() : "",
    location:               values.location.trim(),
    organiserName:          values.organiserName.trim(),
    contactEmail:           values.contactEmail,
    contactEmailVisible:    values.contactEmailVisible,
    isSocietyEvent:         values.isSocietyEvent,
  });
  if (!parsed.ok) return { ok: false, formError: parsed.errors[FORM_ERROR], fieldErrors: parsed.errors };
  return { ok: true, data: parsed.data };
}

// Applies the side effects for each submit outcome, keeping isLoading's
// clear/don't-clear decision (the invariant no-unowned-async-error-clear
// checks for) in one place per path instead of scattered through the
// component.
function applyEditOutcome(
  outcome: EditSubmitOutcome,
  setError: (error: string) => void,
  setStaged: (staged: { remindAboutLuma: boolean } | null) => void,
  setIsLoading: (loading: boolean) => void,
) {
  if (outcome.tag === "error") {
    setError(outcome.error);
    setIsLoading(false);
    return;
  }
  if (outcome.tag === "staged") {
    setStaged({ remindAboutLuma: outcome.remindAboutLuma });
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

function ErrorBannerIfAny({ error }: { error: string }) {
  if (!error) return null;
  return <ErrorBanner>{error}</ErrorBanner>;
}

function TurnstileSection({ show, onToken }: { show: boolean; onToken: (token: string) => void }) {
  if (!show) return null;
  return <TurnstileWidget onToken={onToken} />;
}

// Admin-only toggle: mark a direct-published event as an official society
// event (rendered accent in the directory) vs. an external one. Hidden for
// members and on edits; the DB trigger rejects non-admin attempts regardless.
function SocietyTypeField({
  show, value, onChange, error,
}: {
  show: boolean;
  value: boolean;
  onChange: (value: boolean) => void;
  error?: string;
}) {
  if (!show) return null;
  return (
    <Field label="Event type" required hint="Society events are highlighted in accent in the directory." error={error}>
      <select
        value={value ? "society" : "external"}
        onChange={(e) => onChange(e.target.value === "society")}
        className={inputCls}
      >
        <option value="external">External event</option>
        <option value="society">Society event</option>
      </select>
    </Field>
  );
}

export default function EventForm({ signupEmail, defaultOrganiser, mode, editingId, editVersion, initialValues, reviewOnSave }: Props) {
  const router = useRouter();

  const iv = initialValues;
  const initialContactIsCustom = !!iv && iv.contactEmail.toLowerCase() !== signupEmail.toLowerCase();
  const initial = initialEventValues(iv, defaultOrganiser);

  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [lumaLink, setLumaLink] = useState(initial.lumaLink);
  const [eventAt, setEventAt] = useState(initial.eventAt);
  const [location, setLocation] = useState(initial.location);
  const [organiserName, setOrganiserName] = useState(initial.organiserName);
  const [useCustomContact, setUseCustomContact] = useState(initialContactIsCustom);
  const [customContactEmail, setCustomContactEmail] = useState(initialContactIsCustom ? iv!.contactEmail : "");
  const [contactEmailVisible, setContactEmailVisible] = useState(initial.contactEmailVisible);
  const [isSocietyEvent, setIsSocietyEvent] = useState(false);

  const showSocietyToggle = mode === "admin" && !editingId;

  const [isLoading, setIsLoading] = useState(false);
  // Set once the server confirms the edit was staged rather than applied.
  const [staged, setStaged] = useState<{ remindAboutLuma: boolean } | null>(null);
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

    const result = validateEventForm({
      title, description, lumaLink, eventAt, location, organiserName,
      contactEmail: useCustomContact ? customContactEmail.trim() : signupEmail,
      contactEmailVisible,
      isSocietyEvent: showSocietyToggle ? isSocietyEvent : undefined,
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
        const outcome = await submitEditedEvent(editingId, payload, editVersion, iv, mode, router);
        applyEditOutcome(outcome, setError, setStaged, setIsLoading);
        return;
      }

      const outcome = await submitNewEvent(mode, turnstileToken, payload, router);
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

  if (staged) {
    return (
      <RevisionQueuedNotice
        noun="event"
        remindAboutLuma={staged.remindAboutLuma}
        lumaLink={lumaLink.trim() || undefined}
      />
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-5 rounded-2xl bg-bg-card border border-border p-8">
      <ErrorBannerIfAny error={error} />

      <SocietyTypeField show={showSocietyToggle} value={isSocietyEvent} onChange={setIsSocietyEvent} error={fieldErrors.isSocietyEvent} />

      <Field label="Title" required error={fieldErrors.title}>
        <input type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} required />
      </Field>

      <Field label="Description" required hint={`${description.length}/5000`} error={fieldErrors.description}>
        <textarea rows={5} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} className={`${inputCls} resize-none`} required />
      </Field>

      <Field label="Luma link" required error={fieldErrors.lumaLink}>
        {/* react-doctor-disable-next-line react-doctor/no-placeholder-only-field -- input is a child of the shared <Field label=...> wrapper, which already renders a real associated <label> */}
        <input type="url" maxLength={512} placeholder="https://lu.ma/your-event" value={lumaLink} onChange={(e) => setLumaLink(e.target.value)} className={inputCls} required />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Date & time" required error={fieldErrors.eventAtIso}>
          <input type="datetime-local" value={eventAt} onChange={(e) => setEventAt(e.target.value)} className={inputCls} required />
        </Field>
        <Field label="Location" required hint="e.g. Imperial Business School, or 'Online'" error={fieldErrors.location}>
          <input type="text" maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} className={inputCls} required />
        </Field>
      </div>

      <Field label="Organiser name" required error={fieldErrors.organiserName}>
        <input type="text" maxLength={200} value={organiserName} onChange={(e) => setOrganiserName(e.target.value)} className={inputCls} required />
      </Field>

      <ContactEmailSection
        signupEmail={signupEmail}
        useCustomContact={useCustomContact}
        onUseCustomContactChange={setUseCustomContact}
        customContactEmail={customContactEmail}
        onCustomContactEmailChange={setCustomContactEmail}
        contactEmailVisible={contactEmailVisible}
        onContactEmailVisibleChange={setContactEmailVisible}
        error={fieldErrors.contactEmail}
        description="Admins always see your signup email. Tick below to use a different inbox as the public contact."
        visibleLabel="Make this contact email visible to community members."
        visibleHelp="If unchecked, attendees use the Luma link to RSVP."
      />

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
