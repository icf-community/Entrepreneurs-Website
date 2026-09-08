import ListingDetailShell, {
  ListingGone, Fact, Description,
} from "@/components/ListingDetailShell";
import { requireApprovedUser } from "@/lib/auth/guard";
import { markedIds } from "@/lib/data/activity";
import { approvedEvent } from "@/lib/data/events";
import { formatDateTime, formatDateTimeLong } from "@/lib/dates";
import EventActions, { ContactOrganiserLink } from "./EventActions";
import { hasPendingRevision, PendingRevisionNotice } from "@/components/PendingRevisionNotice";
import { externalHref } from "@/lib/safeUrl";

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
  const { id } = await params;
  const { supabase, isAdmin } = await requireApprovedUser();

  const ev = await approvedEvent(supabase, id);

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

      {ev.isSocietyEvent && (
        <div className="mb-8">
          <span className="inline-block rounded-lg bg-accent px-2.5 py-0.5 text-[0.7rem] font-semibold text-bg-primary">
            Society event
          </span>
        </div>
      )}

      <Description text={ev.description} />

      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
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
                className="text-[0.8rem] text-text-primary underline decoration-border-strong underline-offset-[3px] transition-colors hover:decoration-accent"
              >
                LinkedIn ↗
              </a>
            </>
          )}
        </Fact>
        {ev.contactEmail && (
          <Fact label="Contact organiser">
            <ContactOrganiserLink id={ev.id} email={ev.contactEmail} subject={ev.title} />
          </Fact>
        )}
      </div>

      <div className="mt-9 border-t border-border-subtle pt-7">
        <h2 className="mb-3 text-[0.7rem] uppercase tracking-wider text-text-muted">Attend</h2>
        <EventActions event={ev} going={goingIds.includes(ev.id)} />
      </div>
    </ListingDetailShell>
  );
}
