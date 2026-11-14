"use client";

import type { CSSProperties } from "react";
import { Icon } from "@/design-system/icons/Icon";
import type { UrlFilters } from "@/lib/filters/useUrlFilters";
import { Button } from "./Button";

/**
 * Previous/next pager for a server-filtered list.
 *
 * Every page that pages does so for the same reason — PostgREST caps a
 * response at max_rows and says nothing when it truncates — so they all
 * page the same way: `?page=` in the URL, a server navigation to change it.
 * Renders nothing when everything fits on one page.
 *
 * Lumen draws it as two ring buttons (the ghost Button) either side of where
 * you are: "Page 3 of 12" with the current number lit in its own ring, and a
 * hairline gauge under it with a point of light at the current position. The
 * gauge is decoration (aria-hidden); the sentence carries the information. The
 * landmark, its name, the button names ("Previous", "Next") and the text
 * "Page N of M" are what they always were.
 */
export function Pager({
  url, page, total, pageSize, label,
}: {
  url: UrlFilters;
  page: number;
  /** Rows matching the current filters, not rows overall. */
  total: number;
  pageSize: number;
  /** Names the landmark, e.g. "Member pages". */
  label: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const go = (next: number) => url.apply({ page: String(next) });
  const position = (Math.min(Math.max(page, 1), totalPages) - 1) / (totalPages - 1);

  return (
    <nav aria-label={label} className="lm-pager">
      <Button
        variant="ghost"
        size="sm"
        disabled={page <= 1 || url.pending}
        onClick={() => go(page - 1)}
        leading={<Icon name="arrow-left" size={18} />}
      >
        Previous
      </Button>
      <div className="lm-pager__status">
        <span>
          Page <span className="lm-pager__now">{page}</span> of <span className="lm-pager__total">{totalPages}</span>
        </span>
        <span className="lm-pager__gauge" style={{ "--lm-p": position } as CSSProperties} aria-hidden="true" />
      </div>
      <Button
        variant="ghost"
        size="sm"
        disabled={page >= totalPages || url.pending}
        onClick={() => go(page + 1)}
      >
        Next
        <Icon name="arrow-right" size={18} />
      </Button>
    </nav>
  );
}
