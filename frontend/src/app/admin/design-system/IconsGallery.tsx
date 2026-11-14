import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { Disc } from "@/design-system/icons/Disc";
import { Glyph } from "@/design-system/icons/Glyph";
import { Icon } from "@/design-system/icons/Icon";
import { DRAWINGS } from "@/design-system/icons/drawings";
import { AUDIENCES, EVENT_TYPES, GLYPH_MIN_SIZE, LISTING_KINDS, SIGNUP_STEPS, STATUS_GLYPHS, type GlyphName } from "@/design-system/icons/glyphs";
import { ICON_NAMES, type IconName } from "@/design-system/icons/names";

// The Icons section of the design-system gallery (/admin/design-system). Two families, one language: the UI icons (24 grid, 1.75 stroke, an
// opening in every outline) and the identity glyphs (48 grid, a ring, a solid figure). Every name in names.ts and glyphs.ts is shown, at the
// sizes it is used at, on the night and on a light plate, so the set can be judged as a whole. A server component: nothing here has state.

// ── Layout of the gallery itself ────────────────────────────────────────────────────────────────────────────────

function Demo({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <div className="grid gap-6">
      <div className="grid gap-1.5">
        <h3 className="font-display text-title text-text-primary">{title}</h3>
        <p className="measure-prose text-small text-text-secondary">{note}</p>
      </div>
      {children}
    </div>
  );
}

function Variant({ caption, children, className = "" }: { caption: string; children: ReactNode; className?: string }) {
  return (
    <div className={`grid min-w-0 content-start gap-3 ${className}`}>
      <p className="text-caption text-text-muted">{caption}</p>
      {children}
    </div>
  );
}

// ── The icon groups ─────────────────────────────────────────────────────────────────────────────────────────────

const GROUPS: { title: string; note: string; names: readonly IconName[] }[] = [
  {
    title: "Destinations",
    note: "Where you can go: one per page of the app, the sidebar's rows and the admin hatch. Each is its own figure, so the rail still reads when it is collapsed to icons.",
    names: ["home", "community", "committee", "members", "foundry-ai", "connections", "messaging", "opportunities", "events", "vcs", "notifications", "calendar", "activity", "submissions", "settings", "profile", "sign-out", "admin"],
  },
  {
    title: "Arrows and chevrons",
    note: "Plain on purpose: a chevron is a chevron. They replace every arrow and triangle that was typed as a character. Disclosures turn a chevron-down, they do not swap for another icon.",
    names: ["arrow-left", "arrow-right", "arrow-up", "arrow-down", "arrow-up-right", "chevron-left", "chevron-right", "chevron-up", "chevron-down", "expand", "collapse"],
  },
  {
    title: "Things you do",
    note: "Verbs: the icon on a button or a menu row. Where a part leaves the figure (a handle, an arrow, a pencil) the outline opens there and the part passes through.",
    names: ["plus", "minus", "close", "check", "search", "filter", "sort", "bookmark", "bookmark-filled", "edit", "trash", "copy", "download", "upload", "share", "external", "link", "mail", "send", "refresh", "more", "menu", "grid", "list", "eye", "eye-off", "lock", "shield", "flag", "ban", "undo", "calendar-plus", "user-plus", "user-check", "sliders"],
  },
  {
    title: "States and marks",
    note: "What happened, or how sure we are: always beside a word, never alone as colour. The last three are the marks of the AI results (met, unknown, related experience).",
    names: ["info", "warning", "error", "success", "ring", "help", "approx"],
  },
  {
    title: "Things",
    note: "Nouns that sit in a line of meta: a place, a person, a link out. GitHub, LinkedIn and Instagram are the companies' own marks, drawn as supplied: the one place the opening rule does not apply.",
    names: ["clock", "pin", "video", "globe", "user", "users", "pound", "pointer", "github", "linkedin", "instagram", "image", "file", "star", "star-filled", "spark", "tag"],
  },
];

const GROUPED = new Set<IconName>(GROUPS.flatMap((g) => g.names));
const UNGROUPED = ICON_NAMES.filter((name) => !GROUPED.has(name));

/** One icon at the four sizes it is drawn for, with its name. */
function IconCell({ name }: { name: IconName }) {
  return (
    <div className="grid content-between gap-3 rounded-lg bg-tint-1 p-3">
      <div className="flex items-end gap-3 text-text-primary">
        {[16, 20, 24, 32].map((size) => (
          <Icon key={size} name={name} size={size} />
        ))}
      </div>
      <p className="text-caption text-text-secondary">{name}</p>
    </div>
  );
}

