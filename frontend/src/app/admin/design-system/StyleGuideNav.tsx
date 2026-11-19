"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { SECTIONS } from "./sections";

// ════════════════════════════════════════════════════════════════════
// Foundry · the way around the style guide
//
// The page is twelve sections and some 33,000 px tall, so it needs a way in, a way
// around and a way out. From 1024 px a plain list of the sections stands beside the
// page and stays in view (sticky); on a phone a "Jump to" select floats at the top of
// the window. Both mark the section being read: the one whose top has passed the
// upper part of the window is the current one (aria-current="location": a place in
// this page, not another page).
//
// The sections are found by id (sections.ts), so nothing here is told where they are.
// ════════════════════════════════════════════════════════════════════

/** The id of the section being read: the last one whose top is above a line a third of the way down the window. */
function useCurrentSection(): [string, (id: string) => void] {
  const [current, setCurrent] = useState<string>(SECTIONS[0].id);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.3;
      let id: string = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= line) id = s.id;
      }
      setCurrent(id);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    // once on arrival (a link with #forms in it lands part-way down the page), then as the page moves
    frame = requestAnimationFrame(update);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return [current, setCurrent];
}

export function StyleGuideNav() {
  const [current, setCurrent] = useCurrentSection();

  return (
    <>
      {/* From 1024 px: a plain list beside the page. self-start, so the grid does not stretch it to the page's height (a sticky box that tall has nowhere to move). */}
      <nav aria-label="Sections" className="sticky top-8 hidden max-h-[calc(100dvh-4rem)] self-start overflow-y-auto lg:block">
        <ul className="grid">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={current === s.id ? "location" : undefined}
                className="group flex min-h-8 items-center gap-3 rounded-lg px-2 text-small text-text-secondary transition-colors hover:text-text-primary aria-[current=location]:text-text-primary"
              >
                {/* a point of light beside the section being read, so it is not told by colour alone */}
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-transparent group-aria-[current=location]:bg-warm" />
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* On a phone: one select, floating at the top of the window. */}
      <Panel size="sm" className="sticky top-3 z-30 mb-6 p-2 lg:hidden">
        <label className="flex items-center gap-3">
          <span className="shrink-0 pl-2 text-small text-text-secondary">Jump to</span>
          <Select
            compact
            value={current}
            onChange={(e) => {
              setCurrent(e.target.value);
              window.location.hash = e.target.value;
            }}
            className="min-w-0 flex-1"
          >
            {SECTIONS.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </Select>
        </label>
      </Panel>
    </>
  );
}
