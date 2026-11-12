"use client";

import { useRef, useState, useTransition } from "react";
import { submitContactTicket } from "./actions";
import { TurnstileWidget } from "@/components/forms/TurnstileWidget";
import { turnstileConfigured } from "@/lib/turnstileConfig";
import { ErrorBanner, SuccessBanner } from "@/components/forms/Banners";
import { FieldError } from "@/components/forms/Field";
import { contactSchema } from "@/lib/validation/contact";
import { collectFieldErrors, showFieldErrors, FORM_ERROR, type FieldErrors } from "@/lib/validation/fields";
import { Button } from "@/components/ui/Button";

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
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const formRef = useRef<HTMLFormElement>(null);

  const inputCls =
    "w-full px-4 py-3 bg-white/[0.03] border border-border rounded-lg text-[0.85rem] text-text-primary placeholder:text-text-muted transition-colors duration-150 focus:border-accent/50 focus:bg-white/[0.05]";

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
    const parsed = collectFieldErrors(contactSchema, { name, email, subject, message });
    if (!parsed.ok) {
      // With lockEmail the name/email inputs aren't rendered, so an error on
      // them would have nowhere to show. Send it to the banner instead.
      const hidden = lockEmail ? parsed.errors.email ?? parsed.errors.name : undefined;
      setError(parsed.errors[FORM_ERROR] ?? hidden ?? "");
      showFieldErrors(parsed.errors, setFieldErrors, formRef.current);
      return;
    }

    startTransition(async () => {
      const res = await submitContactTicket({ name, email, subject, message, turnstileToken });
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
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-5 rounded-2xl bg-bg-card border border-border p-8">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {sent && !error && (
        <SuccessBanner>Thanks — we&apos;ve received your message and will be in touch.</SuccessBanner>
      )}

      {!lockEmail && (
        <>
          <div data-invalid={fieldErrors.name ? "" : undefined}>
            <label htmlFor="name" className="block text-[0.75rem] text-text-muted mb-1.5">
              Name <span className="text-text-muted ml-2">optional</span>
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              maxLength={120}
              autoComplete="name"
            />
            <FieldError>{fieldErrors.name}</FieldError>
          </div>

          <div data-invalid={fieldErrors.email ? "" : undefined}>
            <label htmlFor="email" className="block text-[0.75rem] text-text-muted mb-1.5">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
              maxLength={254}
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
            <FieldError>{fieldErrors.email}</FieldError>
          </div>
        </>
      )}

      <div data-invalid={fieldErrors.subject ? "" : undefined}>
        <label htmlFor="subject" className="block text-[0.75rem] text-text-muted mb-1.5">Subject</label>
        <input
          id="subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className={inputCls}
          maxLength={150}
          required
        />
        <FieldError>{fieldErrors.subject}</FieldError>
      </div>

      <div data-invalid={fieldErrors.message ? "" : undefined}>
        <label htmlFor="message" className="block text-[0.75rem] text-text-muted mb-1.5">
          Message <span className="text-text-muted ml-2">{message.length}/4000</span>
        </label>
        <textarea
          id="message"
          rows={8}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className={`${inputCls} resize-none`}
          maxLength={4000}
          required
        />
        <FieldError>{fieldErrors.message}</FieldError>
      </div>

      {turnstileConfigured && <TurnstileWidget onToken={setTurnstileToken} />}

      <Button
        type="submit"
        loading={pending}
        variant="primary"
        size="md"
      >
        Send message
      </Button>
    </form>
  );
}
