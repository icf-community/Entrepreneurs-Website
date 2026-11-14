import { requireAdminPage } from "@/lib/auth/guard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Entry } from "@/components/ui/Entry";
import { PageHead } from "@/components/ui/PageHead";
import { Page } from "@/components/ui/Page";
import { Panel } from "@/components/ui/Panel";
import { Trail } from "@/components/ui/Trail";
import { Icon } from "@/design-system/icons/Icon";
import { Lockup } from "@/design-system/logo/Lockup";
import { Roundel } from "@/design-system/logo/Roundel";
import { OrbitGlyph } from "@/design-system/OrbitGlyph";
import { DataGallery } from "./DataGallery";
import { FormsGallery } from "./FormsGallery";
import { IconsGallery } from "./IconsGallery";
import { OverlaysGallery } from "./OverlaysGallery";

// ════════════════════════════════════════════════════════════════════
// Foundry · /admin/design-system
//
// The living style guide for Lumen, the design system (DESIGN.md at the repo
// root says why; src/design-system/tokens.css is where the values live). It
// renders the real components, so a change to a token or a component shows here
// first. Admin-only like every page under /admin; it reads no data.
// ════════════════════════════════════════════════════════════════════

export const metadata = { title: "Design system" };

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-6 border-t border-border-subtle py-12">
      <div className="grid gap-2">
        <h2 className="font-display text-heading text-text-primary">{title}</h2>
        {note ? <p className="measure-prose text-small text-text-secondary">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Swatch({ cls, name, role }: { cls: string; name: string; role: string }) {
  return (
    <div className="grid gap-2">
      <div className={`h-16 rounded-lg border border-border ${cls}`} />
      <div>
        <p className="text-small text-text-primary">{name}</p>
        <p className="text-caption text-text-muted">{role}</p>
      </div>
    </div>
  );
}

export default async function DesignSystemPage() {
  await requireAdminPage();
  return (
    <Page as="main">
      <PageHead
        context="Admin"
        title="Lumen design system"
        lede="Colour is light direction, not decoration: six lights, one curve, a few gestures that all come from the logo."
      />

      <Section title="The six lights" note="Everything else is a role built from these. Components name a role (bg-bg-card, text-text-muted, border-border-strong), never a hue.">
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
          <Swatch cls="bg-void" name="void" role="the night" />
          <Swatch cls="bg-ink" name="ink" role="what is read" />
          <Swatch cls="bg-star" name="star" role="ring white: the logo" />
          <Swatch cls="bg-sun" name="sun" role="what is lit in words: the action, focus" />
          <Swatch cls="bg-warm" name="warm" role="light itself: glow, selection" />
          <Swatch cls="bg-cool" name="cool" role="dust and hairlines" />
        </div>
      </Section>

      <Section title="Surfaces, ink and lines" note="Four steps of night, three steps of ink (all at least 4.5:1 on every surface, pinned by a test), a rule and a firm edge for anything you can press.">
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
          <Swatch cls="bg-bg-primary" name="bg-primary" role="the page" />
          <Swatch cls="bg-bg-secondary" name="bg-secondary" role="bands, sidebar" />
          <Swatch cls="bg-bg-card" name="bg-card" role="panels" />
          <Swatch cls="bg-bg-card-hover" name="bg-card-hover" role="a panel pointed at" />
          <Swatch cls="bg-bg-raised" name="bg-raised" role="overlays" />
          <Swatch cls="bg-tint-3" name="tint-1…4" role="ink over any surface" />
        </div>
        <div className="grid gap-2 rounded-xl border border-border bg-bg-card p-6">
          <p className="text-body text-text-primary">text-primary: the thing itself</p>
          <p className="text-body text-text-secondary">text-secondary: the line that explains it</p>
          <p className="text-body text-text-muted">text-muted: what you only need sometimes</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <span className="rounded-lg border border-border px-3 py-2 text-small text-text-secondary">border (a rule)</span>
            <span className="rounded-lg border border-border-strong px-3 py-2 text-small text-text-secondary">border-strong (a control&apos;s edge)</span>
            <span className="rounded-lg border border-lit-line bg-lit-muted px-3 py-2 text-small text-accent-light">lit (chosen)</span>
            <span className="rounded-lg border border-danger-line bg-danger-muted px-3 py-2 text-small text-danger">danger</span>
            <span className="rounded-lg border border-success/50 bg-success-muted px-3 py-2 text-small text-success">success</span>
          </div>
        </div>
      </Section>

      <Section title="Type" note="Funnel Display for headings (light, tight), Host Grotesk for everything else, on a 1.25 ratio from a 16 px body. No monospace: measured values use tabular figures (.data).">
        <div className="grid gap-5">
          <p className="font-display text-hero text-text-primary">hero: the landing headline</p>
          <p className="font-display text-display text-text-primary">display: a page&apos;s own h1</p>
          <p className="font-display text-heading text-text-primary">heading: a section</p>
          <p className="font-display text-title text-text-primary">title: a panel or a card</p>
          <p className="text-lead text-text-primary">lead: a lede, an entry title</p>
          <p className="measure-prose text-body text-text-secondary">body: the default size for reading. A grotesque set at sixteen pixels with a line of one and a half, so a paragraph reads without effort and never runs past sixty-two characters.</p>
          <p className="text-small text-text-secondary">small: dense rows, table cells, <span className="data">1,284 members · 12 Nov 2026</span></p>
          <p className="text-caption text-text-muted">caption: meta, helper text, badges</p>
        </div>
      </Section>

      <Section title="Page layout" note="Every page sits in one frame (Page), so its title starts in the same place on each: the gutter at the side, the same space above and below, and a column that starts at the frame's left edge. A page of one column is narrower; it is not centred.">
        <div className="grid gap-3">
          {([["wide", "up to content-max (72rem): lists, dashboards, settings", "var(--content-max)"], ["page", "col-page (820 px): a feed, a detail, a form", "var(--col-page)"], ["narrow", "col-narrow (640 px): a short form", "var(--col-narrow)"]] as const).map(([name, use, width]) => (
            <div key={name} className="rounded-lg border border-border bg-tint-1 px-4 py-3 text-small text-text-secondary" style={{ maxWidth: width }}>
              <span className="text-text-primary">{name}</span> · {use}
            </div>
          ))}
        </div>
        <div className="grid gap-2">
          <p className="text-small text-text-secondary">A page with a parent says so with a Trail: a drawn arrow and the parent&rsquo;s name, then a chevron and its own name.</p>
          <div className="lm-pagehead__context">
            <Trail href="/settings" label="Settings" current="Your profile" />
          </div>
        </div>
      </Section>

      <Section title="Buttons" note="A pill. Cream with the night on it is the strongest control the system makes; one per view. Pointing at it lights a ring; pressing it sinks it a pixel. Buttons and links share the shapes.">
        <div className="grid gap-6">
          <div className="flex flex-wrap items-center gap-5">
            <Button variant="primary" leading={<OrbitGlyph />}>Join Foundry</Button>
            <Button variant="primary" lit leading={<OrbitGlyph />}>Post an opportunity</Button>
            <Button variant="ghost">Your bookmarks</Button>
            <Button variant="quiet">Cancel</Button>
            <Button variant="dangerGhost">Reject</Button>
            <Button variant="danger">Delete account</Button>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
            <Button disabled>Disabled</Button>
            <Button loading>Saving</Button>
            <ButtonLink href="/home" variant="ghost">A link, drawn as a button</ButtonLink>
          </div>
        </div>
      </Section>

      <Section title="Badges and panels" note="A badge says what kind or what state; tone is meaning. A panel is a hairline and a whisper of top light; never nest one in another.">
        <div className="flex flex-wrap items-center gap-3">
          <Badge>Fintech</Badge>
          <Badge tone="lit" dot>Open to members</Badge>
          <Badge tone="info">Imperial student</Badge>
          <Badge tone="success" dot>Verified</Badge>
          <Badge tone="danger" dot>Rejected</Badge>
        </div>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          <Panel className="p-6"><p className="font-display text-title">Default</p><p className="mt-2 text-small text-text-secondary">The panel every card, form block and settings section is.</p></Panel>
          <Panel tone="inset" className="p-6"><p className="font-display text-title">Inset</p><p className="mt-2 text-small text-text-secondary">A recessed field inside a band.</p></Panel>
          <Panel tone="lit" className="p-6"><p className="font-display text-title">Lit</p><p className="mt-2 text-small text-text-secondary">The one thing that matters on the page.</p></Panel>
          <Panel interactive className="p-6"><p className="font-display text-title">Interactive</p><p className="mt-2 text-small text-text-secondary">Lifts a step when pointed at.</p></Panel>
        </div>
      </Section>

      <Section title="Entries" note="One row of a list in a ring: a member, a listing, a notification. With a link the whole row is the target.">
        <Panel className="p-2">
          <ul className="grid">
            <Entry as="li" glyph={<Icon name="members" size={20} />} title="Elena Petrova" meta="Imperial student · Angel investor" href="/members" trailing={<Badge tone="lit" dot>Looking for a co-founder</Badge>} />
            <Entry as="li" lit glyph={<OrbitGlyph />} title="Demo Night" meta="Barclays Eagle Labs, London" trailing={<Badge>Event</Badge>} />
            <Entry as="li" title="A row with no glyph" meta="The ring is optional" />
          </ul>
        </Panel>
      </Section>

      <Section title="The logo" note="One flat colour, never rotated, cropped or crossed. The rocket breaks out of the ring, so keep a quarter of the mark's own height clear around it. Ring at least 45 px; lockup at least 51 px tall.">
        <div className="flex flex-wrap items-end gap-10">
          <Roundel size={45} label="Imperial Entrepreneurs" className="text-star" />
          <Roundel size={72} label="Imperial Entrepreneurs" className="text-star" />
          <Roundel size={120} label="Imperial Entrepreneurs" className="text-star" />
          <Lockup height={51} label="Imperial Entrepreneurs" className="text-star" />
          <Lockup height={72} label="Imperial Entrepreneurs" className="text-star" />
        </div>
        <div className="flex flex-wrap items-end gap-10 rounded-xl bg-star p-6 text-void sm:p-8">
          <Roundel size={72} label="Imperial Entrepreneurs" />
          <Lockup height={64} label="Imperial Entrepreneurs" className="h-auto max-w-full" />
        </div>
      </Section>
      <IconsGallery />
      <FormsGallery />
      <DataGallery />
      <OverlaysGallery />
    </Page>
  );
}
