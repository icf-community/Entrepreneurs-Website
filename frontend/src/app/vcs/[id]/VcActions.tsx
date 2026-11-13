"use client";

import { useEffect, useRef } from "react";
import { ExternalButtonLink } from "@/components/FullPageLink";
import { MarkActionPill } from "@/components/MarkActionPill";
import { recordListingEvent } from "@/lib/analytics";
import type { Vc } from "@/lib/data/vcs";

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
    <div className="flex flex-wrap items-start gap-3">
      <ExternalButtonLink
        href={v.link}
        lit
        onClick={() => recordListingEvent("vc_grant", v.id, "external_click")}
      >
        Open link
      </ExternalButtonLink>
      <MarkActionPill kind="vc_grant" id={v.id} initial={applied} />
    </div>
  );
}
