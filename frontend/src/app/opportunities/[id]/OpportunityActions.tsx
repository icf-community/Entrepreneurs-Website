"use client";

import { useEffect, useRef, useState } from "react";
import { BookmarkButton } from "@/components/BookmarkButton";
import { ExternalButtonLink, OutArrow } from "@/components/FullPageLink";
import { MarkActionPill } from "@/components/MarkActionPill";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { recordListingEvent } from "@/lib/analytics";
import { toggleOpportunityBookmark } from "../actions";
import { applyHow, type ApplyHow } from "./applyHow";
import type { Opportunity } from "@/lib/data/opportunities";
import { mailtoHref } from "@/lib/safeUrl";
import { settle } from "@/lib/settle";
import { useToast } from "@/components/ui/Toast";

// Everything on the detail page that needs the browser: the apply
// click-through (recorded), the applied pill, and the bookmark ribbon.

/**
 * The page's one lit action: the poster's portal, or an email to the poster. A client
 * component of its own because the click is a tracked event; the page hands it to the
 * masthead (ListingDetailShell's `actions`), apart from the applied pill and the
 * bookmark under the facts. A role with neither has no button (see applyHow).
 */
export function OpportunityApplyButton({
  id, title, apply,
}: {
  id: string;
  /** The role's name: the subject of the email. */
  title: string;
  apply: Exclude<ApplyHow, { how: "linkedin" }>;
}) {
  return apply.how === "portal" ? (
    <ExternalButtonLink
      href={apply.url}
      size="md"
      lit
      onClick={() => recordListingEvent("opportunity", id, "apply_click")}
    >
      Open application portal
    </ExternalButtonLink>
  ) : (
    <ButtonLink
      href={mailtoHref(apply.email, title)}
      onClick={() => recordListingEvent("opportunity", id, "contact_click")}
      variant="primary"
      size="md"
      lit
    >
      Email to apply
      <OutArrow />
    </ButtonLink>
  );
}

export default function OpportunityActions({
  opportunity: o, applied, bookmarked: initiallyBookmarked,
}: {
  opportunity: Opportunity;
  applied: boolean;
  bookmarked: boolean;
}) {
  const [bookmarked, setBookmarked] = useState(initiallyBookmarked);
  const viewRecorded = useRef(false);

  // The same signal the card's "Show details" records — the reader has
  // the full listing in front of them. Recording it here is what stops the
  // move of /home's cards onto this page from silently zeroing the view
  // counts posters see on /my-submissions.
  useEffect(() => {
    if (viewRecorded.current) return;
    viewRecorded.current = true;
    recordListingEvent("opportunity", o.id, "expand");
  }, [o.id]);

  const toast = useToast();
  // A write-in-flight guard only, never read during render — a ref avoids
  // a re-render on every flip, same as OpportunitiesClient's `inFlight`.
  const saving = useRef(false);
  const toggleBookmark = () => {
    // B7: one write at a time; a failure says so instead of silently flipping back.
    if (saving.current) return;
    saving.current = true;
    // Optimistic, reverted if the write fails — same contract as the card.
    // The .catch() covers an actual thrown rejection (network blip
    // invoking the action), which would otherwise skip the rollback and
    // leave the ribbon stuck showing the wrong state.
    const was = bookmarked;
    setBookmarked(!was);
    void settle(toggleOpportunityBookmark(o.id)).then((res) => {
      saving.current = false;
      if (!res.ok) {
        setBookmarked(was);
        toast("Couldn't update your bookmark. Please try again.", "error");
      }
    });
  };

  return (
    <>
      {applyHow(o).how === "linkedin" && (
        <p className="text-body text-text-secondary">
          Contact{" "}
          <span className="text-text-primary">
            {o.postedBy.firstName} {o.postedBy.surname}
          </span>{" "}
          via LinkedIn to apply.
        </p>
      )}
      <div className="lm-actionrow">
        {/* The bookmark is a ring, not a button with words, so it shares the applied pill's cell rather than taking a cell of its own
            (alone it wrapped onto a second row at 390). */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <MarkActionPill kind="opportunity" id={o.id} initial={applied} />
          <BookmarkButton bookmarked={bookmarked} onClick={toggleBookmark} />
        </div>
      </div>
    </>
  );
}
