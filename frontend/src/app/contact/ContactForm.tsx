"use client";

import { useRef, useState, useTransition } from "react";
import { submitContactTicket } from "./actions";
import { TurnstileWidget } from "@/components/forms/TurnstileWidget";
import { turnstileConfigured } from "@/lib/turnstileConfig";
import { ErrorBanner, SuccessBanner } from "@/components/forms/Banners";
import { Field } from "@/components/forms/Field";
import { CONTACT_TOPICS, contactSchema } from "@/lib/validation/contact";
import { collectFieldErrors, showFieldErrors, FORM_ERROR, type FieldErrors } from "@/lib/validation/fields";
import { Button } from "@/components/ui/Button";
import { FormActions } from "@/components/ui/FormActions";
import { FormSection } from "@/components/ui/FormSection";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";

export default function ContactForm({
  defaultName = "",
  defaultEmail = "",
  lockEmail = false,
}: {
  defaultName?: string;
  /** Prefilled reply-to address; for a signed-in member this is their verified email. */
  defaultEmail?: string;
  /** When true (signed-in member), name/email come from the session — hide the inputs. */
  lockEmail?: boolean;
}) {
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [topic, setTopic] = useState<string>("general");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setFieldErrors({});
    setSent(false);
    if (turnstileConfigured && !turnstileToken) {
      setError("Please complete the verification challenge below.");
      return;
    }

    // The action validates with this same schema; running it here first means
    // a typo is caught beside the field instead of round-tripping and coming
    // back as a single banner.
    const parsed = collectFieldErrors(contactSchema, { name, email, topic, subject, message });
    if (!parsed.ok) {
      // With lockEmail the name/email inputs aren't rendered, so an error on
      // them would have nowhere to show. Send it to the banner instead.
      const hidden = lockEmail ? parsed.errors.email ?? parsed.errors.name : undefined;
      setError(parsed.errors[FORM_ERROR] ?? hidden ?? "");
      showFieldErrors(parsed.errors, setFieldErrors, formRef.current);
      return;
    }

    startTransition(async () => {
      const res = await submitContactTicket({ name, email, topic, subject, message, turnstileToken });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSent(true);
      setSubject("");
      setMessage("");
    });
  };

  return (
    <FormSection as="form" ref={formRef} onSubmit={handleSubmit}>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {sent && !error && (
        <SuccessBanner>Thanks — we&apos;ve received your message and will be in touch.</SuccessBanner>
      )}

      {!lockEmail && (
        <>
          <Field label="Name" hint="optional" error={fieldErrors.name}>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              autoComplete="name"
            />
          </Field>

          <Field label="Email" error={fieldErrors.email}>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          </Field>
        </>
      )}

      <Field label="What's this about?">
        <Select id="topic" value={topic} onChange={(e) => setTopic(e.target.value)}>
          {CONTACT_TOPICS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </Select>
      </Field>

      <Field label="Subject" error={fieldErrors.subject}>
        <Input
          id="subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={150}
          required
        />
      </Field>

      <Field label="Message" hint={`${message.length}/4000`} error={fieldErrors.message}>
        <Textarea
          id="message"
          rows={8}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="resize-none"
          maxLength={4000}
          required
        />
      </Field>

      {turnstileConfigured && <TurnstileWidget onToken={setTurnstileToken} />}

      <FormActions>
        <Button
          type="submit"
          loading={pending}
          variant="primary"
          size="md"
        >
          Send message
        </Button>
      </FormActions>
    </FormSection>
  );
}