function IconGroup({ title, note, names }: { title: string; note: string; names: readonly IconName[] }) {
  return (
    <Demo title={title} note={note}>
      <Panel className="p-3 sm:p-4">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(7.4rem,1fr))] gap-2">
          {names.map((name) => (
            <IconCell key={name} name={name} />
          ))}
        </div>
      </Panel>
    </Demo>
  );
}

// ── How an icon is built ────────────────────────────────────────────────────────────────────────────────────────

const GRID_LINES = Array.from({ length: 25 }, (_, i) => `M${i} 0V24M0 ${i}H24`).join("");

/** An icon on its construction grid: a line per unit, the 2-unit margin, and a lit ring round the opening. */
function Construction({ name, opening, radius = 2.7, caption }: { name: IconName; opening: readonly [number, number]; radius?: number; caption: string }) {
  return (
    <figure className="grid min-w-0 content-start gap-3">
      <svg viewBox="0 0 24 24" className="aspect-square w-full max-w-[11rem] text-text-primary" role="img" aria-label={`${name}, drawn on its construction grid, with the opening ringed`}>
        <path d={GRID_LINES} fill="none" stroke="currentColor" strokeWidth="0.04" opacity="0.2" />
        <rect x="2" y="2" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="0.07" opacity="0.45" />
        <g fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          {DRAWINGS[name]}
        </g>
        <circle cx={opening[0]} cy={opening[1]} r={radius} fill="none" strokeWidth="0.22" strokeDasharray="0.55 0.55" className="stroke-lit" />
      </svg>
      <figcaption className="max-w-[26ch] text-caption text-text-muted">{caption}</figcaption>
    </figure>
  );
}

// ── The glyphs ──────────────────────────────────────────────────────────────────────────────────────────────────

const GLYPH_FAMILIES: { title: string; note: string; items: readonly { glyph: GlyphName; name: string; meaning: string }[] }[] = [
  {
    title: "Audiences",
    note: "Who is in Foundry. The two pages of the book, the two beams of the lighthouse, the two leaves of the seedling are the logo's two swept plumes.",
    items: AUDIENCES.map((a) => ({ glyph: a.glyph, name: a.glyph, meaning: a.full })),
  },
  {
    title: "Listing types",
    note: "What a listing is. The briefcase's seam is the slit, the calendar's day is a star, the pound sign is cut out of the coin.",
    items: LISTING_KINDS.map((l) => ({ glyph: l.glyph, name: l.glyph, meaning: l.name })),
  },
  {
    title: "Sign-up steps",
    note: "The three steps of the intake: a pass, three tags with one lit, an eye whose pupil is a star.",
    items: SIGNUP_STEPS.map((s) => ({ glyph: s.glyph, name: s.glyph, meaning: s.name })),
  },
  {
    title: "Event types, status and cue",
    note: "Networking, demo, hackathon and office hours; the verified tick and the scroll cue are drawn as two plume strokes.",
    items: [
      ...EVENT_TYPES.map((e) => ({ glyph: e.glyph, name: e.glyph, meaning: e.name })),
      { glyph: STATUS_GLYPHS.verified, name: STATUS_GLYPHS.verified, meaning: "Verified" },
      { glyph: STATUS_GLYPHS.learnMore, name: STATUS_GLYPHS.learnMore, meaning: "Learn more" },
    ],
  },
];

function GlyphCell({ glyph, name, meaning }: { glyph: GlyphName; name: string; meaning: string }) {
  return (
    <div className="grid content-between gap-3 rounded-lg bg-tint-1 p-3">
      <div className="flex items-end gap-3 text-text-primary">
        <Glyph name={glyph} size={48} />
        <Glyph name={glyph} size={32} />
      </div>
      <div>
        <p className="text-caption text-text-secondary">{name}</p>
        <p className="text-caption text-text-muted">{meaning}</p>
      </div>
    </div>
  );
}

const ALL_GLYPHS: readonly GlyphName[] = [
  ...AUDIENCES.map((a) => a.glyph),
  ...LISTING_KINDS.map((l) => l.glyph),
  ...SIGNUP_STEPS.map((s) => s.glyph),
  ...EVENT_TYPES.map((e) => e.glyph),
  STATUS_GLYPHS.verified,
  STATUS_GLYPHS.learnMore,
];

// ── The gallery ─────────────────────────────────────────────────────────────────────────────────────────────────

const IN_BUTTONS: readonly IconName[] = ["close", "menu", "collapse", "expand", "chevron-left", "chevron-right", "more", "search", "filter", "copy", "bookmark", "share"];
const SHELL_ROWS: readonly { icon: IconName; label: string; lit?: boolean }[] = [
  { icon: "home", label: "Home" },
  { icon: "community", label: "Community", lit: true },
  { icon: "members", label: "Members" },
  { icon: "foundry-ai", label: "Foundry AI" },
  { icon: "connections", label: "Connections" },
  { icon: "events", label: "Events" },
  { icon: "notifications", label: "Notifications" },
  { icon: "settings", label: "Settings" },
];

