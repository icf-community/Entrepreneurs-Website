"use client";

import { useEffect, useRef } from "react";
import { AddToCalendarMenu } from "@/components/AddToCalendarMenu";
import { ExternalButtonLink } from "@/components/FullPageLink";
import { MarkActionPill } from "@/components/MarkActionPill";
import { recordListingEvent } from "@/lib/analytics";
import type { FoundryEvent } from "@/lib/data/events";
import { mailtoHref } from "@/lib/safeUrl";

// The browser-side half of /events/[id]: the RSVP click-through, the
// calendar popover, the going pill — and the mailto in the facts grid, which
// lives here only because clicking it is a tracked event.

/**
 * The page's one lit action. It is a client component of its own because the click
 * is a tracked event, and the page hands it to the masthead (ListingDetailShell's
 * `actions`), apart from the calendar and the going pill under the facts.
 */
export function EventRsvpButton({ id, href }: { id: string; href: string }) {
  return (
    <ExternalButtonLink
      href={href}
      size="md"
      lit
      onClick={() => recordListingEvent("event", id, "external_click")}
    >
      RSVP on Luma
    </ExternalButtonLink>
  );
}

export default function EventActions({
  event: ev, going,
}: {
  event: FoundryEvent;
  going: boolean;
}) {
  const viewRecorded = useRef(false);

  // Same "the reader opened the details" signal the card records. See the
  // note in the opportunity's actions.
  useEffect(() => {
    if (viewRecorded.current) return;
    viewRecorded.current = true;
    recordListingEvent("event", ev.id, "expand");
  }, [ev.id]);

  return (
    <div className="lm-actionrow">
      <AddToCalendarMenu
        title={ev.title}
        description={ev.description}
        location={ev.location}
        startIso={ev.eventAt}
        url={ev.lumaLink}
      />
      <MarkActionPill kind="event" id={ev.id} initial={going} />
    </div>
  );
}

export function ContactOrganiserLink({
  id, email, subject,
}: {
  id: string;
  email: string;
  subject: string;
}) {
  return (
    <a
      href={mailtoHref(email, subject)}
      onClick={() => recordListingEvent("event", id, "contact_click")}
      className="break-all text-text-secondary underline decoration-border-strong underline-offset-[3px] transition-colors hover:text-text-primary hover:decoration-accent"
    >
      {email}
    </a>
  );
}
