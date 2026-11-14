import type { Metadata } from "next";
import { isUuid } from "@/lib/uuid";
import { notFound } from "next/navigation";
import ListingDetailShell, {
  ActionSection, Description, Fact, Facts, ListingGone,
} from "@/components/ListingDetailShell";
import { OutArrow } from "@/components/FullPageLink";
import { Badge } from "@/components/ui/Badge";
import { requireApprovedUser } from "@/lib/auth/guard";
import { markedIds } from "@/lib/data/activity";
import { approvedEvent } from "@/lib/data/events";
import { formatDateTime, formatDateTimeLong } from "@/lib/dates";
import EventActions, { ContactOrganiserLink } from "./EventActions";
import { PendingRevisionNotice } from "@/components/PendingRevisionNotice";
import { hasPendingRevision } from "@/lib/listings/hasPendingRevision";
import { externalHref } from "@/lib/safeUrl";

export const metadata: Metadata = { title: "Event" };

// ════════════════════════════════════════════════════════════════════
// Foundry · One event
//
// Sibling of /opportunities/[id] and /vcs/[id] — same shell, same shape,
// same contract: one address per listing, and the old /events?e=<id>
// deep link redirects here.
//
// list_approved_events only returns events still to happen, so a link to
// last term's talk resolves to the "gone" body rather than to a page that
// invites an RSVP nobody can honour.
// ════════════════════════════════════════════════════════════════════

const BACK = { href: "/events", label: "All events" };

type Params = { id: string };

export default async function EventPage({ params }: { params: Promise<Params> }) {
  const [{ id }, { supabase, user, isAdmin }] = await Promise.all([
    params,
    requireApprovedUser(),
  ]);

  // A malformed id is a 404, not an RPC call that raises 22P02.
  if (!isUuid(id)) notFound();

  const ev = await approvedEvent(supabase, id, { userId: user.id, isAdmin });

  if (!ev) {
    return (
      <ListingDetailShell
        active="events"
        isAdmin={isAdmin}
        backHref={BACK.href}
        backLabel={BACK.label}
        eyebrow="Event"
        title="This event is no longer listed"
      >
        <ListingGone kind="event" backHref={BACK.href} backLabel="Browse events" />
      </ListingDetailShell>
    );
  }

  const [goingIds, revisionPending] = await Promise.all([
    markedIds(supabase, "event", "going"),
    hasPendingRevision(supabase, "event", id),
  ]);
  const posterName = `${ev.postedBy.firstName} ${ev.postedBy.surname}`.trim();

  return (
    <ListingDetailShell
      active="events"
      isAdmin={isAdmin}
      backHref={BACK.href}
      backLabel={BACK.label}
      eyebrow="Event"
      title={ev.title}
      meta={`${formatDateTime(ev.eventAt)} · ${ev.location}`}
    >
      {revisionPending && <PendingRevisionNotice noun="event" />}

      <div className="grid gap-10">
        {ev.isSocietyEvent && (
          <div>
            <Badge tone="lit">Society event</Badge>
          </div>
        )}

        <Description text={ev.description} />

        <Facts>
          <Fact label="When">{formatDateTimeLong(ev.eventAt)}</Fact>
          <Fact label="Where">{ev.location}</Fact>
          <Fact label="Organiser">{ev.organiserName}</Fact>
          <Fact label="Posted by">
            {posterName}
            {ev.postedBy.linkedinUrl && (
              <>
                {" · "}
                <a
                  href={externalHref(ev.postedBy.linkedinUrl)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-text-primary underline decoration-border-strong underline-offset-[3px] transition-colors hover:decoration-accent"
                >
                  LinkedIn
                  <OutArrow />
                </a>
              </>
            )}
          </Fact>
          {ev.contactEmail && (
            <Fact label="Contact organiser">
              <ContactOrganiserLink id={ev.id} email={ev.contactEmail} subject={ev.title} />
            </Fact>
          )}
        </Facts>

        <ActionSection title="Attend">
          <EventActions event={ev} going={goingIds.includes(ev.id)} />
        </ActionSection>
      </div>
    </ListingDetailShell>
  );
}