export function IconsGallery() {
  return (
    <section className="grid gap-6 border-t border-border-subtle py-12">
      <div className="grid gap-2">
        <h2 className="font-display text-heading text-text-primary">Icons and glyphs</h2>
        <p className="measure-prose text-small text-text-secondary">
          Two families in one hand. Icons are functional line drawings on a 24 grid; glyphs are the identity figures on a 48 grid, each inside the roundel&apos;s ring. Both come from the logo: a ring with one opening where
          the rocket breaks out, plumes with slits, four-point sparks as the only ornament. Drawn sizes are 16, 20 and 24 for icons, 28 and up for glyphs.
        </p>
      </div>

      <div className="grid gap-16">
        <Demo
          title="The whole set"
          note={`${ICON_NAMES.length} icons at 24 px, then on a light plate at 20. Judge weight and rhythm here first: the stroke is one width, the openings are one size, and nothing shouts. Point at an icon for its name.`}
        >
          <Panel className="p-4 sm:p-5">
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(2.4rem,1fr))] gap-0.5 text-text-primary">
              {ICON_NAMES.map((name) => (
                <li key={name} title={name} className="grid h-11 place-items-center rounded-lg hover:bg-tint-2">
                  <Icon name={name} size={24} />
                </li>
              ))}
            </ul>
          </Panel>
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-4 rounded-xl bg-star p-5 text-void sm:p-6">
            {ICON_NAMES.map((name) => (
              <li key={name} title={name} className="grid place-items-center">
                <Icon name={name} size={20} />
              </li>
            ))}
          </ul>
        </Demo>

        <Demo
          title="How an icon is built"
          note="A 24 grid with two units of margin, a 1.75 stroke, round caps and joins. Every closed outline has exactly one opening, 3.8 units wide (about 2 of light), so it reads as a choice at 16 px and as the roundel's gap at 64. A ring opens at the upper right, where the light leaves; a box loses its upper-right corner; where something leaves the figure, the outline opens there and it passes through, as the rocket does."
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
            <Construction name="ring" opening={[18.4, 5.6]} caption="A ring that does not close: the roundel's gap, at the upper right." />
            <Construction name="messaging" opening={[19, 5.2]} radius={3} caption="A box loses its upper-right corner." />
            <Construction name="calendar" opening={[16, 5]} radius={3.7} caption="The right binding ring leaves through the opening; the corner stays shut." />
            <Construction name="search" opening={[16.4, 16.4]} caption="The handle leaves through the opening, as the rocket does." />
            <Construction name="home" opening={[12, 20.4]} caption="The door is the gap: light comes out of the house." />
            <Construction name="connections" opening={[12, 12.8]} caption="Lines stop short of every node: the slit between plume and body." />
          </div>
        </Demo>

        {GROUPS.map((group) => (
          <IconGroup key={group.title} {...group} />
        ))}
        {UNGROUPED.length > 0 ? <IconGroup title="Not yet grouped" note="Names in names.ts that this gallery has no group for. Add them above." names={UNGROUPED} /> : null}

        <Demo
          title="Icons in use"
          note="At the sizes the product uses them. Icon buttons are a 44 px ring with a 20 px icon; the sidebar's rows hold an 18 px icon in a 36 px ring; a button's leading icon is 18; a line of meta carries 16. Inside a ring the icon is the text colour of the ring, and lit when the row is the current one."
        >
          <div className="grid gap-10 lg:grid-cols-2">
            <Variant caption="Icon buttons: the ring is the target, the icon is 20.">
              <div className="flex flex-wrap gap-3">
                {IN_BUTTONS.map((name) => (
                  <button key={name} type="button" className="lm-iconbtn" aria-label={name}>
                    <Icon name={name} size={20} />
                  </button>
                ))}
              </div>
            </Variant>
            <Variant caption="Buttons and badges: a leading icon of 18, a trailing arrow of 16, a badge's mark of 14.">
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" leading={<Icon name="plus" size={18} />}>
                  Post an opportunity
                </Button>
                <Button variant="ghost">
                  Open full page
                  <Icon name="arrow-right" size={16} />
                </Button>
                <Button variant="quiet" leading={<Icon name="bookmark" size={18} />}>
                  Your bookmarks
                </Button>
                <Badge tone="success">
                  <Icon name="check" size={14} />
                  Verified
                </Badge>
                <Badge tone="danger">
                  <Icon name="warning" size={14} />
                  Needs a look
                </Badge>
                <Badge tone="info">
                  <Icon name="info" size={14} />
                  Imperial student
                </Badge>
              </div>
            </Variant>
            <Variant caption="The sidebar's rows: an 18 px icon in a 36 px ring; the current one is lit.">
              <Panel className="p-2">
                <ul className="grid gap-1">
                  {SHELL_ROWS.map((row) => (
                    <li key={row.label} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-small text-text-primary">
                      <Disc size="sm" lit={row.lit}>
                        <Icon name={row.icon} size={18} />
                      </Disc>
                      {row.label}
                    </li>
                  ))}
                </ul>
              </Panel>
            </Variant>
            <Variant caption="Meta lines: a 16 px icon in the muted ink, a place, a time, an amount, a link out.">
              <Panel className="grid gap-2.5 p-5 text-small text-text-secondary">
                <p className="flex items-center gap-2.5"><Icon name="pin" size={16} className="text-text-muted" />Imperial College Union, London</p>
                <p className="flex items-center gap-2.5"><Icon name="video" size={16} className="text-text-muted" />Online, link sent on RSVP</p>
                <p className="flex items-center gap-2.5"><Icon name="clock" size={16} className="text-text-muted" />Thursday 14 May, 18:30</p>
                <p className="flex items-center gap-2.5"><Icon name="pound" size={16} className="text-text-muted" />Up to 50k · Pre-seed</p>
                <p className="flex items-center gap-2.5"><Icon name="arrow-up-right" size={16} className="text-text-muted" />RSVP on Luma</p>
                <p className="flex items-center gap-2.5"><Icon name="eye" size={16} className="text-text-muted" />128 views<Icon name="pointer" size={16} className="ml-2 text-text-muted" />14 clicks</p>
              </Panel>
            </Variant>
          </div>
        </Demo>

        <Demo
          title="Glyphs"
          note={`The identity family: a Ø40 ring, a solid mirror-symmetric figure that never touches it, slits of 1.9 between solid parts, sparks as the only ornament. Never drawn below ${GLYPH_MIN_SIZE} px (the slits fall under a pixel), never recoloured in two, never given a second ring. Each is shown at 48 and 32.`}
        >
          <div className="grid gap-10">
            {GLYPH_FAMILIES.map((family) => (
              <Variant key={family.title} caption={`${family.title}. ${family.note}`}>
                <Panel className="p-3 sm:p-4">
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(7.4rem,1fr))] gap-2">
                    {family.items.map((item) => (
                      <GlyphCell key={item.glyph} {...item} />
                    ))}
                  </div>
                </Panel>
              </Variant>
            ))}
          </div>
          <Variant caption="On a light plate: the same drawings in the night, at 48.">
            <ul className="flex flex-wrap items-center gap-x-6 gap-y-5 rounded-xl bg-star p-5 text-void sm:p-6">
              {ALL_GLYPHS.map((name) => (
                <li key={name} title={name} className="grid place-items-center">
                  <Glyph name={name} size={48} />
                </li>
              ))}
            </ul>
          </Variant>
        </Demo>

        <Demo
          title="Disc: a ring for small things"
          note="A glyph carries its own ring, so on its own it needs no Disc. A Disc is the ring for an icon or a figure-only glyph: Entry draws one around its glyph slot. Never put a glyph with its ring inside a Disc; that is two nested borders."
        >
          <div className="grid gap-10 lg:grid-cols-2">
            <Variant caption="Disc sm 36, md 44, lg 56 with icons at 18, 20 and 24; the last is lit.">
              <div className="flex flex-wrap items-center gap-4">
                <Disc size="sm"><Icon name="home" size={18} /></Disc>
                <Disc><Icon name="events" size={20} /></Disc>
                <Disc size="lg"><Icon name="foundry-ai" size={24} /></Disc>
                <Disc lit><Icon name="spark" size={20} /></Disc>
              </div>
            </Variant>
            <Variant caption="The same discs holding figure-only glyphs (ring off): 28 in md, 34 in lg. A glyph on its own keeps its ring.">
              <div className="flex flex-wrap items-center gap-4">
                <Disc><Glyph name="book" size={28} ring={false} /></Disc>
                <Disc><Glyph name="briefcase" size={28} ring={false} /></Disc>
                <Disc size="lg"><Glyph name="lighthouse" size={34} ring={false} /></Disc>
                <Disc size="lg" lit><Glyph name="calendar" size={34} ring={false} /></Disc>
                <span className="mx-1 h-8 w-px bg-border-subtle" aria-hidden />
                <span className="text-text-secondary"><Glyph name="wings" size={56} /></span>
              </div>
            </Variant>
          </div>
        </Demo>
      </div>
    </section>
  );
}
