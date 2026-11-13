"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY,
  type SimulationNodeDatum,
} from "d3-force";
import { Avatar } from "@/components/ui/Avatar";
import { Chip } from "@/components/ui/Chip";
import { Entry } from "@/components/ui/Entry";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { labelCls } from "@/components/forms/styles";
import type { GraphNode } from "@/lib/data/connections";

// ════════════════════════════════════════════════════════════════════
// Foundry · The ego graph
//
// You at the centre, your own connections around you, grouped into
// clusters by a dimension YOU pick. Proximity encodes similarity, and
// moving between clusters is the interaction.
//
// ─── THE FOUR RULES THIS COMPONENT EXISTS TO HOLD ───────────────────
//
// 1. EVERY EDGE IS YOU-TO-NODE. Never node-to-node, even when that edge
//    exists. If you are connected to Priya and to Tom, and Priya and Tom
//    are connected to each other, that edge is not drawn — and it is not
//    in the payload to draw, because list_my_connection_graph returns
//    nodes and no edge list at all. Those two consented to share an
//    address with YOU, not to have their own relationships shown to you.
//    Rendering them would be a separate consent decision.
//
// 2. NO EMAIL ADDRESSES. The payload carries none, deliberately, so the
//    graph can never become an accidental bulk-export endpoint. The
//    address lives on the card view where it is actually used.
//
// 3. d3-force DOES THE MATHS, REACT OWNS THE DOM. d3-force is a pure
//    geometry library that never touches an element. d3-selection
//    mutating nodes React owns is a reconciler conflict; it is not
//    imported here, and should not be.
//
// 4. SVG, NOT CANVAS. At these node counts (tens to low hundreds) SVG is
//    comfortably fast and yields real DOM nodes — focusable,
//    keyboard-navigable, screen-reader-labelable. A canvas graph is
//    opaque to assistive tech. Card view remains the default and the
//    accessible equivalent, which is why this one is allowed to be a
//    picture; but "allowed to be a picture" is not "allowed to be
//    unreachable", hence the roving-tabindex traversal below.
//
// prefers-reduced-motion renders a SETTLED layout: the simulation is run
// to completion synchronously before the first paint, so there is a
// finished picture rather than a visibly running physics engine.
//
// THE LOOK is drawn from the system's tokens, never from a value written
// here. You are the one lit thing: a ring in amber light with a warm core
// behind it. Everyone else is a ring at rest (a firm edge, the panel's own
// fill), joined to you by a hairline. Pointing at a person, or arriving at
// them with the keyboard, lights their ring and the one hairline that joins
// them to you; nothing else changes. Colours are classes, so the whole
// picture follows tokens.css.
// ════════════════════════════════════════════════════════════════════

type ClusterBy = "sector" | "role" | "course" | "gradYear";

const CLUSTER_OPTIONS: { value: ClusterBy; label: string }[] = [
  { value: "sector", label: "Sector" },
  { value: "role", label: "Role" },
  { value: "course", label: "Course" },
  { value: "gradYear", label: "Graduation year" },
];

const ROLE_LABELS: Record<string, string> = {
  student: "Student",
  recent_grad: "Recent grad",
  alum: "Alum",
  mentor: "Mentor",
  angel: "Angel",
  staff_faculty: "Staff / faculty",
};

/** Beyond this the view summarises rather than plots: 400 dots is unreadable however fast it paints. */
const MAX_DOTS = 150;

const W = 900;
const H = 560;

function clusterKey(node: GraphNode, by: ClusterBy): string {
  switch (by) {
    // First sector only. A member in three sectors has to sit somewhere,
    // and drawing them three times would make the counts lie.
    case "sector":   return node.sectors[0] ?? "Unsorted";
    case "role":     return ROLE_LABELS[node.role] ?? node.role;
    case "course":   return node.course ?? "Unsorted";
    case "gradYear": return node.gradYear ? String(node.gradYear) : "Unsorted";
  }
}

type SimNode = SimulationNodeDatum & {
  id: string;
  label: string;
  cluster: string;
  isSelf: boolean;
};

