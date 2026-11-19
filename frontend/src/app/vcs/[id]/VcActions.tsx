"use client";

import { useEffect, useRef } from "react";
import { ExternalButtonLink } from "@/components/FullPageLink";
import { MarkActionPill } from "@/components/MarkActionPill";
import { recordListingEvent } from "@/lib/analytics";
import type { Vc } from "@/lib/data/vcs";

// The browser-side half of /vcs/[id]: the click-through to the fund's own
// site, and the applied pill.

/**
 * The page's one lit action. A client component of its own because the click is a
 * tracked event; the page hands it to the masthead (ListingDetailShell's `actions`),
 * apart from the applied pill under the facts.
 */
export function VcLinkButton({ id, href }: { id: string; href: string }) {
  return (
    <ExternalButtonLink
      href={href}
      size="md"
      lit
      onClick={() => recordListingEvent("vc_grant", id, "external_click")}
    >
      Open link
    </ExternalButtonLink>
  );
}

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
    <div className="lm-actionrow">
      <MarkActionPill kind="vc_grant" id={v.id} initial={applied} />
    </div>
  );
}
