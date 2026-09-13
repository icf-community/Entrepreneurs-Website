"use client";

import { useEffect, useRef } from "react";
import { AddToCalendarMenu } from "@/components/AddToCalendarMenu";
import { MarkActionPill } from "@/components/MarkActionPill";
import { recordListingEvent } from "@/lib/analytics";
import type { FoundryEvent } from "@/lib/data/events";
import { externalHref } from "@/lib/safeUrl";

// The browser-side half of /events/[id]: the RSVP click-through, the
// calendar menu, the going pill — and the mailto in the facts grid, which
// lives here only because clicking it is a tracked event.

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
    <div className="flex flex-wrap items-start gap-2">
      <a
        href={externalHref(ev.lumaLink)}
        target="_blank"
        rel="noreferrer noopener"
        onClick={() => recordListingEvent("event", ev.id, "external_click")}
        className="inline-block rounded-lg bg-accent px-4 py-2 text-[0.825rem] font-medium text-bg-primary no-underline transition-colors hover:bg-accent-light"
      >
        RSVP on Luma ↗
      </a>
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
      href={`mailto:${email}?subject=${encodeURIComponent(subject)}`}
      onClick={() => recordListingEvent("event", id, "contact_click")}
      className="break-all text-[0.85rem] text-text-secondary no-underline transition-colors hover:text-text-primary"
    >
      {email}
    </a>
  );
}
