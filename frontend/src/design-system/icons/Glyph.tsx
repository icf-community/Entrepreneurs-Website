import { useId, type CSSProperties, type ReactNode } from "react";
import { GLYPH_MIN_SIZE, type GlyphName } from "./glyphs";

// ════════════════════════════════════════════════════════════════════
// Foundry · Glyph (Lumen)
//
// The identity family: who someone is (six audiences), what a listing is (opportunity, event, funding), the three sign-up steps, the four
// event types, the verified tick and the scroll cue. Made in Phase 1 and approved; the drawings below are the kit's (design/phase-2/kit/icons.js),
// character for character, only written as JSX. They follow the roundel's grammar, measured in Phase 0:
//
//   · a 48 grid, a ring of Ø40 stroked at 2.3 (the logo's ring is 5.76 % of its diameter)
//   · a SOLID, mirror-symmetric figure inside it, never touching the ring and never filling it
//   · slits of 1.9 units between solid parts (the logo's plume slit, doubled so it survives at 28 px)
//   · four-point sparks as the only ornament
//   · one colour, currentColor: the page picks it, a glyph never carries two
//
// RULES OF USE (the kit's, kept)
//   · Minimum size 28 px (enforced here): below it the slits drop under a pixel. If a glyph stops being legible the fix is a bigger glyph.
//   · Restyle by colour and size only: do not redraw, outline, fill the ring, add a second ring, rotate or stretch.
//   · Meaning lives in the drawing and in `title` (or in the words beside it); visible text is never required.
//   · A glyph carries its own ring. Inside a Disc (the .lm-disc ring Entry draws) use `ring={false}`: two rings is two nested borders.
//
// The names and the mappings (AUDIENCES, LISTING_KINDS, EVENT_TYPES, SIGNUP_STEPS, with the kit's labels verbatim) are in ./glyphs.ts.
//
// Pure and server-safe (the landing page is static): no state, no effects. The one exception in spirit is the coin, whose pound sign is cut
// out of the disc with a mask; its id comes from useId, which is deterministic and allowed in server components, so a page can hold any number
// of coins without two masks sharing an id.
// ════════════════════════════════════════════════════════════════════

const r3 = (v: number) => String(Math.round(v * 1000) / 1000);

/** The kit's four-point spark, as a closed path centred (cx, cy) with tips r away. */
function spark(cx: number, cy: number, r: number): string {
  const k = r * 0.28;
  const [a, b] = [k * 0.3, k];
  return (
    `M${r3(cx)} ${r3(cy - r)}C${r3(cx + a)} ${r3(cy - b)} ${r3(cx + b)} ${r3(cy - a)} ${r3(cx + r)} ${r3(cy)}` +
    `C${r3(cx + b)} ${r3(cy + a)} ${r3(cx + a)} ${r3(cy + b)} ${r3(cx)} ${r3(cy + r)}` +
    `C${r3(cx - a)} ${r3(cy + b)} ${r3(cx - b)} ${r3(cy + a)} ${r3(cx - r)} ${r3(cy)}` +
    `C${r3(cx - b)} ${r3(cy - a)} ${r3(cx - a)} ${r3(cy - b)} ${r3(cx)} ${r3(cy - r)}Z`
  );
}

/** A figure and its mirror image across the vertical axis: the two swept plumes. */
function Mirror({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <g transform="translate(48 0) scale(-1 1)">{children}</g>
    </>
  );
}

const STROKE = { fill: "none", stroke: "currentColor", strokeLinecap: "round" } as const;
const STROKE_ROUND = { ...STROKE, strokeLinejoin: "round" } as const;

/** The pound coin: a disc with the sign cut out of it (a mask), so the page behind shows through the sign. */
function CoinFigure() {
  const id = useId();
  return (
    <>
      <mask id={id}>
        <rect width="48" height="48" fill="white" />
        <g fill="none" stroke="black" strokeWidth="2.3" strokeLinejoin="round">
          <path d="M28.4 19.8C27.6 18.4 26 17.5 24.3 17.5 22 17.5 20.5 19.1 20.5 21.5V27.4C20.5 29.2 19.7 30.4 18.1 31.3" strokeLinecap="round" />
          <path d="M17.6 31.2H29.6" strokeLinecap="round" />
          <path d="M17.6 24.6H26.2" strokeLinecap="round" />
        </g>
      </mask>
      <circle cx="24" cy="24" r="12.8" mask={`url(#${id})`} />
    </>
  );
}

const PINS = [19.6, 24, 28.4]
  .map((c) => `M${r3(c - 1.1)} 10.7h2.2v3.4h-2.2ZM${r3(c - 1.1)} 33.9h2.2v3.4h-2.2ZM10.7 ${r3(c - 1.1)}h3.4v2.2h-3.4ZM33.9 ${r3(c - 1.1)}h3.4v2.2h-3.4Z`)
  .join("");

