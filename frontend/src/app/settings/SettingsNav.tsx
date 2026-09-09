"use client";

import { useEffect, useState } from "react";

// ════════════════════════════════════════════════════════════════════
// Foundry · Settings section nav
//
// The settings page is a single long column — shortcuts, email,
// password, sessions, delete — and reaching the bottom of it means
// scrolling past four cards you were not looking for. This is the index.
//
// It sits between the app rail and the content column, and only from xl
// up. Below that the rail itself has already collapsed to a drawer and
// the content is near full width, so a second column of links would take
// space from the thing it is meant to help you read.
//
// Scroll position drives the highlight, so the nav always answers "where
// am I" and not just "where could I go".
// ════════════════════════════════════════════════════════════════════

export type SettingsSection = { id: string; label: string };

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "shortcuts", label: "Shortcuts" },
  { id: "email", label: "Email address" },
  { id: "password", label: "Password" },
  { id: "sessions", label: "Active sessions" },
  { id: "danger", label: "Delete account" },
];

export default function SettingsNav() {
  const [active, setActive] = useState<string>(SETTINGS_SECTIONS[0].id);

  useEffect(() => {
    const sections = SETTINGS_SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (sections.length === 0) return;

    // Highest section whose top has passed the trigger line wins. An
    // IntersectionObserver was tried first and reads badly here: the
    // cards differ enough in height that "most visible" flickers between
    // two of them on a slow scroll, and the last section is short enough
    // that it never wins at all at the bottom of the page.
    const TRIGGER_PX = 140;

    const onScroll = () => {
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom) {
        setActive(SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1].id);
        return;
      }
      let current = sections[0].id;
      for (const el of sections) {
        if (el.getBoundingClientRect().top <= TRIGGER_PX) current = el.id;
      }
      setActive(current);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <nav aria-label="Settings sections" className="sticky top-12 w-[184px] shrink-0">
      <p className="label-wide mb-3 pl-3 text-text-muted">On this page</p>
      <ul className="flex flex-col gap-0.5">
        {SETTINGS_SECTIONS.map((s) => {
          const isActive = active === s.id;
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={isActive ? "true" : undefined}
                className={[
                  "block rounded-lg border py-2 pl-3 pr-2 no-underline transition-colors duration-150",
                  isActive
                    ? "border-border-strong bg-white/[0.05] text-text-primary"
                    : "border-transparent text-text-secondary hover:border-border hover:bg-bg-card hover:text-text-primary",
                ].join(" ")}
              >
                {s.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
