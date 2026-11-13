import AppShell from "@/components/app/AppShell";
import { PageHead } from "@/components/ui/PageHead";
import { requireApprovedUser } from "@/lib/auth/guard";
import { myActivity } from "@/lib/data/activity";
import { myCalendarListings } from "@/lib/data/ownListings";
import CalendarClient, { type CalItem } from "./CalendarClient";

export default async function CalendarPage() {
  const { supabase, user, isAdmin, displayName } = await requireApprovedUser();

  // Two sources: items the user marked as applied/going (get_my_activity)
  // and listings the user posted themselves. Own listings cover pending +
  // approved — their actual commitments — and are read directly (RLS lets
  // a poster see their own rows regardless of status, same as
  // /my-submissions). Past items drop off via the client's upcoming filter.
  const [activity, own] = await Promise.all([
    myActivity(supabase),
    myCalendarListings(supabase, user.id),
  ]);

  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  const locationLabel = (type: string, text: string | null) => {
    const t = type === "remote" ? "Remote" : type === "onsite" ? "Onsite" : "Hybrid";
    return clean(text) ? `${t} · ${text!.trim()}` : t;
  };

  const activityItems: CalItem[] = activity
    .filter((r) => r.occursAt != null)
    .map((r) => ({
      listingKind: r.listingKind, listingId: r.listingId,
      title: r.title, subtitle: r.subtitle, occursAt: r.occursAt as string,
      role: r.actionType, status: "approved", description: null,
      meta: clean(r.url) ? [{ label: "Link", value: r.url!, href: r.url! }] : [],
    }));

  const ownEvents: CalItem[] = own.events
    .filter((r) => r.event_at != null)
    .map((r) => ({
      listingKind: "event", listingId: r.id, title: r.title, subtitle: clean(r.location),
      occursAt: r.event_at as string, role: "organising", status: r.status as Status,
      description: clean(r.description),
      meta: [
        ...(clean(r.location)        ? [{ label: "Location",   value: r.location!.trim() }] : []),
        ...(clean(r.organiser_name)  ? [{ label: "Organiser",  value: r.organiser_name!.trim() }] : []),
        ...(clean(r.luma_link)       ? [{ label: "Event page", value: r.luma_link!.trim(), href: r.luma_link!.trim() }] : []),
      ],
    }));

  const ownOpps: CalItem[] = own.opportunities
    .filter((r) => r.application_deadline != null)
    .map((r) => ({
      listingKind: "opportunity", listingId: r.id, title: r.position_name, subtitle: clean(r.company),
      occursAt: r.application_deadline as string, role: "posted", status: r.status as Status,
      description: clean(r.description),
      meta: [
        ...(clean(r.company) ? [{ label: "Company",  value: r.company.trim() }] : []),
        ...(clean(r.pay)     ? [{ label: "Pay",      value: r.pay!.trim() }] : []),
        { label: "Location", value: locationLabel(r.location_type, r.location_text) },
        r.apply_method === "link" && clean(r.apply_url)
          ? { label: "How to apply", value: r.apply_url!.trim(), href: r.apply_url!.trim() }
          : { label: "How to apply", value: "Contact the poster" },
      ],
    }));

  const ownVcs: CalItem[] = own.vcs
    .filter((r) => r.deadline != null)
    .map((r) => ({
      listingKind: "vc_grant", listingId: r.id, title: r.name,
      subtitle: r.kind === "grant" ? "Grant" : "Venture capital",
      occursAt: r.deadline as string, role: "posted", status: r.status as Status,
      description: clean(r.description),
      meta: [
        { label: "Type", value: r.kind === "grant" ? "Grant" : "Venture capital" },
        ...(clean(r.amount) ? [{ label: "Amount", value: r.amount!.trim() }] : []),
        ...(clean(r.stage)  ? [{ label: "Stage",  value: r.stage!.trim() }] : []),
        ...(clean(r.link)   ? [{ label: "Link",   value: r.link.trim(), href: r.link.trim() }] : []),
      ],
    }));

  // De-dupe by listing — a user may have marked their own listing as
  // going. Own-posted is listed first so its role ("Organising") wins.
  const byKey = new Map<string, CalItem>();
  for (const i of [...ownEvents, ...ownOpps, ...ownVcs, ...activityItems]) {
    const key = `${i.listingKind}:${i.listingId}`;
    if (!byKey.has(key)) byKey.set(key, i);
  }
  const items = Array.from(byKey.values());

  return (
    <AppShell active="calendar" name={displayName} isAdmin={isAdmin}>
      <div className="px-[var(--gutter)] pb-20 pt-6 sm:pt-10">
        <div className="mx-auto max-w-[var(--content-max)]">
          {/* The month grid is the one dense table on the site, so the column is the widest one. */}
          <PageHead context="Your calendar" title="Events, opportunity deadlines, and VC deadlines" className="mb-8" />
          <CalendarClient items={items} />
        </div>
      </div>
    </AppShell>
  );
}

type Status = "pending" | "approved";
