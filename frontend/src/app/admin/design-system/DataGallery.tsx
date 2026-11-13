"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Avatar, AvatarStack } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Collapse, Disclosure } from "@/components/ui/Disclosure";
import { Definition, DefinitionList } from "@/components/ui/DefinitionList";
import { Divider } from "@/components/ui/Divider";
import { Entry } from "@/components/ui/Entry";
import { LinkTabs } from "@/components/ui/LinkTabs";
import { Meter } from "@/components/ui/Meter";
import { Pager } from "@/components/ui/Pager";
import { Panel } from "@/components/ui/Panel";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Section } from "@/components/ui/Section";
import { Stat, StatGrid } from "@/components/ui/Stat";
import { StepDots } from "@/components/ui/StepDots";
import { Tab, TabCount, TabList, TabPanel, Tabs, ButtonTabs } from "@/components/ui/Tabs";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { Icon } from "@/design-system/icons/Icon";
import type { UrlFilters } from "@/lib/filters/useUrlFilters";

// The Data section of the design-system gallery (/admin/design-system). Owned by the data family: every component of the family in every
// state, with content that looks like the product's, and a line on when to use each. A client component because the demos keep state
// (tabs that switch, a pager that pages, a card that opens); the primitives themselves are mostly server-safe.

// ── Sample content ────────────────────────────────────────────────────────────────────────────────────────────

