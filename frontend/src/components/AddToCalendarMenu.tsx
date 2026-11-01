"use client";

import { useEffect, useRef, useState } from "react";
import { googleCalendarUrl, icsDataUri, type CalendarEvent } from "@/lib/calendar";

// ════════════════════════════════════════════════════════════════════
// Foundry · Add-to-calendar dropdown
//
// Two options:
//   • Add to Google Calendar — opens the render URL in a new tab.
//   • Download .ics          — covers Apple Calendar, Outlook (desktop
//                              and web), and most other clients.
//
// Stops click propagation so opening the menu inside an event card
// doesn't toggle the card's expand state. Click-outside closes the
// menu without leaking handlers across mounts.
//
// A disclosure (a button that reveals two links), not an ARIA menu: role=menu
// promises arrow-key navigation and a roving focus that this does not have,
// so Tab moves through the links like any other. Escape and choosing an item
// close it and give focus back to the button, otherwise a keyboard user is
// dropped back at the top of the page when the focused link unmounts.
// ════════════════════════════════════════════════════════════════════

type Props = CalendarEvent;

export function AddToCalendarMenu(props: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); buttonRef.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown",   onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown",   onEsc);
    };
  }, [open]);

  const gcalUrl = googleCalendarUrl(props);
  const icsUrl  = icsDataUri(props);
  const icsName = slugifyTitle(props.title);

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.05] border border-border-strong text-text-primary text-[0.8rem] font-medium transition-colors cursor-pointer hover:bg-white/[0.10] hover:border-accent"
      >
        <CalendarIcon />
        Add to calendar
        <span className="text-text-muted">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div
          className="absolute z-20 mt-1 right-0 min-w-[210px] rounded-xl border border-border-subtle bg-bg-card shadow-xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <a
            href={gcalUrl}
            target="_blank"
            rel="noreferrer noopener"
            onClick={close}
            className="block px-4 py-2.5 text-[0.825rem] text-text-secondary no-underline transition-colors hover:bg-white/[0.04] hover:text-text-primary"
          >
            Google Calendar ↗
          </a>
          <a
            href={icsUrl}
            download={`${icsName}.ics`}
            onClick={close}
            className="block px-4 py-2.5 text-[0.825rem] text-text-secondary no-underline transition-colors hover:bg-white/[0.04] hover:text-text-primary border-t border-border-subtle"
          >
            Download .ics (Apple / Outlook)
          </a>
        </div>
      )}
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8"  y1="2" x2="8"  y2="6" />
      <line x1="3"  y1="10" x2="21" y2="10" />
    </svg>
  );
}

function slugifyTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "foundry-event";
}
