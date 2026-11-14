"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { MemberPhoto } from "./MemberPhoto";
import { memberSubtitle } from "./memberSubtitle";
import type { DirectoryMember } from "@/lib/data/directory";

const MAX_LOOKING_FOR = 3;

// ════════════════════════════════════════════════════════════════════
// Foundry · Member card — directory grid, the "newest members" strip and the
// committee gallery
//
// Shared rather than three bespoke cards: a person in a ring, then who they are.
// `dense` is the only real difference: a tile (the ring above the name, centred)
// so five can sit in a row, without the bio, the hobbies or "Looking for".
//
// S8 gap 21: the primary action is a real <button>, stretched over the
// whole card with `absolute inset-0`, rather than a div with role="button"
// (which native keyboard handling, focus styling and the accessibility
// tree all treat as a second-class button). The "Looking for" links are
// its DOM SIBLINGS, not children — nesting an <a> inside a <button> is
// invalid HTML — stacked above it with `z-10` so they stay independently
// clickable and tab-reachable, while the name/bio block sits below
// them in the stack with `pointer-events-none` so clicks there fall
// through to the card button beneath. The button takes no state class (a
// spec compares its outerHTML before and after the dialog opens); its focus
// ring is drawn inside the card's edge.
// ════════════════════════════════════════════════════════════════════

export function MemberCard({
  member: m,
  onClick,
  dense = false,
}: {
  // A committee member carries a title (e.g. "President"); every other card passes none.
  member: DirectoryMember & { committeeRole?: string | null };
  onClick: () => void;
  dense?: boolean;
}) {
  const name = `${m.firstName} ${m.surname}`;
  // The card is the panel; the button is its target. Nothing about either changes with state.
  return (
    <Panel as="article" interactive>
      <button
        type="button"
        onClick={onClick}
        aria-label={`View ${m.firstName} ${m.surname}'s profile`}
        className="absolute inset-0 z-0 h-full w-full cursor-pointer rounded-[inherit] [--focus-offset:-3px]"
      />

      {dense ? (
        <div className="pointer-events-none relative z-[1] grid grid-cols-1 justify-items-center gap-3 px-3 pb-5 pt-6 text-center">
          <MemberPhoto member={m} size="xl" />
          <div className="w-full min-w-0">
            <p className="truncate font-display text-lead text-text-primary">{name}</p>
            <p className="break-words text-small text-text-muted">{memberSubtitle(m)}</p>
            {m.course && <p className="mt-0.5 line-clamp-2 break-words text-small text-text-secondary">{m.course}</p>}
          </div>
          {m.committeeRole ? <Badge tone="lit">{m.committeeRole}</Badge> : null}
        </div>
      ) : (
        <div className="pointer-events-none relative z-[1] grid grid-cols-1 gap-4 p-5">
          <div className="flex items-center gap-4">
            <MemberPhoto member={m} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-display text-lead text-text-primary">{name}</p>
              <p className="truncate text-small text-text-muted">{memberSubtitle(m)}</p>
              {m.course && <p className="mt-0.5 truncate text-small text-text-secondary">{m.course}</p>}
            </div>
          </div>

          {m.bioPreview && (
            <p className="line-clamp-2 break-words text-body text-text-secondary">{m.bioPreview}</p>
          )}

          {m.hobbiesPreview && (
            <p className="line-clamp-1 break-all text-small text-text-muted">
              <span className="label-wide text-text-muted">Outside of that:</span> {m.hobbiesPreview}
            </p>
          )}
        </div>
      )}

      {!dense && m.lookingFor.length > 0 && (
        <div className="relative z-10 flex flex-wrap items-center gap-x-2 px-5 pb-3 text-small text-text-muted">
          <span>Looking for</span>
          {m.lookingFor.slice(0, MAX_LOOKING_FOR).map((lf) => (
            // The pill is small to look at and 40 px to hit: the link carries the padding.
            <Link key={lf.id} href={`/opportunities/${lf.id}`} className="group/role inline-flex min-w-0 max-w-full items-center py-2 no-underline">
              <Badge tone="lit" className="min-w-0 max-w-full transition-colors duration-150 group-hover/role:bg-tint-3">
                <span className="truncate">{lf.role}</span>
              </Badge>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}
