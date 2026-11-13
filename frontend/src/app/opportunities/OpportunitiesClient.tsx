"use client";
import { ViewProfileButton } from "@/components/members/ViewProfileButton";
import { audienceLabel } from "@/lib/listings/audience";

import { useEffect, useMemo, useRef, useState } from "react";
import { useUrlFilters, useSearchDraft } from "@/lib/filters/useUrlFilters";
import { SearchInput } from "@/components/filters/FilterBar";
import { useListingFreshness } from "@/lib/useListingFreshness";
import { ListingGoneNotice } from "@/components/ListingGoneNotice";
import { ExternalButtonLink, FullPageLink, OutArrow } from "@/components/FullPageLink";
import { BookmarkButton } from "@/components/BookmarkButton";
import { MarkActionPill } from "@/components/MarkActionPill";
import { recordListingEvent } from "@/lib/analytics";
import { formatDate } from "@/lib/dates";
import { startLabel, locationLabel } from "@/lib/listings/format";
import { toggleOpportunityBookmark } from "./actions";
import type { Opportunity } from "@/lib/data/opportunities";
import { externalHref, mailtoHref } from "@/lib/safeUrl";
import { settle } from "@/lib/settle";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Definition, DefinitionList } from "@/components/ui/DefinitionList";
import { Disclosure } from "@/components/ui/Disclosure";
import { EmptyState } from "@/components/ui/EmptyState";
import { Disc } from "@/design-system/icons/Disc";
import { Icon } from "@/design-system/icons/Icon";
import { useRouter } from "next/navigation";
import { createAiDraftHandoff } from "@/lib/ai/entryPoint";

// D1: every open role is rendered and hydrated as its own card, so a long
// board cost seconds of main thread on a mid-range phone (268 roles in the
// 10k corpus). Only the first PAGE matches render; search still covers all.
const PAGE = 30;

