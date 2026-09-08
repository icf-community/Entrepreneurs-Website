"use client";

import { useEffect, useRef, useState } from "react";
import { BookmarkButton } from "@/components/BookmarkButton";
import { MarkActionPill } from "@/components/MarkActionPill";
import { recordListingEvent } from "@/lib/analytics";
import { toggleOpportunityBookmark } from "../actions";
import type { Opportunity } from "@/lib/data/opportunities";
import { externalHref } from "@/lib/safeUrl";

// Everything on the detail page that needs the browser: the apply
// click-through (recorded), the applied pill, and the bookmark star.

export default function OpportunityActions({
  opportunity: o, applied, bookmarked: initiallyBookmarked,
}: {
  opportunity: Opportunity;
  applied: boolean;
  bookmarked: boolean;
}) {
  const [bookmarked, setBookmarked] = useState(initiallyBookmarked);
  const viewRecorded = useRef(false);

  // The same signal the card's "▸ Show details" records — the reader has
  // the full listing in front of them. Recording it here is what stops the
  // move of /home's cards onto this page from silently zeroing the view
  // counts posters see on /my-submissions.
  useEffect(() => {
    if (viewRecorded.current) return;
    viewRecorded.current = true;
    recordListingEvent("opportunity", o.id, "expand");
  }, [o.id]);

  const toggleBookmark = () => {
    // Optimistic, reverted if the write fails — same contract as the card.
    // The .catch() covers an actual thrown rejection (network blip
    // invoking the action), which would otherwise skip the rollback and
    // leave the star stuck showing the wrong state.
    const was = bookmarked;
    setBookmarked(!was);
    void toggleOpportunityBookmark(o.id)
      .then((res) => {
        if (!res.ok) setBookmarked(was);
      })
      .catch((e) => {
        console.error("Failed to toggle bookmark:", e);
        setBookmarked(was);
      });
  };

  return (
    <div className="flex flex-wrap items-start gap-2">
      {o.applyMethod === "link" && o.applyUrl ? (
        <a
          href={externalHref(o.applyUrl)}
          target="_blank"
          rel="noreferrer noopener"
          onClick={() => recordListingEvent("opportunity", o.id, "apply_click")}
          className="inline-block rounded-lg bg-accent px-4 py-2 text-[0.825rem] font-medium text-bg-primary no-underline transition-colors hover:bg-accent-light"
        >
          Open application portal ↗
        </a>
      ) : o.contactEmail ? (
        <a
          href={`mailto:${o.contactEmail}?subject=${encodeURIComponent(o.positionName)}`}
          onClick={() => recordListingEvent("opportunity", o.id, "contact_click")}
          className="inline-block rounded-lg bg-accent px-4 py-2 text-[0.825rem] font-medium text-bg-primary no-underline transition-colors hover:bg-accent-light"
        >
          Email to apply ↗
        </a>
      ) : (
        <p className="text-[0.85rem] text-text-secondary">
          Contact{" "}
          <span className="text-text-primary">
            {o.postedBy.firstName} {o.postedBy.surname}
          </span>{" "}
          via LinkedIn to apply.
        </p>
      )}
      <MarkActionPill kind="opportunity" id={o.id} initial={applied} />
      <BookmarkButton bookmarked={bookmarked} onClick={toggleBookmark} />
    </div>
  );
}