// Stand-in photographs, drawn here because the CSP allows no third-party images: a person's head and shoulders, lit from above, in white at
// different strengths so that whatever the ring sits on shows through (an image carries no design tokens, so it names no hue).
const portrait = (hair: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'><defs><radialGradient id='lit' cx='50%' cy='26%' r='72%'><stop offset='0' stop-color='white' stop-opacity='0.34'/><stop offset='1' stop-color='white' stop-opacity='0.04'/></radialGradient></defs><rect width='96' height='96' fill='url(#lit)'/>${hair}<circle cx='48' cy='40' r='16' fill='white' fill-opacity='0.82'/><path d='M12 96c2-23 17-33 36-33s34 10 36 33z' fill='white' fill-opacity='0.58'/></svg>`,
  )}`;
const SHORT = "<path d='M31 39c-1-13 7-21 17-21s18 8 17 21c-4-7-9-10-17-10s-13 3-17 10z' fill='white' fill-opacity='0.95'/>";
const LONG = "<path d='M27 46c-3-19 6-30 21-30s24 11 21 30c0 11-2 19-5 27-1-13-6-23-16-23s-15 10-16 23c-3-8-5-16-5-27z' fill='white' fill-opacity='0.72'/>";
const BUN = "<circle cx='48' cy='19' r='8' fill='white' fill-opacity='0.9'/><path d='M32 40c-1-12 6-19 16-19s17 7 16 19c-4-6-9-8-16-8s-12 2-16 8z' fill='white' fill-opacity='0.9'/>";
const PHOTOS = { elena: portrait(LONG), tom: portrait(SHORT), amara: portrait(BUN), jonas: portrait("") };

type SampleMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: "Approved" | "Awaiting review" | "Rejected";
  course: string;
  year: number;
  committee: string | null;
};

const MEMBERS: readonly SampleMember[] = [
  { id: "m1", name: "Elena Petrova", email: "elena.petrova@imperial.ac.uk", role: "Student", status: "Approved", course: "MEng Computing", year: 2027, committee: "President" },
  { id: "m2", name: "Tom Ward", email: "tom.ward@imperial.ac.uk", role: "Student", status: "Awaiting review", course: "MSc Management", year: 2026, committee: null },
  { id: "m3", name: "Amara Okafor", email: "a.okafor@alumni.imperial.ac.uk", role: "Alum", status: "Approved", course: "BEng Chemical Engineering", year: 2019, committee: "Mentor lead" },
  { id: "m4", name: "Jonas Lindqvist", email: "jonas.lindqvist@imperial.ac.uk", role: "Student", status: "Rejected", course: "MSc Finance", year: 2026, committee: null },
  { id: "m5", name: "Priya Raman", email: "priya.raman@imperial.ac.uk", role: "Student", status: "Approved", course: "MEng Bioengineering", year: 2028, committee: null },
  { id: "m6", name: "Daniel Foster", email: "d.foster@alumni.imperial.ac.uk", role: "Mentor", status: "Approved", course: "MBA", year: 2017, committee: "Events" },
];

const STATUS_TONE = { Approved: "success", "Awaiting review": "lit", Rejected: "danger" } as const;

const SENDERS = [
  { id: "s1", name: "Marcus Hale", signals: 4, sent: 61, declined: 37, throttled: true },
  { id: "s2", name: "Sofia Alvarez", signals: 2, sent: 38, declined: 21, throttled: false },
  { id: "s3", name: "Wei Zhang", signals: 1, sent: 129, declined: 88, throttled: false },
  { id: "s4", name: "Hannah Brooks", signals: 3, sent: 44, declined: 19, throttled: true },
] as const;

const LOG = [
  ["09:42", "Suhaan Mobhani", "Approved profile", "Elena Petrova"],
  ["09:40", "Suhaan Mobhani", "Rejected listing", "Growth intern, Acme"],
  ["09:31", "Priya Raman", "Resolved report", "Post by Tom Ward"],
  ["09:12", "Suhaan Mobhani", "Lifted throttle", "Hannah Brooks"],
  ["08:57", "Priya Raman", "Approved event", "Demo Night"],
  ["08:44", "Suhaan Mobhani", "Approved profile", "Priya Raman"],
  ["08:21", "Priya Raman", "Turned off AI", "Master switch"],
  ["08:20", "Priya Raman", "Turned on AI", "Master switch"],
] as const;

const WEEKS = [
  ["Week 44", 312, 184, 41, 9, 6],
  ["Week 45", 340, 201, 52, 11, 8],
  ["Week 46", 366, 233, 47, 8, 7],
  ["Week 47", 401, 262, 64, 14, 12],
] as const;

// A stand-in for the URL-driven filters the real pages hand to Pager: it only needs to say what changed.
function pagerUrl(apply: (patch: Record<string, string | string[] | null>) => void, pending = false): UrlFilters {
  return {
    get: () => "",
    getOne: (_key, _allowed, fallback) => fallback,
    getList: () => [],
    getSet: () => new Set<string>(),
    apply,
    toggle: () => {},
    clear: () => {},
    pending,
  };
}

// ── Layout of the gallery itself ───────────────────────────────────────────────────────────────────────────────

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

// ── Tabs ──────────────────────────────────────────────────────────────────────────────────────────────────────

const REPORT_TABS = [
  { value: "open", label: "Open" },
  { value: "actioned", label: "Actioned" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
] as const;

const ACTIVITY_TABS = [
  { value: "all", label: <>All <TabCount>· 12</TabCount></> },
  { value: "opportunity", label: <>Applied — opportunities <TabCount>· 5</TabCount></> },
  { value: "event", label: <>Going — events <TabCount>· 4</TabCount></> },
  { value: "vc_grant", label: <>Applied — VCs &amp; grants <TabCount>· 3</TabCount></> },
] as const;

const LINK_TABS = [
  { value: "all", href: "#data-tabs", label: "All posts" },
  { value: "mine", href: "#data-tabs", label: "My posts" },
  { value: "saved", href: "#data-tabs", label: "Saved" },
] as const;

function TabsDemo() {
  const [status, setStatus] = useState<(typeof REPORT_TABS)[number]["value"]>("open");
  const [pending, setPending] = useState(false);
  const [activity, setActivity] = useState<(typeof ACTIVITY_TABS)[number]["value"]>("all");
  const [view, setView] = useState<"month" | "list">("month");
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [cards, setCards] = useState<"cards" | "graph">("cards");
  const [ai, setAi] = useState("network");

  return (
    <div className="grid gap-12">
      <div id="data-tabs" className="grid gap-10 lg:grid-cols-2">
        <Variant caption="LinkTabs · real links in a nav, aria-current=page, the URL is the state. Server-rendered; the caller says which is current.">
          <LinkTabs label="Community views" items={LINK_TABS} value="all" />
        </Variant>
        <Variant caption="ButtonTabs, semantics=current · buttons in a nav, aria-current=page. A place you are: report status, connections tab.">
          <ButtonTabs
            label="Report status"
            semantics="current"
            items={REPORT_TABS}
            value={status}
            disabled={pending}
            onSelect={(next) => {
              setStatus(next);
              setPending(true);
              window.setTimeout(() => setPending(false), 700);
            }}
          />
          <p className="text-caption text-text-muted">Choosing one disables the strip for a moment, as a navigation in flight does; the current tab keeps its light.</p>
        </Variant>
        <Variant caption="ButtonTabs, semantics=pressed · buttons with aria-pressed. A filter of the page you are on; counts stay in the name, and the strip wraps when it must.">
          <ButtonTabs label="Show" items={ACTIVITY_TABS} value={activity} onSelect={setActivity} />
        </Variant>
        <Variant caption="Tabs, TabList, Tab, TabPanel · a true ARIA tablist. Tab reaches the selected tab; arrow keys move between tabs; Home and End jump; Enter or Space selects.">
          <Tabs value={ai} onValueChange={setAi}>
            <TabList label="Search mode">
              <Tab value="recruiter">Find candidates</Tab>
              <Tab value="network">Build your network</Tab>
              <Tab value="opportunities">Find opportunities</Tab>
            </TabList>
            <TabPanel value="recruiter" className="pt-4 text-small text-text-secondary">Describe the person you are hiring for; the search looks for evidence in members&apos; profiles.</TabPanel>
            <TabPanel value="network" className="pt-4 text-small text-text-secondary">Say who you would like to meet; the search ranks the members who match, with the evidence beside each.</TabPanel>
            <TabPanel value="opportunities" className="pt-4 text-small text-text-secondary">Say what you are looking for; the search reads the open listings against your profile.</TabPanel>
          </Tabs>
        </Variant>
      </div>

      <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
        <Variant caption="Segmented · a two-way toggle (aria-pressed).">
          <div>
            <ButtonTabs
              variant="segmented"
              label="Calendar view"
              items={[{ value: "month", label: "Month" }, { value: "list", label: "List" }]}
              value={view}
              onSelect={setView}
            />
          </div>
        </Variant>
        <Variant caption="Segmented, filling the width (the sign-in toggle).">
          <ButtonTabs
            variant="segmented"
            fill
            label="Sign up or log in"
            items={[{ value: "signup", label: "Sign up" }, { value: "signin", label: "Log in" }]}
            value={mode}
            onSelect={setMode}
          />
        </Variant>
        <Variant caption="Small, with one item disabled.">
          <div>
            <ButtonTabs
              variant="segmented"
              size="sm"
              label="Connections view"
              items={[{ value: "cards", label: "Cards" }, { value: "graph", label: "Network", disabled: true }]}
              value={cards}
              onSelect={setCards}
            />
          </div>
        </Variant>
      </div>
    </div>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────────────────────────────────────────────

function AvatarDemo() {
  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <Variant caption="Initials in the display face, xs to xl. One letter at the smallest size.">
        <div className="flex flex-wrap items-end gap-5">
          <Avatar name="Elena Petrova" size="xs" />
          <Avatar name="Elena Petrova" size="sm" />
          <Avatar name="Elena Petrova" size="md" />
          <Avatar name="Elena Petrova" size="lg" />
          <Avatar name="Elena Petrova" size="xl" />
        </div>
      </Variant>
      <Variant caption="A photograph (stand-ins drawn in this file), the same sizes. The alt text is empty because the name is written beside it.">
        <div className="flex flex-wrap items-end gap-5">
          <Avatar src={PHOTOS.elena} name="Elena Petrova" size="xs" />
          <Avatar src={PHOTOS.tom} name="Tom Ward" size="sm" />
          <Avatar src={PHOTOS.amara} name="Amara Okafor" size="md" />
          <Avatar src={PHOTOS.jonas} name="Jonas Lindqvist" size="lg" />
          <Avatar src={PHOTOS.elena} name="Elena Petrova" size="xl" />
        </div>
      </Variant>
      <Variant caption="Lit ring: the current or chosen person. Tone lit: a small marker of who posted.">
        <div className="flex flex-wrap items-center gap-5">
          <Avatar src={PHOTOS.amara} name="Amara Okafor" size="lg" lit />
          <Avatar name="Tom Ward" size="lg" lit />
          <Avatar name="Elena Petrova" size="xs" tone="lit" />
          <Avatar name="Daniel Foster" size="sm" tone="lit" />
        </div>
      </Variant>
      <Variant caption="A photo that fails to load (a signed URL that expired) hands over to the initials.">
        <div className="flex flex-wrap items-center gap-5">
          <Avatar src="/avatar-that-is-not-there.jpg" name="Priya Raman" size="lg" />
          <Avatar src={null} name="Daniel Foster" size="lg" />
          <Avatar name="" size="lg" />
        </div>
      </Variant>
      <Variant caption="AvatarStack: overlapping faces and a count. The names are in the DOM as hidden text.">
        <div className="flex flex-wrap items-center gap-8">
          <AvatarStack
            size="sm"
            max={3}
            people={[
              { name: "Elena Petrova", src: PHOTOS.elena },
              { name: "Tom Ward", src: PHOTOS.tom },
              { name: "Amara Okafor" },
              { name: "Jonas Lindqvist", src: PHOTOS.jonas },
              { name: "Priya Raman" },
            ]}
          />
          <AvatarStack
            size="md"
            people={[
              { name: "Elena Petrova", src: PHOTOS.elena },
              { name: "Amara Okafor", src: PHOTOS.amara },
              { name: "Daniel Foster" },
            ]}
          />
        </div>
      </Variant>
      <Variant caption="In an Entry, the glyph's own ring is the avatar's ring; no second one is drawn inside it.">
        <Panel className="p-2">
          <ul className="grid">
            <Entry
              as="li"
              glyph={<Avatar src={PHOTOS.amara} name="Amara Okafor" />}
              title="Amara Okafor"
              meta="Alum · Chemical Engineering, 2019"
              trailing={<Badge tone="lit" dot>Mentor</Badge>}
            />
            <Entry as="li" lit glyph={<Avatar name="Tom Ward" />} title="Tom Ward" meta="MSc Management, 2026" />
          </ul>
        </Panel>
      </Variant>
    </div>
  );
}

// ── Stat ──────────────────────────────────────────────────────────────────────────────────────────────────────

function StatDemo() {
  return (
    <div className="grid gap-10">
      <Variant caption="Three counters, one with a ring against 100.">
        <StatGrid>
          <Stat label="Total connections" value="1,284" hint="Accepted, both directions counted once" />
          <Stat label="Median per member" value="4" hint="Members with none are included" />
          <Stat label="Cross-cohort" value="38%" hint="Connections between different graduation years" meter={{ value: 38 }} />
        </StatGrid>
      </Variant>
      <Variant caption="Fifteen small tiles in one ruled sheet. A ring or a bar draws a figure against its limit; the figures stay in the text. Danger when it has crossed it.">
        <StatGrid min="sm">
          <Stat size="sm" label="Matching spend today" value="$1.84 of $5.00" meter={{ value: 1.84, max: 5 }} />
          <Stat size="sm" label="Ingestion spend today" value="$0.42 of $2.00" meter={{ value: 0.42, max: 2 }} />
          <Stat size="sm" label="Unreconciled calls" value="2" tone="danger" />
          <Stat size="sm" label="Provider requests" value="6 of 20" meter={{ value: 6, max: 20, kind: "bar" }} />
          <Stat size="sm" label="Queue wait (24h)" value="p50 412ms · p95 1,860ms" />
          <Stat size="sm" label="Status polls (24h)" value="1,206" />
          <Stat size="sm" label="Reserved / uncertain cost" value="$0.31" />
          <Stat size="sm" label="Settled cost today" value="$2.27" tone="lit" />
          <Stat size="sm" label="Projected daily cost (current pace)" value="$4.96" meter={{ value: 4.96, max: 5, tone: "danger", kind: "bar" }} />
          <Stat size="sm" label="Queue" value="3 waiting · 1 running" />
          <Stat size="sm" label="Oldest waiting" value="7s" />
          <Stat size="sm" label="Result time (24h)" value="p50 9s · p95 31s" />
          <Stat size="sm" label="Opted in: recruiters" value="14" />
          <Stat size="sm" label="Opted in: network" value="212" />
          <Stat size="sm" label="Jobs needing an audience" value="0" />
        </StatGrid>
      </Variant>
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────────────────────────────────────

function TableDemo() {
  return (
    <div className="grid gap-12">
      <Variant caption="The members table: primary cell, a badge, numeric year, a chosen row (aria-selected, an amber edge), actions. Hover a row.">
        <Table label="Members" caption="Members, their status and committee role">
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Email</TH>
              <TH>Role</TH>
              <TH>Status</TH>
              <TH>Course</TH>
              <TH numeric>Year</TH>
              <TH>Committee</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {MEMBERS.map((m) => (
              <TR key={m.id} selected={m.id === "m3"}>
                <TD label="Name" primary>{m.name}</TD>
                <TD label="Email">{m.email}</TD>
                <TD label="Role">{m.role}</TD>
                <TD label="Status"><Badge tone={STATUS_TONE[m.status]} dot>{m.status}</Badge></TD>
                <TD label="Course">{m.course}</TD>
                <TD label="Year" numeric>{m.year}</TD>
                <TD label="Committee">{m.committee ?? "—"}</TD>
                <TD actions>
                  <Button variant="ghost" size="sm">{m.committee ? "Edit committee" : "Add to committee"}</Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Variant>

      <div className="grid gap-10 lg:grid-cols-2">
        <Variant caption="Compact density with numeric columns and a conditional action.">
          <Table label="Senders worth a look" density="compact">
            <THead>
              <TR>
                <TH>Member</TH>
                <TH numeric>Signals</TH>
                <TH numeric>Sent</TH>
                <TH numeric>Declined</TH>
                <TH numeric>Rate</TH>
                <TH><span className="sr-only">Actions</span></TH>
              </TR>
            </THead>
            <TBody>
              {SENDERS.map((s) => (
                <TR key={s.id}>
                  <TD label="Member" primary>
                    {s.name} {s.throttled ? <Badge tone="danger">Throttled</Badge> : null}
                  </TD>
                  <TD label="Signals" numeric>{s.signals}</TD>
                  <TD label="Requests sent" numeric>{s.sent}</TD>
                  <TD label="Declined" numeric>{s.declined}</TD>
                  <TD label="Decline rate" numeric>{Math.round((s.declined / s.sent) * 100)}%</TD>
                  <TD actions>{s.throttled ? <Button variant="ghost" size="sm">Lift throttle</Button> : null}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Variant>

        <Variant caption="The same markup in a narrow column: below 640 px of its own width every row stacks into a card, the header row steps aside, each cell prints its label. Same DOM.">
          <div className="max-w-sm">
            <Table label="Senders worth a look, stacked" density="compact">
              <THead>
                <TR>
                  <TH>Member</TH>
                  <TH numeric>Signals</TH>
                  <TH numeric>Sent</TH>
                  <TH numeric>Declined</TH>
                  <TH><span className="sr-only">Actions</span></TH>
                </TR>
              </THead>
              <TBody>
                {SENDERS.slice(0, 2).map((s) => (
                  <TR key={s.id} selected={s.throttled}>
                    <TD label="Member" primary>{s.name}</TD>
                    <TD label="Signals" numeric>{s.signals}</TD>
                    <TD label="Requests sent" numeric>{s.sent}</TD>
                    <TD label="Declined" numeric>{s.declined}</TD>
                    <TD actions>{s.throttled ? <Button variant="ghost" size="sm">Lift throttle</Button> : null}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </Variant>
      </div>

      <div className="grid gap-10 lg:grid-cols-2">
        <Variant caption="A long table in a region with a maxHeight: the header stays in view and the region scrolls, focusable by keyboard.">
          <Table label="Admin log" caption="Recent admin actions" maxHeight="15rem" density="compact">
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Admin</TH>
                <TH>Action</TH>
                <TH>Target</TH>
              </TR>
            </THead>
            <TBody>
              {LOG.map(([when, who, what, target]) => (
                <TR key={`${when}-${who}-${what}-${target}`}>
                  <TD label="When" nowrap>{when}</TD>
                  <TD label="Admin">{who}</TD>
                  <TD label="Action">{what}</TD>
                  <TD label="Target">{target}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Variant>

        <Variant caption='narrow="scroll": a dense numeric table that keeps its columns at every width and pans sideways inside a focusable, named region.'>
          <Table label="Weekly activity" narrow="scroll" minWidth="34rem" density="compact">
            <THead>
              <TR>
                <TH>Week</TH>
                <TH numeric>Requests</TH>
                <TH numeric>Accepted</TH>
                <TH numeric>Declined</TH>
                <TH numeric>Blocked</TH>
                <TH numeric>Reports</TH>
              </TR>
            </THead>
            <TBody>
              {WEEKS.map(([week, requests, accepted, declined, blocked, reports]) => (
                <TR key={week}>
                  <TD primary>{week}</TD>
                  <TD numeric>{requests}</TD>
                  <TD numeric>{accepted}</TD>
                  <TD numeric>{declined}</TD>
                  <TD numeric>{blocked}</TD>
                  <TD numeric>{reports}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Variant>
      </div>
    </div>
  );
}

// ── Disclosure, Collapse, DefinitionList ─────────────────────────────────────────────────────────────────────

function ListingDetails({ lead }: { lead: string }) {
  return (
    <div className="grid gap-5 pt-4">
      <p className="measure-prose text-body text-text-secondary">{lead}</p>
      <DefinitionList>
        <Definition term="Pay">£2,400 a month</Definition>
        <Definition term="Apply by">12 Nov 2026</Definition>
        <Definition term="Starts">June 2027</Definition>
        <Definition term="Location">London, hybrid</Definition>
        <Definition term="Posted by">Amara Okafor</Definition>
        <Definition term="Who can apply">Students and graduates</Definition>
        <Definition term="Empty facts fall away">{""}</Definition>
      </DefinitionList>
      <div className="flex flex-wrap items-center gap-3">
        <ButtonLink href="#data-disclosure" variant="primary" size="sm">Open application portal</ButtonLink>
        <ButtonLink href="#data-disclosure" variant="ghost" size="sm">
          Open full page
          <Icon name="arrow-right" size={18} />
        </ButtonLink>
      </div>
    </div>
  );
}

function DisclosureDemo() {
  const [why, setWhy] = useState(false);
  return (
    <div id="data-disclosure" className="grid gap-12">
      <div className="grid gap-6 lg:grid-cols-2">
        <Variant caption="Disclosure: the header is one button (aria-expanded, aria-controls) holding the whole summary; the chevron turns, the panel opens by the grid-rows trick. Details stay in the DOM.">
          <Disclosure
            id="o-demo"
            summary={
              <>
                <span className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                  <span className="font-display text-lead text-text-primary">Product Engineering Intern</span>
                  <span className="text-small text-accent-light">£2,400 a month</span>
                </span>
                <span className="mt-1 block text-small text-text-secondary">Monzo · London · Starts June 2027</span>
                <span className="mt-3 flex flex-wrap gap-1.5">
                  <Badge tone="lit">Fintech</Badge>
                  <Badge>TypeScript</Badge>
                  <Badge>Product</Badge>
                </span>
              </>
            }
            closedLabel="Show details"
            openLabel="Hide details"
            trailing={<>· Apply by 12 Nov 2026</>}
            accessory={
              <button type="button" className="lm-iconbtn" aria-pressed="false" aria-label="Bookmark Product Engineering Intern">
                <Icon name="bookmark" size={18} />
              </button>
            }
          >
            <ListingDetails lead="Work with the growth squad on the onboarding flow: ship experiments weekly, read the numbers with a data scientist, and help decide what the product does next." />
          </Disclosure>
        </Variant>

        <Variant caption="lazy: the details are mounted only while the card is open (and while it closes), for a card whose spec asserts the description is not on the page until it is opened. Opens already (defaultOpen).">
          <Disclosure
            id="e-demo"
            lazy
            defaultOpen
            size="sm"
            summary={
              <>
                <span className="text-caption text-accent-light">19:00 <span className="text-text-muted">· Thu 20 Nov</span></span>
                <span className="mt-1.5 block font-display text-lead text-text-primary">Demo Night</span>
                <span className="mt-1 block text-small text-text-secondary">By Imperial Entrepreneurs · Barclays Eagle Labs, London</span>
              </>
            }
            closedLabel="Show details"
            openLabel="Hide details"
          >
            <div className="grid gap-4 pt-4">
              <p className="measure-prose text-body text-text-secondary">Six teams, five minutes each, then questions from the room and a vote for the one you would back.</p>
              <div className="flex flex-wrap items-center gap-3">
                <ButtonLink href="#data-disclosure" variant="primary" size="sm">RSVP on Luma</ButtonLink>
              </div>
            </div>
          </Disclosure>
        </Variant>
      </div>

      <div className="grid gap-10 lg:grid-cols-2">
        <Variant caption="Collapse alone, for a separate button that is not the whole header. The button keeps aria-expanded and aria-controls.">
          <Panel className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-display text-lead text-text-primary">Priya Raman</p>
              <Button variant="ghost" size="sm" aria-expanded={why} aria-controls="why-demo" onClick={() => setWhy((v) => !v)}>
                {why ? "Hide evidence" : "Why this match"}
              </Button>
            </div>
            <Collapse id="why-demo" open={why}>
              <ul className="grid gap-2 pt-4 text-small text-text-secondary">
                <li>Built a payments prototype in Rust for the Imperial Hack, 2026.</li>
                <li>Skills list names Rust, TypeScript and Postgres.</li>
                <li>Bio says: “looking for a co-founder who can sell.”</li>
              </ul>
            </Collapse>
          </Panel>
        </Variant>

        <div className="grid gap-8">
          <Variant caption="DefinitionList, grid layout: pairs reflow to the room; an empty definition renders nothing.">
            <DefinitionList>
              <Definition term="Kind">Grant</Definition>
              <Definition term="Deadline">30 Jan 2027</Definition>
              <Definition term="Amount">Up to £25,000</Definition>
              <Definition term="Stage">Pre-seed</Definition>
            </DefinitionList>
          </Variant>
          <Variant caption="Inline layout, a ruled list for dialogs.">
            <DefinitionList
              layout="inline"
              items={[
                { term: "Event", definition: "Demo Night" },
                { term: "Starts", definition: "Thu 20 Nov, 19:00" },
                { term: "Where", definition: "Barclays Eagle Labs, London" },
                { term: "Organiser", definition: "Imperial Entrepreneurs" },
              ]}
            />
          </Variant>
        </div>
      </div>
    </div>
  );
}

// ── Pager ─────────────────────────────────────────────────────────────────────────────────────────────────────

function PagerDemo() {
  const [page, setPage] = useState(6);
  const set = (patch: Record<string, string | string[] | null>) => setPage(Number(patch.page));
  const url = pagerUrl(set);
  return (
    <div className="grid gap-4">
      <Variant caption="Live: 12 pages. Both buttons are the ghost Button; the current number is lit; the gauge shows where you are.">
        <Pager url={url} page={page} total={600} pageSize={50} label="Demo pages" />
      </Variant>
      <div className="grid gap-4 xl:grid-cols-3">
        <Variant caption="First page: Previous is disabled.">
          <Pager url={pagerUrl(() => {})} page={1} total={600} pageSize={50} label="First page" />
        </Variant>
        <Variant caption="Last page: Next is disabled.">
          <Pager url={pagerUrl(() => {})} page={12} total={600} pageSize={50} label="Last page" />
        </Variant>
        <Variant caption="A navigation in flight: both disabled.">
          <Pager url={pagerUrl(() => {}, true)} page={3} total={600} pageSize={50} label="Pending page" />
        </Variant>
      </div>
    </div>
  );
}

// ── Progress ──────────────────────────────────────────────────────────────────────────────────────────────────

const INTAKE_GROUPS = [
  {
    label: "Who you are",
    steps: [
      { id: "face", label: "Face & bio", num: "01" },
      { id: "youre-in", label: "You're in", num: "—" },
    ],
  },
  {
    label: "Unlock your matches",
    steps: [
      { id: "cv", label: "CV", num: "02" },
      { id: "github", label: "GitHub", num: "03" },
      { id: "skills", label: "Skills", num: "04" },
    ],
  },
] as const;

function ProgressDemo() {
  const [step, setStep] = useState("cv");
  const all: string[] = INTAKE_GROUPS.flatMap((g) => g.steps.map((s) => s.id));
  const done = all.slice(0, all.indexOf(step));
  const [flow, setFlow] = useState("education");
  return (
    <div className="grid gap-12">
      <div className="grid gap-10 lg:grid-cols-2">
        <Variant caption="ProgressBar, inline: the intake's completeness line. The bar is role=progressbar with a name and a value; the words beside it say the same.">
          <ProgressBar layout="inline" value={62} label="Profile completeness" end="62% profile complete" />
        </Variant>
        <Variant caption="Stacked, with words under it: the onboarding's step bar.">
          <ProgressBar value={1} max={2} label="Step 1 of 2" valueText="Step 1 of 2" start="1 / 2" end="50%" />
        </Variant>
        <Variant caption="md size, success tone: a flow that has finished.">
          <ProgressBar size="md" tone="success" value={100} label="Upload" start="cv.pdf" end="Uploaded" />
        </Variant>
        <Variant caption="Indeterminate: no value, a short light travels (still, under reduced motion).">
          <ProgressBar label="Reading your CV" start="Reading your CV" />
        </Variant>
      </div>

      <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
        <Variant caption="Meter, ring: sm, md, lg, with the figure inside.">
          <div className="flex flex-wrap items-center gap-5">
            <Meter size="sm" value={72} label="Match score" valueText="7.2 out of 10" max={100} />
            <Meter value={72} label="Match score" valueText="7.2 out of 10">7.2</Meter>
            <Meter size="lg" value={72} label="Match score" valueText="7.2 out of 10">7.2</Meter>
          </div>
        </Variant>
        <Variant caption="Tone is meaning: lit, success, danger, info.">
          <div className="flex flex-wrap items-center gap-5">
            <Meter value={45} label="Lit" />
            <Meter value={90} label="Success" tone="success" />
            <Meter value={100} label="Danger" tone="danger" />
            <Meter value={30} label="Info" tone="info" />
          </div>
        </Variant>
        <Variant caption="Meter, bar: a spend against its cap.">
          <div className="grid gap-5">
            <Meter variant="bar" value={1.84} max={5} label="Matching spend today" valueText="$1.84 of $5.00">$1.84 of $5.00</Meter>
            <Meter variant="bar" tone="danger" value={5} max={5} label="Ingestion spend today" valueText="$5.00 of $5.00">$5.00 of $5.00</Meter>
          </div>
        </Variant>
        <Variant caption="Empty and full are still a ring.">
          <div className="flex flex-wrap items-center gap-5">
            <Meter value={0} label="Empty">0</Meter>
            <Meter value={100} label="Full" tone="success">10</Meter>
          </div>
        </Variant>
      </div>

      <div className="grid gap-10 lg:grid-cols-2">
        <Variant caption="StepDots, horizontal: the current step is a lit ring, done steps are lit, the rest are hollow. Press one to jump.">
          <div className="grid gap-4">
            <StepDots
              label="Onboarding steps"
              current={flow}
              onSelect={setFlow}
              steps={[
                { id: "education", label: "Education" },
                { id: "links", label: "Links" },
                { id: "review", label: "Review" },
                { id: "done", label: "Done" },
              ]}
            />
            <p className="text-caption text-text-muted">Selected: {flow}. The labels are in the DOM as hidden text.</p>
            <StepDots
              label="Sign-up steps"
              current="profile"
              showLabels
              steps={[
                { id: "account", label: "Account" },
                { id: "profile", label: "Profile" },
                { id: "review", label: "Review" },
              ]}
            />
            <p className="text-caption text-text-muted">With showLabels, and no onSelect: plain text.</p>
          </div>
        </Variant>
        <Variant caption="StepDots, vertical, in groups: the intake rail. Every step but the current is a button; done is passed across the groups.">
          <nav aria-label="Intake progress" className="grid gap-6">
            {INTAKE_GROUPS.map((group) => (
              <div key={group.label} className="grid gap-2">
                <p className="label-wide text-text-secondary">{group.label}</p>
                <StepDots
                  label={group.label}
                  orientation="vertical"
                  steps={group.steps}
                  current={step}
                  done={done}
                  onSelect={setStep}
                />
              </div>
            ))}
          </nav>
        </Variant>
      </div>
    </div>
  );
}

// ── Divider and Section ──────────────────────────────────────────────────────────────────────────────────────

function StructureDemo() {
  return (
    <div className="grid gap-12">
      <div className="grid gap-10 lg:grid-cols-2">
        <Variant caption="Divider: the hairline with a lit end, the masthead's device. End, start, none.">
          <div className="grid gap-7 py-2">
            <Divider />
            <Divider end="start" />
            <Divider end="none" />
          </div>
        </Variant>
        <Variant caption="Vertical, between items in a row.">
          <div className="flex items-center gap-5 text-small text-text-secondary">
            <span>Opportunities</span>
            <Divider vertical />
            <span>Events</span>
            <Divider vertical />
            <span>Grants &amp; VCs</span>
          </div>
        </Variant>
      </div>

      <Variant caption="Section: a labelled landmark with a title row in the display face, a line under it and actions at the right. Sections stack on one rhythm, .lm-sections, --section-gap.">
        <div className="lm-sections mt-4">
          <Section
            rule
            title="Reported connections"
            description="Reports about a connection, newest first. Opening a member's note is recorded against your account."
            actions={<Button variant="ghost" size="sm">Export CSV</Button>}
          >
            <DefinitionList layout="inline" items={[{ term: "Open", definition: "3 reports" }, { term: "Actioned this week", definition: "7" }]} />
          </Section>
          <Section rule level={3} title="Senders worth a look" description="Throttled is automatic; the decline rate drives nothing and never will.">
            <p className="text-small text-text-muted">A level 3 section is regular weight at the lead size, for a section inside a section.</p>
          </Section>
        </div>
      </Variant>
    </div>
  );
}

// ── The section ───────────────────────────────────────────────────────────────────────────────────────────────

export function DataGallery() {
  return (
    <section className="grid gap-6 border-t border-border-subtle py-12">
      <div className="grid gap-2">
        <h2 className="font-display text-heading text-text-primary">Data display and structure</h2>
        <p className="measure-prose text-small text-text-secondary">
          Tabs, avatars, counters, tables, disclosures, definition lists, pagers, progress and dividers: one family, drawn with two devices from the logo, the hairline with a lit end and the ring. State is read off ARIA, so a site keeps its own semantics and takes the look.
        </p>
      </div>
      <div className="grid gap-16">
        <Demo title="Tabs" note="Use tabs to switch between views of one thing; pick the markup by what the control is (links, toggle buttons, or a true tablist), the look is the same.">
          <TabsDemo />
        </Demo>
        <Demo title="Avatar" note="Use an avatar wherever a person appears next to their name: a photo or their initials in a ring, lit when they are the chosen one.">
          <AvatarDemo />
        </Demo>
        <Demo title="Stat and StatGrid" note="Use a stat for a labelled number on an admin page; a ring or bar only where there is a limit to draw it against.">
          <StatDemo />
        </Demo>
        <Demo title="Table" note="Use a table for rows that share columns; it stacks into cards on a narrow screen with the same markup, and its scroll region is reachable by keyboard.">
          <TableDemo />
        </Demo>
        <Demo title="Disclosure, Collapse and DefinitionList" note="Use a disclosure for a card with more behind it, and a definition list for the facts that sit in it.">
          <DisclosureDemo />
        </Demo>
        <Demo title="Pager" note="Use the pager under any list the server pages with ?page=; it keeps its landmark, its button names and its sentence.">
          <PagerDemo />
        </Demo>
        <Demo title="ProgressBar, Meter and StepDots" note="Use a progress bar for getting something done, a meter for where a quantity stands, and step dots for where you are in a flow.">
          <ProgressDemo />
        </Demo>
        <Demo title="Divider and Section" note="Use a divider where two things need more than space between them, and a section for each part of a long page.">
          <StructureDemo />
        </Demo>
      </div>
    </section>
  );
}
