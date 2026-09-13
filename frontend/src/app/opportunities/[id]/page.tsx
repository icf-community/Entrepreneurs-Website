import ListingDetailShell, {
  ListingGone, Fact, Description,
} from "@/components/ListingDetailShell";
import { requireApprovedUser } from "@/lib/auth/guard";
import { markedIds } from "@/lib/data/activity";
import { approvedOpportunity, bookmarkedOpportunityIds } from "@/lib/data/opportunities";
import { formatDate } from "@/lib/dates";
import { startLabel, locationLabel } from "@/lib/listings/format";
import OpportunityActions from "./OpportunityActions";
import { hasPendingRevision, PendingRevisionNotice } from "@/components/PendingRevisionNotice";
import { externalHref } from "@/lib/safeUrl";

// ════════════════════════════════════════════════════════════════════
// Foundry · One opportunity
//
// The page a role's own URL resolves to. /home, the directory's "Looking
// for" chips and /my-activity all point here, and the old
// /opportunities?o=<id> deep link redirects here — one address per
// listing, which is what makes a role shareable outside the app.
//
// The card on /opportunities keeps its expand-in-place details: that is
// the scanning affordance, and this is the permalink. Both render from
// the same Opportunity, so they cannot disagree about the facts.
// ════════════════════════════════════════════════════════════════════

const BACK = { href: "/opportunities", label: "All opportunities" };

type Params = { id: string };

export default async function OpportunityPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const { supabase, user, isAdmin } = await requireApprovedUser();

  const o = await approvedOpportunity(supabase, id);

  if (!o) {
    return (
      <ListingDetailShell
        active="opportunities"
        isAdmin={isAdmin}
        backHref={BACK.href}
        backLabel={BACK.label}
        eyebrow="Opportunity"
        title="This role is no longer listed"
      >
        <ListingGone kind="opportunity" backHref={BACK.href} backLabel="Browse opportunities" />
      </ListingDetailShell>
    );
  }

  const [bookmarkedIds, appliedIds, revisionPending] = await Promise.all([
    bookmarkedOpportunityIds(supabase, user.id),
    markedIds(supabase, "opportunity", "applied"),
    hasPendingRevision(supabase, "opportunity", id),
  ]);

  const posterName = `${o.postedBy.firstName} ${o.postedBy.surname}`.trim();

  return (
    <ListingDetailShell
      active="opportunities"
      isAdmin={isAdmin}
      backHref={BACK.href}
      backLabel={BACK.label}
      eyebrow="Opportunity"
      title={o.positionName}
      meta={`${o.company} · ${locationLabel(o)} · Starts ${startLabel(o)}`}
    >
      {revisionPending && <PendingRevisionNotice noun="role" />}

      {(o.sectors.length > 0 || o.skills.length > 0) && (
        <div className="mb-8 flex flex-wrap gap-1.5">
          {o.sectors.map((s) => (
            <span key={`sec-${s}`} className="rounded-lg border border-accent/20 bg-accent-muted px-2 py-0.5 text-[0.7rem] text-accent-light">{s}</span>
          ))}
          {o.skills.map((s) => (
            <span key={`skl-${s}`} className="rounded-lg border border-border bg-white/[0.03] px-2 py-0.5 text-[0.7rem] text-text-secondary">{s}</span>
          ))}
        </div>
      )}

      <Description text={o.description} />

      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Fact label="Pay">{o.pay}</Fact>
        <Fact label="Apply by">{formatDate(o.applicationDeadline)}</Fact>
        <Fact label="Starts">{startLabel(o)}</Fact>
        <Fact label="Location">{locationLabel(o)}</Fact>
        <Fact label="Posted by">
          {posterName}
          {o.postedBy.linkedinUrl && (
            <>
              {" · "}
              <a
                href={externalHref(o.postedBy.linkedinUrl)}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[0.8rem] text-text-primary underline decoration-border-strong underline-offset-[3px] transition-colors hover:decoration-accent"
              >
                LinkedIn ↗
              </a>
            </>
          )}
        </Fact>
      </div>

      <div className="mt-9 border-t border-border-subtle pt-7">
        <h2 className="mb-3 text-[0.7rem] uppercase tracking-wider text-text-muted">How to apply</h2>
        <OpportunityActions
          opportunity={o}
          applied={appliedIds.includes(o.id)}
          bookmarked={bookmarkedIds.includes(o.id)}
        />
      </div>
    </ListingDetailShell>
  );
}