export function ConnectionGraph({
  nodes, total, myName, onSelect,
}: {
  nodes: GraphNode[];
  total: number;
  myName: string;
  onSelect: (id: string) => void;
}) {
  const [by, setBy] = useState<ClusterBy>("sector");
  const [focusedRaw, setFocused] = useState(0);
  // The person being pointed at or focused: their ring and their hairline light.
  const [hot, setHot] = useState<string | null>(null);
  const listRef = useRef<SVGGElement>(null);
  // url(#id) cannot hold the punctuation useId returns.
  const reactId = useId();
  const glowId = `glow-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const clusters = useMemo(() => {
    const map = new Map<string, GraphNode[]>();
    for (const n of nodes) {
      const k = clusterKey(n, by);
      const existing = map.get(k);
      if (existing) existing.push(n); else map.set(k, [n]);
    }
    // Biggest first, so the eye lands on the dominant group and
    // "Unsorted" is never the first thing read.
    return [...map.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [nodes, by]);

  const summarising = nodes.length > MAX_DOTS;

  // ── Layout ────────────────────────────────────────────────────────
  // Run to completion synchronously rather than ticking on rAF. At these
  // counts it takes a few milliseconds, it removes the reduced-motion
  // special case entirely (there is no animation to suppress), and it
  // means React renders one settled picture instead of 300 frames.
  const laid = useMemo(() => {
    if (summarising) return [];

    const clusterAngle = new Map<string, number>();
    clusters.forEach(([key], i) => {
      clusterAngle.set(key, (i / Math.max(1, clusters.length)) * Math.PI * 2);
    });

    const sim: SimNode[] = [
      { id: "__self", label: myName, cluster: "", isSelf: true, fx: W / 2, fy: H / 2 },
      ...nodes.map((n) => {
        const key = clusterKey(n, by);
        const a = clusterAngle.get(key) ?? 0;
        return {
          id: n.id,
          label: `${n.firstName} ${n.surname}`,
          cluster: key,
          isSelf: false,
          // Seeded on their cluster's bearing so the simulation starts
          // near its answer instead of untangling from random noise.
          x: W / 2 + Math.cos(a) * 180,
          y: H / 2 + Math.sin(a) * 180,
        } satisfies SimNode;
      }),
    ];

    const byId = new Map(sim.map((s) => [s.id, s]));
    // Every link is self→node. See rule 1.
    const links = nodes.map((n) => ({ source: byId.get("__self")!, target: byId.get(n.id)! }));

    const simulation = forceSimulation(sim)
      .force("link", forceLink(links).distance(150).strength(0.35))
      .force("charge", forceManyBody().strength(-260))
      .force("center", forceCenter(W / 2, H / 2))
      .force("collide", forceCollide(26))
      // The clustering itself: each node is pulled toward its group's
      // bearing, so proximity encodes shared attribute rather than
      // shared relationship.
      .force("clusterX", forceX<SimNode>((d) =>
        d.isSelf ? W / 2 : W / 2 + Math.cos(clusterAngle.get(d.cluster) ?? 0) * 230).strength(0.35))
      .force("clusterY", forceY<SimNode>((d) =>
        d.isSelf ? H / 2 : H / 2 + Math.sin(clusterAngle.get(d.cluster) ?? 0) * 230).strength(0.35))
      .stop();

    simulation.tick(300);

    // Clamp inside the viewBox: the charge force has no walls, and one
    // node off the edge is worse than one node slightly crowded.
    for (const n of sim) {
      n.x = Math.min(W - 30, Math.max(30, n.x ?? W / 2));
      n.y = Math.min(H - 30, Math.max(30, n.y ?? H / 2));
    }
    return sim;
  }, [nodes, clusters, by, myName, summarising]);

  const peers = useMemo(() => laid.filter((n) => !n.isSelf), [laid]);
  const self = laid.find((n) => n.isSelf);

  // Roving tabindex: the group takes one tab stop, arrows move between
  // people inside it. Forty tab stops to cross a graph is not keyboard
  // support, it is a keyboard trap with extra steps.
  //
  // Clamped during render rather than reset in an effect. Regrouping
  // changes how many nodes there are, and an index left pointing past the
  // end would focus nothing; clamping fixes that in the same pass that
  // causes it, and it keeps the reader's place on a regroup instead of
  // throwing them back to the first person every time they change the
  // grouping.
  const focused = Math.min(focusedRaw, Math.max(0, peers.length - 1));

  function onKeyDown(e: React.KeyboardEvent) {
    if (peers.length === 0) return;
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 :
      e.key === "ArrowLeft"  || e.key === "ArrowUp"   ? -1 : 0;
    if (step !== 0) {
      e.preventDefault();
      setFocused((i) => (i + step + peers.length) % peers.length);
      return;
    }
    if (e.key === "Home")  { e.preventDefault(); setFocused(0); return; }
    if (e.key === "End")   { e.preventDefault(); setFocused(peers.length - 1); return; }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const node = peers[focused];
      if (node) onSelect(node.id);
    }
  }

  // Move the DOM focus to follow the roving index — but ONLY when focus is
  // already inside the graph. This effect also runs on mount, and without
  // the guard it yanked focus out of whatever the reader was actually on
  // (the tab links, the group-by select, the browser's address bar) the
  // instant the graph finished loading. A component that grabs focus
  // because it rendered is a component that interrupts people.
  useEffect(() => {
    const g = listRef.current;
    if (!g || !g.contains(document.activeElement)) return;
    const el = g.querySelector<SVGGElement>(`[data-idx="${focused}"]`);
    el?.focus();
  }, [focused]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <label className="inline-flex items-center gap-3">
          <span className={labelCls}>Group by</span>
          <Select
            id="cluster-by"
            compact
            value={by}
            onChange={(e) => setBy(e.target.value as ClusterBy)}
            className="w-auto min-w-44"
          >
            {CLUSTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </label>
        <p className="text-small text-text-muted">
          <span className="data">{total}</span> {total === 1 ? "connection" : "connections"}
          <span aria-hidden className="mx-1.5">·</span>
          lines are your connections, never theirs to each other
        </p>
      </div>

      {summarising ? (
        <ClusterSummary clusters={clusters} onSelect={onSelect} />
      ) : (
        <Panel className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full min-w-[640px]"
            role="group"
            // "show their card in the list" rather than "open a profile",
            // because that is what Enter does: it swaps this view for the
            // card list filtered to that person. Promising a profile and
            // then replacing the whole view is disorienting for exactly
            // the reader relying on this sentence — and this label is read
            // out every time focus enters the graph, so the correction has
            // to stay short rather than explain itself.
            aria-label={`Your network, grouped by ${(CLUSTER_OPTIONS.find((o) => o.value === by)?.label ?? by).toLowerCase()}. ${peers.length} people. Use the arrow keys to move between them, and Enter to show someone's card, with their email address, in the list.`}
            onKeyDown={onKeyDown}
          >
            {/* The warm core behind you, and two orbits: pure atmosphere, drawn before anything that carries meaning. */}
            <defs>
              <radialGradient id={glowId} cx={W / 2} cy={H / 2} r={300} gradientUnits="userSpaceOnUse">
                <stop offset="0" stopOpacity={0.2} className="[stop-color:var(--color-warm)]" />
                <stop offset="1" stopOpacity={0} className="[stop-color:var(--color-warm)]" />
              </radialGradient>
            </defs>
            <rect aria-hidden width={W} height={H} fill={`url(#${glowId})`} />
            <ellipse aria-hidden cx={W / 2} cy={H / 2} rx={150} ry={150} fill="none" className="stroke-border-subtle" strokeWidth={1} />
            <ellipse aria-hidden cx={W / 2} cy={H / 2} rx={230} ry={230} fill="none" className="stroke-border-subtle" strokeWidth={1} strokeDasharray="2 7" />

            {self && peers.map((n) => (
              <line
                key={`edge-${n.id}`}
                x1={self.x} y1={self.y} x2={n.x} y2={n.y}
                className={`transition-colors duration-150 ${hot === n.id ? "stroke-lit" : "stroke-border"}`}
                strokeWidth={hot === n.id ? 1.75 : 1}
              />
            ))}

            {self && (
              <g aria-hidden>
                <ellipse cx={self.x} cy={self.y} rx={36} ry={36} fill="none" className="stroke-lit-line" strokeWidth={1} />
                <circle
                  cx={self.x} cy={self.y} r={22}
                  className="fill-lit-muted stroke-lit [filter:drop-shadow(0_0_14px_var(--color-lit-glow))]"
                  strokeWidth={2}
                />
                <text
                  x={self.x} y={(self.y ?? 0) + 58}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight={500}
                  className="fill-text-primary stroke-bg-card [paint-order:stroke]"
                  strokeWidth={4}
                  strokeLinejoin="round"
                >
                  You
                </text>
              </g>
            )}

            <g ref={listRef}>
              {peers.map((n, i) => (
                <g
                  key={n.id}
                  data-idx={i}
                  tabIndex={i === focused ? 0 : -1}
                  role="button"
                  aria-label={`${n.label}, ${n.cluster}`}
                  onClick={() => onSelect(n.id)}
                  onFocus={() => { setFocused(i); setHot(n.id); }}
                  onBlur={() => setHot(null)}
                  onPointerEnter={() => setHot(n.id)}
                  onPointerLeave={() => setHot(null)}
                  // The ring on the circle is the focus indicator, so the browser's rectangle round the whole group is switched off.
                  style={{ outline: "none" }}
                  className="group/node cursor-pointer [&:focus-visible>circle]:stroke-accent [&:focus-visible>circle]:stroke-[3px]"
                >
                  <circle
                    cx={n.x} cy={n.y} r={14}
                    className="fill-bg-card stroke-border-strong transition-colors duration-150 group-hover/node:fill-lit-muted group-hover/node:stroke-lit"
                    strokeWidth={1.5}
                  />
                  <text
                    x={n.x} y={(n.y ?? 0) + 30}
                    textAnchor="middle"
                    fontSize={11}
                    className={`stroke-bg-card [paint-order:stroke] transition-colors duration-150 ${hot === n.id ? "fill-text-primary" : "fill-text-secondary"}`}
                    strokeWidth={4}
                    strokeLinejoin="round"
                  >
                    {n.label.length > 18 ? `${n.label.slice(0, 17)}…` : n.label}
                  </text>
                </g>
              ))}
            </g>
          </svg>
        </Panel>
      )}

      <ClusterLegend clusters={clusters} />
    </div>
  );
}

