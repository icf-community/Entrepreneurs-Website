import type { Metadata } from "next";
import { isUuid } from "@/lib/uuid";
import { notFound } from "next/navigation";
import { ViewProfileButton } from "@/components/members/ViewProfileButton";
import { audienceLabel } from "@/lib/listings/audience";
import ListingDetailShell, {
  ActionSection, Description, Fact, Facts, ListingGone,
} from "@/components/ListingDetailShell";
import { OutArrow } from "@/components/FullPageLink";
import { Badge } from "@/components/ui/Badge";
import { requireApprovedUser } from "@/lib/auth/guard";
import { markedIds } from "@/lib/data/activity";
import { approvedOpportunity, bookmarkedOpportunityIds } from "@/lib/data/opportunities";
import { formatDate } from "@/lib/dates";
import { startLabel, locationLabel } from "@/lib/listings/format";
import OpportunityActions from "./OpportunityActions";
import { PendingRevisionNotice } from "@/components/PendingRevisionNotice";
import { hasPendingRevision } from "@/lib/listings/hasPendingRevision";
import { externalHref } from "@/lib/safeUrl";

export const metadata: Metadata = { title: "Opportunity" };

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
  const [{ id }, { supabase, user, isAdmin }] = await Promise.all([
    params,
    requireApprovedUser(),
  ]);

  // A malformed id is a 404, not an RPC call that raises 22P02.
  if (!isUuid(id)) notFound();

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

      <div className="grid gap-10">
        {(o.sectors.length > 0 || o.skills.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {o.sectors.map((s) => (
              <Badge key={`sec-${s}`} tone="lit">{s}</Badge>
            ))}
            {o.skills.map((s) => (
              <Badge key={`skl-${s}`}>{s}</Badge>
            ))}
          </div>
        )}

        <Description text={o.description} />

        <Facts>
          <Fact label="Pay">{o.pay}</Fact>
          <Fact label="Apply by">{formatDate(o.applicationDeadline)}</Fact>
          <Fact label="Starts">{startLabel(o)}</Fact>
          <Fact label="Location">{locationLabel(o)}</Fact>
          {audienceLabel(o.audience) && <Fact label="Who can apply">{audienceLabel(o.audience)}</Fact>}
          <Fact label="Posted by">
            {posterName}
            {o.postedBy.linkedinUrl && (
              <>
                {" · "}
                <a
                  href={externalHref(o.postedBy.linkedinUrl)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-text-primary underline decoration-border-strong underline-offset-[3px] transition-colors hover:decoration-accent"
                >
                  LinkedIn
                  <OutArrow />
                </a>
              </>
            )}
            <div className="mt-2">
              <ViewProfileButton memberId={o.postedBy.id} />
            </div>
          </Fact>
        </Facts>

        <ActionSection title="How to apply">
          <OpportunityActions
            opportunity={o}
            applied={appliedIds.includes(o.id)}
            bookmarked={bookmarkedIds.includes(o.id)}
          />
        </ActionSection>
      </div>
    </ListingDetailShell>
  );
}
