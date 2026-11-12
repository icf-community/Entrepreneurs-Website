"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/auth/currentUser";
import { sendContactConfirmation, sendContactTicket } from "@/lib/email";
import { contactSchema } from "@/lib/validation/contact";
import { validate } from "@/lib/validation/listings";
import * as Sentry from "@sentry/nextjs";
import { check, clientIp } from "@/lib/ratelimit";
import { verifyTurnstile } from "@/lib/turnstile";
import { errorSummary } from "@/lib/errorSummary";

type Result = { ok: true } | { ok: false; error: string };

// Public contact form: anyone (member or not) can reach the society here.
// Spam is held off by Turnstile + the Upstash `submit` bucket, not an auth
// wall — that's what those layers are for. See tasks/WIRING_CHECKLIST.md §5b.
export async function submitContactTicket(input: unknown): Promise<Result> {
  const parsed = validate(contactSchema, input);
  if (!parsed.ok) return parsed;
  const { name, email, subject, message } = parsed.data;
  const token = (input as { turnstileToken?: string } | null)?.turnstileToken;

  if (!(await verifyTurnstile(token))) {
    return { ok: false, error: "Verification failed. Please complete the challenge and try again." };
  }

  // Rate-limit identity: per-user when signed in (NAT-safe), else per-IP.
  // Anonymous campus visitors share one public IP, but contact volume is
  // low and the 60/min/IP middleware bucket is the coarse backstop.
  const supabase = await createClient();
  const { user } = await currentUser(supabase);
  const rlKey = user?.id ?? clientIp(await headers());
  const decision = await check("submit", rlKey);
  if (decision === "limited") {
    return { ok: false, error: "You're sending messages too frequently. Please try again later." };
  }
  if (decision === "unavailable") {
    // Fails closed, like every `submit` caller. This is the contact form, so
    // the person being turned away may have no other way to reach the society
    // — worth an alert rather than a log line nobody reads.
    Sentry.captureMessage(
      "submit rate-limit bucket unreachable — the contact form is refusing messages (fail-closed)",
      { level: "error", tags: { bucket: "submit", surface: "contact" } },
    );
    return { ok: false, error: "We can't take messages right now. Please try again in a few minutes." };
  }

  try {
    await sendContactTicket({
      fromEmail: email,
      firstName: name?.trim() || null,
      surname: null,
      subject,
      message,
    });
  } catch (e) {
    // Public endpoint: never surface the underlying error text (it can carry
    // DB/network internals). Log server-side for diagnosis; return a generic
    // message the form shows verbatim.
    console.error("submitContactTicket: enqueue failed", errorSummary(e));
    Sentry.captureException(e, { tags: { surface: "contact", path: "ticket-enqueue" } });
    return { ok: false, error: "Something went wrong sending your message. Please try again shortly." };
  }

  // Best-effort acknowledgement to the sender — only for signed-in members,
  // and always sent to their *session* address, never the caller-supplied
  // form value. A server action is just a POST endpoint: a member could submit
  // an arbitrary `email`, so auto-replying to the form value would be a
  // reflective-spam vector (Foundry-branded mail to a victim of their choosing).
  // Anonymous visitors get no confirmation at all. The ticket already reached
  // the team above either way; a hiccup here must not fail the request.
  if (user?.email) {
    try {
      await sendContactConfirmation({
        to: user.email,
        firstName: name?.trim() || null,
        subject,
      });
    } catch (e) {
      console.error("submitContactTicket: confirmation enqueue failed", errorSummary(e));
      Sentry.captureException(e, { tags: { surface: "contact", path: "confirmation-enqueue" } });
    }
  }

  return { ok: true };
}
