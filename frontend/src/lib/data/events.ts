import "server-only";
import { rows, type Db } from "./query";

export type FoundryEvent = {
  id: string;
  title: string;
  description: string;
  lumaLink: string;
  eventAt: string;
  location: string;
  organiserName: string;
  contactEmail: string | null;
  isSocietyEvent: boolean;
  /** When the row was added, not when the event happens. /home sorts on it. */
  createdAt: string;
  postedBy: { firstName: string; surname: string; linkedinUrl: string | null };
};

type Row = {
  id: string;
  title: string;
  description: string;
  luma_link: string;
  event_at: string;
  location: string;
  organiser_name: string;
  contact_email: string | null;
  is_society_event: boolean;
  created_at: string;
  poster_first_name: string | null;
  poster_surname: string | null;
  poster_linkedin_url: string | null;
};

export function toEvent(r: Row): FoundryEvent {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    lumaLink: r.luma_link,
    eventAt: r.event_at,
    location: r.location,
    organiserName: r.organiser_name,
    contactEmail: r.contact_email,
    isSocietyEvent: r.is_society_event,
    createdAt: r.created_at,
    postedBy: {
      firstName:   r.poster_first_name ?? "",
      surname:     r.poster_surname    ?? "",
      linkedinUrl: r.poster_linkedin_url,
    },
  };
}

/**
 * Approved, upcoming events.
 *
 * SECURITY DEFINER RPC masks contact_email at the DB layer rather than the
 * application mapper (migration 20260530000002). It also filters to
 * event_at >= now(), so this list is bounded by what is actually upcoming
 * rather than by how many events have ever existed.
 */
/** What a /home card shows — and nothing viewer-dependent, so no contact_email. */
export type NewestEvent = Pick<FoundryEvent, "id" | "title" | "eventAt" | "location" | "isSocietyEvent" | "createdAt">;

/**
 * The most recently added open events, for /home.
 *
 * Its own RPC rather than list_approved_events() sliced in JS: that
 * shipped every open event, descriptions and all, to show three
 * (20260917000019).
 */
export async function newestEvents(db: Db, limit = 3): Promise<NewestEvent[]> {
  const data = await rows("list_newest_events", () => db.rpc("list_newest_events", { p_limit: limit }));
  return data.map((r) => ({
    id:             r.id,
    title:          r.title,
    eventAt:        r.event_at,
    location:       r.location,
    isSocietyEvent: r.is_society_event,
    createdAt:      r.created_at,
  }));
}

export async function listApprovedEvents(db: Db): Promise<FoundryEvent[]> {
  const data = await rows("list_approved_events", () => db.rpc("list_approved_events"));
  return data.map(toEvent);
}

/**
 * The one event the poster is editing, or null if there is no such row.
 *
 * SECURITY DEFINER: the RPC checks caller = poster and returns
 * contact_email accordingly (migration 20260530000002). It returns a set,
 * so at most one row — the caller decides what a miss means, and every
 * caller so far 404s rather than saying whether the id exists.
 */
export async function eventForEdit(db: Db, id: string) {
  const data = await rows("get_event_for_edit", () =>
    db.rpc("get_event_for_edit", { p_id: id }));
  return data[0] ?? null;
}

/**
 * One approved, upcoming event, or null.
 *
 * Goes through listApprovedEvents for the same reason approvedOpportunity
 * goes through its list: contact_email is masked inside the RPC, so a
 * direct table read would leak it. The RPC's event_at >= now() filter
 * means an event that has already happened is a miss.
 */
export async function approvedEvent(db: Db, id: string): Promise<FoundryEvent | null> {
  const items = await listApprovedEvents(db);
  return items.find((e) => e.id === id) ?? null;
}
