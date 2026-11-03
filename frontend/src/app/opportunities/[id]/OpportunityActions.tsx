"use client";

import { useEffect, useRef, useState } from "react";
import { BookmarkButton } from "@/components/BookmarkButton";
import { MarkActionPill } from "@/components/MarkActionPill";
import { recordListingEvent } from "@/lib/analytics";
import { toggleOpportunityBookmark } from "../actions";
import type { Opportunity } from "@/lib/data/opportunities";
import { externalHref, mailtoHref } from "@/lib/safeUrl";
import { settle } from "@/lib/settle";
import { useToast } from "@/components/ui/Toast";

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
    // leave the star stuck showing the wrong state.
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
          href={mailtoHref(o.contactEmail, o.positionName)}
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
