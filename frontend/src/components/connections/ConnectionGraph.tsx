"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY,
  type SimulationNodeDatum,
} from "d3-force";
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
// ════════════════════════════════════════════════════════════════════

export type ClusterBy = "sector" | "role" | "course" | "gradYear";

export const CLUSTER_OPTIONS: { value: ClusterBy; label: string }[] = [
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
  const listRef = useRef<SVGGElement>(null);

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
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label htmlFor="cluster-by" className="text-[0.75rem] text-text-muted">
          Group by
        </label>
        <select
          id="cluster-by"
          value={by}
          onChange={(e) => setBy(e.target.value as ClusterBy)}
          className="rounded-lg border border-border-strong bg-white/[0.03] px-3 py-1.5 text-[0.8rem] text-text-primary"
        >
          {CLUSTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <p className="text-[0.75rem] text-text-muted">
          {total} {total === 1 ? "connection" : "connections"}
          <span aria-hidden className="mx-1.5">·</span>
          lines are your connections, never theirs to each other
        </p>
      </div>

      {summarising ? (
        <ClusterSummary clusters={clusters} onSelect={onSelect} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-bg-card">
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
            aria-label={`Your network, grouped by ${CLUSTER_OPTIONS.find((o) => o.value === by)!.label.toLowerCase()}. ${peers.length} people. Use the arrow keys to move between them, and Enter to show someone's card, with their email address, in the list.`}
            onKeyDown={onKeyDown}
          >
            {self && peers.map((n) => (
              <line
                key={`edge-${n.id}`}
                x1={self.x} y1={self.y} x2={n.x} y2={n.y}
                stroke="currentColor"
                className="text-border-strong"
                strokeWidth={1}
              />
            ))}

            {self && (
              <g aria-hidden>
                <circle cx={self.x} cy={self.y} r={22} className="fill-accent" />
                <text
                  x={self.x} y={(self.y ?? 0) + 38}
                  textAnchor="middle"
                  className="fill-current text-text-primary"
                  style={{ fontSize: 12, fontWeight: 500 }}
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
                  onFocus={() => setFocused(i)}
                  className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-accent [&:focus-visible>circle]:stroke-[3px]"
                >
                  <circle
                    cx={n.x} cy={n.y} r={14}
                    className="fill-bg-secondary stroke-border-strong"
                    strokeWidth={1.5}
                  />
                  <text
                    x={n.x} y={(n.y ?? 0) + 28}
                    textAnchor="middle"
                    className="fill-current text-text-secondary"
                    style={{ fontSize: 10 }}
                  >
                    {n.label.length > 18 ? `${n.label.slice(0, 17)}…` : n.label}
                  </text>
                </g>
              ))}
            </g>
          </svg>
        </div>
      )}

      <ClusterLegend clusters={clusters} />
    </div>
  );
}

// A key, and it has to look like one.
//
// These used to be `rounded-lg border-border-strong bg-white/[0.02]` pills —
// pixel-identical to the unselected cluster buttons in ClusterSummary
// below, which DO respond to a click. Two things that look the same and
// behave differently is worse than either on its own: it teaches people the
// pills are inert right up until they meet the ones that are not. So the
// legend drops the outline and the surface entirely and becomes labelled
// text with a swatch, which is what it always was.
function ClusterLegend({ clusters }: { clusters: [string, GraphNode[]][] }) {
  if (clusters.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="text-[0.7rem] uppercase tracking-wider text-text-muted">Groups</h3>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
        {clusters.map(([key, members]) => (
          <li
            key={key}
            className="flex items-center gap-1.5 text-[0.75rem] text-text-secondary"
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-border-strong" />
            {key}
            <span className="tnum text-text-muted">{members.length}</span>
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
    <div className="rounded-2xl border border-border bg-bg-card p-5">
      <p className="mb-4 text-[0.8rem] text-text-muted">
        Your network is large enough that individual dots stop being readable, so it is grouped.
        Pick a group to see who is in it.
      </p>
      <div className="flex flex-wrap gap-2">
        {clusters.map(([key, list]) => (
          <button
            key={key}
            type="button"
            aria-pressed={open === key}
            onClick={() => setOpen(key)}
            className={
              "rounded-lg border px-3 py-1.5 text-[0.8rem] transition-colors cursor-pointer " +
              (open === key
                ? "border-accent bg-accent text-bg-primary font-medium"
                : "border-border-strong bg-white/[0.02] text-text-secondary hover:border-accent hover:text-text-primary")
            }
          >
            {key} <span className="tnum">{list.length}</span>
          </button>
        ))}
      </div>

      <ul className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {members.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => onSelect(m.id)}
              className="w-full rounded-lg border border-border-strong bg-white/[0.02] px-3 py-2 text-left text-[0.8rem] text-text-primary transition-colors hover:border-accent"
            >
              {m.firstName} {m.surname}
              {m.course && (
                <span className="block truncate text-[0.7rem] text-text-muted">{m.course}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