// A key, and it has to look like one.
//
// These used to be `rounded-lg border-border-strong bg-tint-1` pills —
// pixel-identical to the unselected cluster buttons in ClusterSummary
// below, which DO respond to a click. Two things that look the same and
// behave differently is worse than either on its own: it teaches people the
// pills are inert right up until they meet the ones that are not. So the
// legend drops the outline and the surface entirely and becomes labelled
// text with a small ring, which is what it always was.
function ClusterLegend({ clusters }: { clusters: [string, GraphNode[]][] }) {
  if (clusters.length === 0) return null;
  return (
    <div className="mt-6">
      <h3 className="text-small font-medium text-text-secondary">Groups</h3>
      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        {clusters.map(([key, members]) => (
          <li
            key={key}
            className="flex items-center gap-2 text-small text-text-secondary"
          >
            <span aria-hidden className="size-2.5 rounded-full border border-border-strong" />
            {key}
            <span className="data text-text-muted">{members.length}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Above MAX_DOTS the clusters become the interface.
 *
 * Not a fallback for slowness — the simulation would cope. It is that a
 * picture of 400 identical dots communicates nothing, and a list of
 * groups with counts communicates the same structure legibly, from a
 * keyboard, and on a phone.
 */
function ClusterSummary({
  clusters, onSelect,
}: {
  clusters: [string, GraphNode[]][];
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(clusters[0]?.[0] ?? null);
  const members = clusters.find(([k]) => k === open)?.[1] ?? [];

  return (
    <Panel className="p-5 sm:p-6">
      <p className="mb-4 text-body text-text-muted">
        Your network is large enough that individual dots stop being readable, so it is grouped.
        Pick a group to see who is in it.
      </p>
      <div className="flex flex-wrap gap-2">
        {clusters.map(([key, list]) => (
          <Chip key={key} pressed={open === key} onClick={() => setOpen(key)}>
            {key} <span className="tnum">{list.length}</span>
          </Chip>
        ))}
      </div>

      <ul className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {members.map((m) => (
          <Entry
            key={m.id}
            as="li"
            glyph={<Avatar name={`${m.firstName} ${m.surname}`} size="md" />}
            title={
              <button
                type="button"
                onClick={() => onSelect(m.id)}
                className="cursor-pointer text-left text-inherit after:absolute after:inset-0 after:content-['']"
              >
                {m.firstName} {m.surname}
              </button>
            }
            meta={m.course ? <span className="block truncate">{m.course}</span> : undefined}
          />
        ))}
      </ul>
    </Panel>
  );
}