/** Figures only (no ring): the kit's FIGURES, in the order of GLYPH_NAMES. */
const FIGURES: Record<GlyphName, ReactNode> = {
  // students: an open book, the two pages are the two swept plumes, a spark above the spine
  book: (
    <>
      <Mirror>
        <path d="M23 34.2C19.8 31.2 15.4 29.8 11.5 30.4V17.6C15.5 17 20 18.2 23 21.2Z" />
      </Mirror>
      <path d={spark(24, 12, 3.4)} />
    </>
  ),

  // recent grads: a mortarboard, a slit between the board and the cap
  cap: (
    <>
      <path d="M24 13.6 38.4 20.7 24 27.8 9.6 20.7Z" />
      <path d="M16.1 26 24 29.9 31.9 26V31C31.9 33 28.3 34.6 24 34.6 19.7 34.6 16.1 33 16.1 31Z" />
      <path d="M36 22.2V28.4" {...STROKE} strokeWidth="1.9" />
      <circle cx="36" cy="30.3" r="1.7" />
    </>
  ),

  // alumni founders: a seedling, two leaves are the two plumes
  sprout: (
    <>
      <Mirror>
        <path d="M22.9 28.6C16.4 29.2 11.6 25.2 11 18.4 17.8 17.8 22.5 22 22.9 28.6Z" />
      </Mirror>
      <rect x="22.8" y="22.6" width="2.4" height="13.4" rx="1.2" />
      <path d="M13.2 37.4H34.8" {...STROKE} strokeWidth="2.3" />
    </>
  ),

  // mentors: a lighthouse, the two beams are the two swept plumes
  lighthouse: (
    <>
      <path d="M24 9.4 27.7 13.5H20.3Z" />
      <path d="M21.7 15.4H26.3V19.4H21.7Z" />
      <path d="M21.5 21.3H26.5L26.9 24.9H21.1Z" />
      <path d="M20.9 26.8H27.1L27.6 31H20.4Z" />
      <path d="M20.2 32.9H27.8L28.4 36.6H19.6Z" />
      <Mirror>
        <path d="M20.9 17.4C17.6 16.6 14.4 15.2 11.4 13.4 12.2 16.2 12.2 18.6 11.4 21.4 14.4 19.8 17.6 18.4 20.9 17.4Z" />
      </Mirror>
    </>
  ),

  // angels: three feathers a side (the plume fan, turned into wings) under a halo
  wings: (
    <g transform="translate(0 2.4)">
      <Mirror>
        <path d="M22.2 20.6C18.6 18.4 14.4 17 9.8 16.6 11.6 19.8 15.6 22.6 22.2 23.8Z" />
        <path d="M22.2 25.7C19 23.9 15.2 23 11.4 22.8 13.2 25.4 16.8 27.4 22.2 28.2Z" />
        <path d="M22.2 30.1C19.8 28.9 17.2 28.4 14.6 28.6 16.6 30.4 19 31.3 22.2 31.6Z" />
      </Mirror>
      <ellipse cx="24" cy="11.8" rx="5" ry="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </g>
  ),

  // staff and faculty: a lab flask (research), the liquid line is the slit, a spark is the bubble
  flask: (
    <>
      <path d="M21.2 11.4H26.8V19.8L31.14 26H16.86L21.2 19.8Z" />
      <path fillRule="evenodd" d={`M15.53 27.9H32.47L35.2 31.8A2.8 2.8 0 0 1 32.8 35.4H15.2A2.8 2.8 0 0 1 12.8 31.8Z${spark(24, 31.7, 2.7)}`} />
    </>
  ),

  // opportunities: a briefcase, the seam is the slit, the latch is the only join
  briefcase: (
    <>
      <path d="M19.6 18.4V16.4A2.2 2.2 0 0 1 21.8 14.2H26.2A2.2 2.2 0 0 1 28.4 16.4V18.4" {...STROKE} strokeWidth="2" />
      <path d="M15 20.4H33A2.6 2.6 0 0 1 35.6 23V26.8H12.4V23A2.6 2.6 0 0 1 15 20.4Z" />
      <path d="M12.4 28.7H35.6V32.6A2.6 2.6 0 0 1 33 35.2H15A2.6 2.6 0 0 1 12.4 32.6Z" />
      <path d="M22.2 25.6H25.8V30.2H22.2Z" />
    </>
  ),

  // events: a calendar page, the day is a star
  calendar: (
    <>
      <path d="M15.4 15.8H32.6A3.2 3.2 0 0 1 35.8 19V21.4H12.2V19A3.2 3.2 0 0 1 15.4 15.8Z" />
      <path fillRule="evenodd" d={`M12.2 23.4H35.8V32.2A3.2 3.2 0 0 1 32.6 35.4H15.4A3.2 3.2 0 0 1 12.2 32.2Z${spark(24, 29.4, 3.7)}`} />
      <path d="M18.4 11.6V16.8M29.6 11.6V16.8" {...STROKE} strokeWidth="2" />
    </>
  ),

  // funding: a pound coin (the sign is cut out of the disc with a mask)
  coin: <CoinFigure />,

  // sign-up step 1, identity: a pass with a portrait and two lines
  badge: (
    <path
      fillRule="evenodd"
      d="M13.8 14.8H34.2A2.8 2.8 0 0 1 37 17.6V30.4A2.8 2.8 0 0 1 34.2 33.2H13.8A2.8 2.8 0 0 1 11 30.4V17.6A2.8 2.8 0 0 1 13.8 14.8ZM19 19.2A3 3 0 1 0 19.01 19.2ZM13.8 29.2C13.8 25.8 15.9 24.4 19 24.4 22.1 24.4 24.2 25.8 24.2 29.2ZM27.2 19H33V20.9H27.2ZM27.2 23.6H33V25.5H27.2Z"
    />
  ),

  // sign-up step 2, your work: three tags of different lengths, one lit
  chips: (
    <>
      <path fillRule="evenodd" d={`M13 14.6H29A2.8 2.8 0 0 1 29 20.2H13A2.8 2.8 0 0 1 13 14.6Z${spark(17.4, 17.4, 2.2)}`} />
      <rect x="13" y="22.1" width="22" height="5.6" rx="2.8" />
      <rect x="13" y="29.6" width="14" height="5.6" rx="2.8" />
    </>
  ),

  // sign-up step 3, visibility: an eye whose pupil is a star
  eye: (
    <>
      <path fillRule="evenodd" d="M8.4 24C12 17.4 17.4 14 24 14 30.6 14 36 17.4 39.6 24 36 30.6 30.6 34 24 34 17.4 34 12 30.6 8.4 24ZM24 17.6A6.4 6.4 0 1 0 24.01 17.6Z" />
      <path d={spark(24, 24, 3.6)} />
    </>
  ),

  // verified: a tick, drawn as two plume strokes
  tick: <path d="M15.6 24.6 21.6 30.6 32.6 18" {...STROKE_ROUND} strokeWidth="3" />,

  // events · networking: three people as three nodes, the lines stop 1.9 short of every node (the slit)
  network: (
    <>
      <circle cx="24" cy="15.6" r="3.7" />
      <circle cx="14.8" cy="31.4" r="3.7" />
      <circle cx="33.2" cy="31.4" r="3.7" />
      <path d="M21.18 20.44 17.62 26.56M26.82 20.44 30.38 26.56M20.4 31.4H27.6" {...STROKE} strokeWidth="2" />
    </>
  ),

  // events · demo night: a lamp, its beam, a stage; a star lit in the beam
  stage: (
    <>
      <path d="M19.4 9.2H28.6A1.4 1.4 0 0 1 30 10.6V12.5H18V10.6A1.4 1.4 0 0 1 19.4 9.2Z" />
      <path fillRule="evenodd" d={`M21 14.4H27L36.4 29.4H11.6Z${spark(24, 23.6, 3.4)}`} />
      <rect x="10" y="31.3" width="28" height="3.8" rx="1.9" />
    </>
  ),

  // events · hackathon: a chip, six pins a side apart from the die by the slit, a star on the die
  chip: (
    <>
      <path
        fillRule="evenodd"
        d={`M18.4 16H29.6A2.4 2.4 0 0 1 32 18.4V29.6A2.4 2.4 0 0 1 29.6 32H18.4A2.4 2.4 0 0 1 16 29.6V18.4A2.4 2.4 0 0 1 18.4 16Z${spark(24, 24, 4.4)}`}
      />
      <path d={PINS} />
    </>
  ),

  // events · office hours: two speech bubbles facing each other, a spark in each (one-on-one)
  talk: (
    <Mirror>
      <path
        fillRule="evenodd"
        d={`M13 14.6H19.4A3.6 3.6 0 0 1 23 18.2V22.8A3.6 3.6 0 0 1 19.4 26.4L20.6 31.6 15.4 26.4H13A3.6 3.6 0 0 1 9.4 22.8V18.2A3.6 3.6 0 0 1 13 14.6Z${spark(16.2, 20.5, 2.7)}`}
      />
    </Mirror>
  ),

  // scroll cue ("Learn more"): an arrow drawn as the tick is, two plume strokes
  down: <path d="M24 14.4V32.4M16.2 25 24 32.8 31.8 25" {...STROKE_ROUND} strokeWidth="3" />,
};

/**
 * One identity glyph. `size` is the width of the whole 48 grid in px (28 or more: smaller is raised to 28). `ring` draws the Ø40 ring (the
 * default); turn it off only when the glyph sits inside a Disc, which is the ring. Without `title` the glyph is decorative (aria-hidden): use
 * that when words beside it name it; give it a `title` when it is the only name.
 */
export function Glyph({
  name,
  size = 48,
  ring = true,
  title,
  className,
  style,
}: {
  name: GlyphName;
  size?: number;
  ring?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const px = Math.max(size, GLYPH_MIN_SIZE);
  return (
    <svg
      data-glyph={name}
      className={className}
      style={style}
      width={px}
      height={px}
      viewBox="0 0 48 48"
      fill="currentColor"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {ring ? <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="2.3" /> : null}
      {FIGURES[name]}
    </svg>
  );
}
