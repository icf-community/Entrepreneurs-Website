"use client";

import Link from "next/link";
import { MemberPhoto } from "./MemberPhoto";
import { memberSubtitle } from "./memberSubtitle";
import type { DirectoryMember } from "@/lib/data/directory";

const MAX_LOOKING_FOR = 3;

// ════════════════════════════════════════════════════════════════════
// Foundry · Member card — directory grid and the "newest members" strip
//
// Shared rather than two bespoke cards: the photo-leads-details layout
// is the same in both places, and `dense` is the only real difference
// (the strip drops bio/hobbies/"looking for" so five can sit in a row
// without crowding).
//
// S8 gap 21: the primary action is a real <button>, stretched over the
// whole card with `absolute inset-0`, rather than a div with role="button"
// (which native keyboard handling, focus styling and the accessibility
// tree all treat as a second-class button). The "Looking for" links are
// its DOM SIBLINGS, not children — nesting an <a> inside a <button> is
// invalid HTML — stacked above it with `z-10` so they stay independently
// clickable and tab-reachable, while the photo/name/bio block sits below
// them in the stack with `pointer-events-none` so clicks there fall
// through to the card button beneath.
// ════════════════════════════════════════════════════════════════════

export function MemberCard({
  member: m,
  onClick,
  dense = false,
}: {
  member: DirectoryMember;
  onClick: () => void;
  dense?: boolean;
}) {
  return (
    <article
      className={`relative overflow-hidden rounded-2xl border transition-colors duration-150 group ${
        dense
          ? "bg-accent-muted/30 border-accent/20 hover:border-accent hover:bg-accent-muted/40"
          : "bg-bg-card border-border hover:border-accent hover:bg-bg-card/80"
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={`View ${m.firstName} ${m.surname}'s profile`}
        className="absolute inset-0 z-0 h-full w-full cursor-pointer rounded-2xl"
      />

      <div className="pointer-events-none relative z-[1]">
        <MemberPhoto member={m} aspect="aspect-square" rounded="rounded-t-2xl" />

        <div className={`border-t border-border ${dense ? "p-3" : "p-4"}`}>
          <div className={`font-medium text-text-primary truncate ${dense ? "text-body" : "text-lead"}`}>
            {m.firstName} {m.surname}
          </div>
          <div className={`text-text-muted mt-0.5 truncate ${dense ? "text-small" : "text-small"}`}>
            {memberSubtitle(m)}
          </div>
          {m.course && (
            <div className={`text-text-secondary mt-1 truncate ${dense ? "text-small" : "text-small"}`}>
              {m.course}
            </div>
          )}

          {!dense && m.bioPreview && (
            <p className="mt-3 line-clamp-2 break-words text-body leading-relaxed text-text-secondary">
              {m.bioPreview}
            </p>
          )}

          {!dense && m.hobbiesPreview && (
            <div className="mt-2 line-clamp-1 break-all text-small leading-relaxed text-text-muted">
              <span className="label-wide text-text-muted">Outside of that:</span> {m.hobbiesPreview}
            </div>
          )}
        </div>
      </div>

      {!dense && m.lookingFor.length > 0 && (
        <div className="relative z-10 flex items-center flex-wrap gap-1.5 px-4 pb-4 text-small text-text-muted">
          <span>Looking for</span>
          {m.lookingFor.slice(0, MAX_LOOKING_FOR).map((lf) => (
            <Link
              key={lf.id}
              href={`/opportunities/${lf.id}`}
              className="rounded-lg border border-border-strong px-2 py-0.5 text-small text-text-primary no-underline transition-colors hover:border-accent hover:bg-tint-3"
            >
              {lf.role}
            </Link>
          ))}
        </div>
      )}
    </article>
  );
}