export default function OpportunitiesClient({
  // react-doctor-disable-next-line react-doctor/rerender-memo-with-default-value -- component is not wrapped in React.memo; rule's premise doesn't apply here
  items, bookmarkedIds, appliedIds = [], removeOnUnbookmark = false, aiEnabled = false,
}: {
  items: Opportunity[];
  bookmarkedIds: string[];
  /** Opportunity IDs the current user has self-marked as applied. */
  appliedIds?: string[];
  /** When true (used on /my-bookmarks), un-bookmarking a card also
   *  removes it from the visible list rather than just clearing the
   *  star — matches the user's intent on a bookmarks-only view. */
  removeOnUnbookmark?: boolean;
  /** S8 gap 20: shows "Find with AI" next to the search box. Off on
   *  /my-bookmarks, which reuses this component but has no page-level
   *  flag check. */
  aiEnabled?: boolean;
}) {
  // Client-side navigation: this page already holds every open role it can
  // show (list_approved_opportunities self-prunes past the deadline), so a
  // filter is a local operation and the URL is kept in step for free.
  const filters = useUrlFilters();
  const [query, setQuery] = useSearchDraft(filters);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [bookmarks, setBookmarks] = useState<Set<string>>(() => new Set(bookmarkedIds));
  const appliedSet = useMemo(() => new Set(appliedIds), [appliedIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = items.filter((o) => !dismissed.has(o.id));
    if (!q) return visible;
    return visible.filter((o) => {
      const hay = [
        o.positionName, o.company, o.pay, o.description,
        o.postedBy.firstName, o.postedBy.surname,
        o.locationText ?? "",
        ...o.skills, ...o.sectors,
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [items, query, dismissed]);

  // The count belongs to the search it was raised under; a new search
  // starts from one page again.
  const [paging, setPaging] = useState({ query, n: PAGE });
  const shown = paging.query === query ? paging.n : PAGE;

  const dismiss = (id: string) => setDismissed((prev) => new Set(prev).add(id));

  const rollbackBookmark = (id: string, wasBookmarked: boolean) => {
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (wasBookmarked) next.add(id); else next.delete(id);
      return next;
    });
    if (wasBookmarked && removeOnUnbookmark) {
      setDismissed((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const toast = useToast();
  // B7: ids with a bookmark write in flight; a repeat click waits for it.
  const inFlight = useRef<Set<string>>(new Set());

  const router = useRouter();
  const [searchingWithAi, setSearchingWithAi] = useState(false);

  // S8 gap 20. The link to /foundry-ai carries only an opaque handoff id,
  // never the search text (AI-plan.md "no criteria in URLs").
  const searchWithAi = async () => {
    setSearchingWithAi(true);
    const res = await createAiDraftHandoff("opportunities", { q: query });
    setSearchingWithAi(false);
    if (res.ok) router.push(`/foundry-ai?mode=opportunities&draft=${res.data.id}`);
    else toast(res.error, "error");
  };

  const handleToggleBookmark = (id: string) => {
    if (inFlight.current.has(id)) return;
    inFlight.current.add(id);
    // Optimistic update — flip the in-memory set, then call the server
    // and revert on failure. The .catch() matters as much as the
    // `!res.ok` branch: an actual thrown rejection (network blip
    // invoking the action, not a typed failure) would otherwise skip the
    // rollback entirely and leave the star stuck in the wrong state.
    const wasBookmarked = bookmarks.has(id);
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (wasBookmarked) next.delete(id); else next.add(id);
      return next;
    });
    if (wasBookmarked && removeOnUnbookmark) {
      setDismissed((prev) => new Set(prev).add(id));
    }
    void settle(toggleOpportunityBookmark(id)).then((res) => {
      inFlight.current.delete(id);
      if (!res.ok) {
        rollbackBookmark(id, wasBookmarked);
        toast("Couldn't update your bookmark. Please try again.", "error");
      }
    });
  };

  return (
    <>
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 sm:min-w-[16rem]">
          <SearchInput
            label="Search opportunities"
            placeholder="Search by role, company, skill, sector, or poster"
            value={query}
            onChange={setQuery}
            className=""
          />
        </div>
        {aiEnabled && (
          <Button
            variant="ghost"
            size="sm"
            loading={searchingWithAi}
            onClick={searchWithAi}
            leading={<Icon name="foundry-ai" size={18} />}
          >
            Find with AI
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={items.length === 0 ? "opportunities" : "search"}>
          {items.length === 0 ? "No opportunities posted yet." : "No opportunities match your search."}
        </EmptyState>
      ) : (
        <div className="grid gap-4">
          {filtered.slice(0, shown).map((o) => (
            <OpportunityCard
              key={o.id}
              opportunity={o}
              bookmarked={bookmarks.has(o.id)}
              applied={appliedSet.has(o.id)}
              onToggleBookmark={() => handleToggleBookmark(o.id)}
              onDismiss={() => dismiss(o.id)}
            />
          ))}
        </div>
      )}
      {filtered.length > shown && (
        <div className="mt-6 flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => setPaging({ query, n: shown + PAGE })}>
            Show more ({filtered.length - shown} more)
          </Button>
        </div>
      )}
    </>
  );
}

function OpportunityCard({
  opportunity: o, bookmarked, applied, onToggleBookmark, onDismiss,
}: {
  opportunity: Opportunity;
  bookmarked: boolean;
  applied: boolean;
  onToggleBookmark: () => void;
  onDismiss: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { checking, stale, check } = useListingFreshness("opportunities", o.id);
  const expandRecorded = useRef(false);

  useEffect(() => {
    if (!open) return;
    void check();
    if (!expandRecorded.current) {
      expandRecorded.current = true;
      recordListingEvent("opportunity", o.id, "expand");
    }
  }, [open, check, o.id]);

  const start = startLabel(o);
  const deadline = formatDate(o.applicationDeadline);
  const location = locationLabel(o);

  const poster = `${o.postedBy.firstName} ${o.postedBy.surname}`;

  return (
    <Disclosure
      id={`o-${o.id}`}
      lazy
      open={open}
      onOpenChange={setOpen}
      closedLabel="Show details"
      openLabel="Hide details"
      trailing={<span className="data">· Apply by {deadline}</span>}
      // The bookmark sits on the card's corner, outside the toggle, so a click on it never expands the card.
      accessory={<BookmarkButton bookmarked={bookmarked} onClick={onToggleBookmark} />}
      summary={
        <span className="flex items-start gap-4">
          <Disc size="sm">
            <Icon name="opportunities" size={18} />
          </Disc>
          <span className="grid min-w-0 flex-1 gap-1.5">
            <span className="block font-display text-lead text-text-primary">{o.positionName}</span>
            <span className="block text-small text-text-secondary">
              {o.company} · {location} · Starts {start}
              {audienceLabel(o.audience) && <> · {audienceLabel(o.audience)}</>}
            </span>
            <span className="data block text-small text-accent-light">{o.pay}</span>
            {(o.sectors.length > 0 || o.skills.length > 0) && (
              <span className="mt-1 flex flex-wrap gap-1.5">
                {o.sectors.map((s) => (
                  <Badge key={`sec-${s}`} tone="lit">{s}</Badge>
                ))}
                {o.skills.map((s) => (
                  <Badge key={`skl-${s}`}>{s}</Badge>
                ))}
              </span>
            )}
          </span>
        </span>
      }
    >
      {stale ? (
        <ListingGoneNotice kind="opportunity" onDismiss={onDismiss} />
      ) : (
        <div className="grid gap-5 pt-4">
          {checking && <p className="text-small text-text-muted">Loading latest details…</p>}
          <div className="grid gap-1.5">
            <p className="label-wide text-text-muted">Description</p>
            <p className="whitespace-pre-wrap text-body text-text-secondary">{o.description}</p>
          </div>

          <DefinitionList min="sm">
            <Definition term="Posted by">
              <span className="grid justify-items-start gap-2">
                <span>{poster}</span>
                <span className="flex flex-wrap items-center gap-3">
                  <ViewProfileButton memberId={o.postedBy.id} />
                  {o.postedBy.linkedinUrl && (
                    <a
                      href={externalHref(o.postedBy.linkedinUrl)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-small text-text-primary underline underline-offset-[3px] decoration-border-strong transition-colors hover:decoration-accent"
                    >
                      LinkedIn
                      <OutArrow />
                    </a>
                  )}
                </span>
              </span>
            </Definition>
            <Definition term="Apply by"><span className="data">{deadline}</span></Definition>
          </DefinitionList>

          <div className="grid gap-2">
            <p className="label-wide text-text-muted">How to apply</p>
            <div className="flex flex-wrap items-start gap-3">
              {o.applyMethod === "link" && o.applyUrl ? (
                <ExternalButtonLink
                  href={o.applyUrl}
                  onClick={() => recordListingEvent("opportunity", o.id, "apply_click")}
                >
                  Open application portal
                </ExternalButtonLink>
              ) : o.contactEmail ? (
                <ButtonLink
                  href={mailtoHref(o.contactEmail, o.positionName)}
                  onClick={() => recordListingEvent("opportunity", o.id, "contact_click")}
                  variant="primary"
                  size="sm"
                >
                  Email to apply
                  <OutArrow />
                </ButtonLink>
              ) : (
                <p className="self-center text-body text-text-secondary">
                  Contact <span className="text-text-primary">{poster}</span> via LinkedIn to apply.
                </p>
              )}
              <MarkActionPill kind="opportunity" id={o.id} initial={applied} />
              <FullPageLink href={`/opportunities/${o.id}`} />
            </div>
          </div>
        </div>
      )}
    </Disclosure>
  );
}
