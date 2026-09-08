"use client";

import { useEffect, useRef } from "react";
import { MarkActionPill } from "@/components/MarkActionPill";
import { recordListingEvent } from "@/lib/analytics";
import type { Vc } from "@/lib/data/vcs";
import { externalHref } from "@/lib/safeUrl";

// The browser-side half of /vcs/[id]: the click-through to the fund's own
// site, and the applied pill.

export default function VcActions({ vc: v, applied }: { vc: Vc; applied: boolean }) {
  const viewRecorded = useRef(false);

  // Same "the reader opened the details" signal the card records. See the
  // note in the opportunity's actions.
  useEffect(() => {
    if (viewRecorded.current) return;
    viewRecorded.current = true;
    recordListingEvent("vc_grant", v.id, "expand");
  }, [v.id]);

  return (
    <div className="flex flex-wrap items-start gap-2">
      <a
        href={externalHref(v.link)}
        target="_blank"
        rel="noreferrer noopener"
        onClick={() => recordListingEvent("vc_grant", v.id, "external_click")}
        className="inline-block rounded-lg bg-accent px-4 py-2 text-[0.825rem] font-medium text-bg-primary no-underline transition-colors hover:bg-accent-light"
      >
        Open link ↗
      </a>
      <MarkActionPill kind="vc_grant" id={v.id} initial={applied} />
    </div>
  );
}
