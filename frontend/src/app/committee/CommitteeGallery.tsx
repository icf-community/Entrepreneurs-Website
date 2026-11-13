"use client";

import { useEffect, useRef, useState } from "react";
import { MemberCard } from "@/components/members/MemberCard";
import { MemberPhoto } from "@/components/members/MemberPhoto";
import { MemberDialog } from "@/components/members/MemberDialog";
import { Icon } from "@/design-system/icons/Icon";
import type { CommitteeMember } from "@/lib/data/committee";

// ════════════════════════════════════════════════════════════════════
// Foundry · The committee gallery
//
// A continuous, circular carousel: five full members show at a time,
// sliding by one member per arrow press (not jumping in blocks of
// five) and wrapping seamlessly from the last member back to the
// first. Dimmed photo slivers peek in on each side — the member just
// off-window in each direction — so the row reads as a window onto a
// longer, looping strip rather than a fixed page. Advancing crossfades
// the five full cards briefly; the peek that becomes the new edge
// member loses its dimming the instant it's part of the five, and the
// member that drops out of the five picks the dimming back up as it
// becomes the new peek on the other side.
//
// Reuses MemberCard's dense variant (built for NewestMembers, five
// across) for the five full cards, and MemberPhoto alone (no name/
// role text — there's no room to read it at peek width) for the
// dimmed neighbours.
// ════════════════════════════════════════════════════════════════════

const PAGE_SIZE = 5;
const FADE_MS = 150;

export default function CommitteeGallery({ members }: { members: CommitteeMember[] }) {
  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);
  const [open, setOpen] = useState<CommitteeMember | null>(null);
  const fadeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const total = members.length;
  const carousel = total > PAGE_SIZE;

  useEffect(() => () => {
    if (fadeTimeout.current) clearTimeout(fadeTimeout.current);
  }, []);

  const step = (delta: number) => {
    if (fading) return;
    setFading(true);
    fadeTimeout.current = setTimeout(() => {
      setIndex((i) => (i + delta + total) % total);
      setFading(false);
    }, FADE_MS);
  };
  const prev = () => step(-1);
  const next = () => step(1);

  // Arrow-key paging, matching the click targets — off while the profile
  // dialog is open so its own keyboard handling (e.g. Escape) isn't raced.
  useEffect(() => {
    if (open || !carousel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prev/next close over fading/total, not index
  }, [open, carousel, fading, total]);

  if (total === 0) return null;

  const at = (offset: number) => members[((index + offset) % total + total) % total];
  const visible = carousel ? Array.from({ length: PAGE_SIZE }, (_, i) => at(i)) : members;

  return (
    <div className="mx-auto max-w-[var(--content-max)]">
      <div className="flex items-center justify-center gap-3">
        {carousel && (
          <div className="hidden w-10 shrink-0 justify-end overflow-hidden opacity-40 sm:flex" aria-hidden>
            <MemberPhoto member={at(-1)} size="xl" />
          </div>
        )}

        <div
          className={`flex min-w-0 flex-1 flex-wrap justify-center gap-3 transition-opacity duration-150 ${fading ? "opacity-40" : "opacity-100"}`}
        >
          {visible.map((m) => (
            <div key={m.id} className="w-[calc(50%-0.375rem)] shrink-0 sm:w-[8.5rem]">
              <MemberCard member={m} dense onClick={() => setOpen(m)} />
            </div>
          ))}
        </div>

        {carousel && (
          <div className="hidden w-10 shrink-0 justify-start overflow-hidden opacity-40 sm:flex" aria-hidden>
            <MemberPhoto member={at(PAGE_SIZE)} size="xl" />
          </div>
        )}
      </div>

      {carousel && (
        <div className="mt-6 flex items-center justify-center gap-4">
          <button type="button" onClick={prev} aria-label="Previous committee member" className="lm-iconbtn">
            <Icon name="chevron-left" size={20} />
          </button>

          <p className="data w-24 text-center text-small text-text-muted">
            {index + 1} of {total}
          </p>

          <button type="button" onClick={next} aria-label="Next committee member" className="lm-iconbtn">
            <Icon name="chevron-right" size={20} />
          </button>
        </div>
      )}

      {open && <MemberDialog member={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
