"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Field, FieldError } from "@/components/forms/Field";
import { ErrorBanner } from "@/components/forms/Banners";
import { inputCls } from "@/components/forms/styles";
import { TurnstileWidget, turnstileConfigured } from "@/components/forms/TurnstileWidget";
import { submitEvent, updateOwnEvent } from "@/app/events/actions";
import { eventSchema } from "@/lib/validation/listings";
import { collectFieldErrors, showFieldErrors, FORM_ERROR, type FieldErrors } from "@/lib/validation/fields";
import { Button } from "@/components/ui/Button";
import RevisionQueuedNotice from "@/components/forms/RevisionQueuedNotice";
import { track } from "@/components/analytics/PostHogProvider";

type Mode = "user" | "admin";

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
  initialValues?: EventInitialValues;
  /**
   * The listing is already approved, so saving proposes a revision an
   * admin reviews rather than writing through (20260907000005). Only
   * changes the wording here — the database decides which path runs.
   */
  reviewOnSave?: boolean;
};

export default function EventForm({ signupEmail, defaultOrganiser, mode, editingId, initialValues, reviewOnSave }: Props) {
  const router = useRouter();

  const iv = initialValues;
  const initialContactIsCustom = !!iv && iv.contactEmail.toLowerCase() !== signupEmail.toLowerCase();

  const [title, setTitle] = useState(iv?.title ?? "");
  const [description, setDescription] = useState(iv?.description ?? "");
  const [lumaLink, setLumaLink] = useState(iv?.lumaLink ?? "");
  const [eventAt, setEventAt] = useState(iv?.eventAt ?? "");
  const [location, setLocation] = useState(iv?.location ?? "");
  const [organiserName, setOrganiserName] = useState(iv?.organiserName ?? defaultOrganiser);
  const [useCustomContact, setUseCustomContact] = useState(initialContactIsCustom);
  const [customContactEmail, setCustomContactEmail] = useState(initialContactIsCustom ? iv!.contactEmail : "");
  const [contactEmailVisible, setContactEmailVisible] = useState(iv?.contactEmailVisible ?? false);
  const [isSocietyEvent, setIsSocietyEvent] = useState(false);

  // Admin-only: mark a direct-published event as an official society event
  // (rendered accent in the directory) vs. an external one. Hidden for members
  // and on edits; the DB trigger rejects non-admin attempts regardless.
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
    setError("");
    setFieldErrors({});

    if (showTurnstile && !turnstileToken) {
      setError("Please complete the verification challenge below."); return;
    }

    // Same schema the server action runs, so every failing field is
    // reported at once and the two definitions can't drift apart.
    const parsed = collectFieldErrors(eventSchema, {
      title:                 title.trim(),
      description:           description.trim(),
      lumaLink:              lumaLink.trim(),
      eventAtIso:            eventAt ? new Date(eventAt).toISOString() : "",
      location:              location.trim(),
      organiserName:         organiserName.trim(),
      contactEmail:          useCustomContact ? customContactEmail.trim() : signupEmail,
      contactEmailVisible,
      isSocietyEvent:        showSocietyToggle ? isSocietyEvent : undefined,
    });
    if (!parsed.ok) {
      if (parsed.errors[FORM_ERROR]) setError(parsed.errors[FORM_ERROR]);
      showFieldErrors(parsed.errors, setFieldErrors, formRef.current);
      return;
    }
    const payload = parsed.data;

    setIsLoading(true);

    if (editingId) {
      const res = await updateOwnEvent(editingId, payload);
      if (!res.ok) {
        setError(res.error);
        setIsLoading(false);
        return;
      }
      track("listing_edited", { kind: "event", mode });
      if (res.data.staged) {
        // Only time and place get the Luma reminder: those are the two
        // fields somebody who already registered has to be told about.
        setStaged({
          remindAboutLuma:
            payload.eventAtIso !== (iv?.eventAt ? new Date(iv.eventAt).toISOString() : "")
            || payload.location !== iv?.location,
        });
        setIsLoading(false);
        return;
      }
      router.replace("/my-submissions");
      router.refresh();
      return;
    }

    const res = await submitEvent({ mode, turnstileToken, payload });

    if (!res.ok) {
      setError(res.error);
      setIsLoading(false);
      return;
    }

    track("listing_submitted", { kind: "event", mode });
    router.replace(mode === "admin" ? "/admin/events" : "/events?submitted=1");
    router.refresh();
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
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {showSocietyToggle && (
        <Field label="Event type" required hint="Society events are highlighted in accent in the directory." error={fieldErrors.isSocietyEvent}>
          <select
            value={isSocietyEvent ? "society" : "external"}
            onChange={(e) => setIsSocietyEvent(e.target.value === "society")}
            className={inputCls}
          >
            <option value="external">External event</option>
            <option value="society">Society event</option>
          </select>
        </Field>
      )}

      <Field label="Title" required error={fieldErrors.title}>
        <input type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} required />
      </Field>

      <Field label="Description" required hint={`${description.length}/5000`} error={fieldErrors.description}>
        <textarea rows={5} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} className={`${inputCls} resize-none`} required />
      </Field>

      <Field label="Luma link" required error={fieldErrors.lumaLink}>
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

      <div className="pt-2 border-t border-border-subtle">
        <div className="text-[0.85rem] text-text-primary mb-3 mt-3">Contact email</div>
        <p className="text-[0.75rem] text-text-muted leading-relaxed mb-3">
          Admins always see your signup email. Tick below to use a different inbox as the public contact.
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
            Make this contact email visible to community members.
            <span className="text-text-muted block text-[0.75rem] mt-0.5">If unchecked, attendees use the Luma link to RSVP.</span>
          </span>
        </label>
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
          "Publish event"
        ) : (
          "Submit for review"
        )}
      </Button>
    </form>
  );
}

