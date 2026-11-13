"use client";

import { Icon } from "@/design-system/icons/Icon";

// The ribbon on an opportunity, on its card and on its own page.
//
// Stateless on purpose: both callers already hold the bookmark set and do
// the optimistic flip themselves, because on /my-bookmarks un-starring
// also removes the row.
//
// A 44 px ring (the system's icon button). Saved closes the ribbon (the
// filled drawing) and lights the ring, so the state is never colour alone.

export function BookmarkButton({
  bookmarked, onClick,
}: {
  bookmarked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label={bookmarked ? "Remove bookmark" : "Bookmark this opportunity"}
      aria-pressed={bookmarked}
      className="lm-iconbtn aria-pressed:border-lit-line aria-pressed:bg-lit-muted aria-pressed:text-lit"
    >
      <Icon name={bookmarked ? "bookmark-filled" : "bookmark"} size={18} />
    </button>
  );
}
