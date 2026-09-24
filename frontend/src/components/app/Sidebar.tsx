"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import SignOutButton from "@/app/admin/SignOutButton";
import { BrandLogo } from "@/components/BrandLogo";
import { PendingBadge } from "@/components/connections/PendingBadge";

// ════════════════════════════════════════════════════════════════════
// Foundry · App sidebar
//
// Replaces the horizontal AppNav for member-facing pages. The nav had
// seven top-level items competing for one row, which is why four of them
// were only reachable behind a hamburger on anything narrower than a
// desktop. A rail gives every destination the same weight and leaves the
// content column its full measure.
//
// The prototype shows seven items. It omits five routes that exist and
// work — Grants & VCs, Calendar, My activity, My submissions, Settings —
// so those are kept, in a secondary group. Dropping working features to
// match a mock is not a redesign, it is a regression.
//
// Collapsed state lives in localStorage: it is a per-viewer convenience,
// not shared state, and a wrong guess costs one click.
// ════════════════════════════════════════════════════════════════════

// Collapsed state is per-viewer and lives in localStorage. Reading it with
// useState + useEffect would either break hydration (the server has no
// localStorage) or cascade a second render on every mount, which is what
// the react-hooks lint rule objects to. useSyncExternalStore exists for
// exactly this shape: a server snapshot, a client snapshot, and a
// subscription for changes.
const NAV_KEY = "foundry.nav.collapsed";
let navListeners: (() => void)[] = [];

function subscribeNav(cb: () => void) {
  navListeners.push(cb);
  return () => {
    navListeners = navListeners.filter((l) => l !== cb);
  };
}

function navSnapshot(): boolean {
  try {
    return localStorage.getItem(NAV_KEY) === "1";
  } catch {
    // Private mode, or a browser set to block site data. Expanded is the
    // safe default — every destination stays labelled.
    return false;
  }
}

function setNavCollapsed(next: boolean) {
  try {
    localStorage.setItem(NAV_KEY, next ? "1" : "0");
  } catch {
    // The toggle still works for this render; it just will not persist.
  }
  for (const l of navListeners) l();
}

export type NavKey =
  | "home"
  | "community"
  | "members"
  | "foundryAi"
  | "connections"
  | "messaging"
  | "opportunities"
  | "events"
  | "vcs"
  | "committee"
  | "calendar"
  | "activity"
  | "submissions"
  | "settings";

type Item = { key: NavKey; href: string; label: string; icon: React.ReactNode };

const I = {
  home: (
    <path d="M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-4v-4H8v4H4a1 1 0 0 1-1-1V9.5Z" />
  ),
  community: (
    <>
      <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h8" />
    </>
  ),
  members: (
    <>
      <circle cx="7.5" cy="7" r="2.5" />
      <circle cx="13.5" cy="8.5" r="2" />
      <path d="M3 16c0-2.2 2-3.5 4.5-3.5S12 13.8 12 16M12.5 16c0-1.6.9-2.7 2.5-2.7s2.5 1.1 2.5 2.7" />
    </>
  ),
  messaging: (
    <path d="M4 4.5h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H8.5L5 17v-3.5H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z" />
  ),
  foundryAi: (
    <>
      <path d="M10 3c.6 3 1.4 4.4 4.4 5-3 .6-3.8 2-4.4 5-.6-3-1.4-4.4-4.4-5 3-.6 3.8-2 4.4-5Z" />
      <path d="M16 13c.25 1 .6 1.35 1.6 1.6-1 .25-1.35.6-1.6 1.6-.25-1-.6-1.35-1.6-1.6 1-.25 1.35-.6 1.6-1.6Z" />
    </>
  ),
  connections: (
    <>
      <circle cx="5" cy="6" r="1.8" />
      <circle cx="15" cy="6" r="1.8" />
      <circle cx="10" cy="15" r="1.8" />
      <path d="M6.5 7.3 8.7 13M13.5 7.3 11.3 13M6.8 6h6.4" />
    </>
  ),
  committee: (
    <path d="M10 3.5l1.6 3.3 3.6.5-2.6 2.5.6 3.6L10 11.7l-3.2 1.7.6-3.6-2.6-2.5 3.6-.5L10 3.5Z" />
  ),
  opportunities: (
    <>
      <rect x="3" y="6.5" width="14" height="9.5" rx="1.5" />
      <path d="M7.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 12.5 5v1.5" />
    </>
  ),
  events: (
    <>
      <rect x="3" y="4.5" width="14" height="12" rx="1.5" />
      <path d="M3 8h14M7 3v3M13 3v3" />
    </>
  ),
  vcs: <path d="M4 15V9M8 15V5M12 15v-4M16 15V7" />,
  calendar: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.5 1.5" />
    </>
  ),
  activity: <path d="M3 11h3l2.5-5 3 9L14 11h3" />,
  submissions: (
    <>
      <path d="M5 3.5h6L15 7v9.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z" />
      <path d="M10.5 3.5V7H15" />
    </>
  ),
  settings: (
    <>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 3v2M10 15v2M3 10h2M15 10h2M5.2 5.2l1.4 1.4M13.4 13.4l1.4 1.4M14.8 5.2l-1.4 1.4M6.6 13.4l-1.4 1.4" />
    </>
  ),
};

function Icon({ d }: { d: React.ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      {d}
    </svg>
  );
}

// /members is the directory; /community is the post feed the name was
// being held for. They are different things and both are top-level.
//
// "My posts" is deliberately NOT here. It lives as a tab on /community
// itself (/community/mine). This rail is already at seven primary rows
// plus four secondary, which is past the point where every destination
// reads at a glance — and a twelfth entry that only matters to members
// who have posted is worse information architecture than putting the
// control where the posts already are.
const PRIMARY: Item[] = [
  { key: "home", href: "/home", label: "Home", icon: <Icon d={I.home} /> },
  { key: "community", href: "/community", label: "Community", icon: <Icon d={I.community} /> },
  { key: "committee", href: "/committee", label: "Meet the Committee", icon: <Icon d={I.committee} /> },
  { key: "members", href: "/members", label: "Members", icon: <Icon d={I.members} /> },
  { key: "foundryAi", href: "/foundry-ai", label: "Foundry AI", icon: <Icon d={I.foundryAi} /> },
  { key: "connections", href: "/connections", label: "Connections", icon: <Icon d={I.connections} /> },
  { key: "messaging", href: "/messaging", label: "Messaging", icon: <Icon d={I.messaging} /> },
  { key: "opportunities", href: "/opportunities", label: "Opportunities", icon: <Icon d={I.opportunities} /> },
  { key: "events", href: "/events", label: "Events", icon: <Icon d={I.events} /> },
  { key: "vcs", href: "/vcs", label: "Grants & VCs", icon: <Icon d={I.vcs} /> },
];

// Members still in review get no PRIMARY rows, because every one of them is
// a dead end for them. AppNav handled that with a single "Return to home"
// item pointing at /pending, and dropping it left /settings with no way back
// out except the logo. This restores it. /pending self-guards with
// redirectAwayFrom, so a rejected member following it lands on /rejected.
const IN_REVIEW: Item[] = [
  { key: "home", href: "/pending", label: "Return to home", icon: <Icon d={I.home} /> },
];

const SECONDARY: Item[] = [
  { key: "calendar", href: "/calendar", label: "Calendar", icon: <Icon d={I.calendar} /> },
  { key: "activity", href: "/my-activity", label: "My activity", icon: <Icon d={I.activity} /> },
  { key: "submissions", href: "/my-submissions", label: "My submissions", icon: <Icon d={I.submissions} /> },
  { key: "settings", href: "/settings", label: "Settings", icon: <Icon d={I.settings} /> },
];

export default function Sidebar({
  active,
  name,
  isApproved = true,
  isAdmin = false,
  onNavigate,
}: {
  active: NavKey;
  /** A member still in review can reach /settings, /contact and /profile but
   *  nothing else. Showing them the full rail would be a list of dead ends —
   *  AppNav collapsed to a single item for exactly this reason. */
  isApproved?: boolean;
  /** Adds the escape hatch back to /admin, as the old AppNav did. */
  isAdmin?: boolean;
  /** Omitted on pages that don't already load the profile — the chip still
   *  links to /profile, it just doesn't greet you by name. */
  name?: string;
  /** Called after any nav click — used to close the mobile drawer. */
  onNavigate?: () => void;
}) {
  const collapsed = useSyncExternalStore(subscribeNav, navSnapshot, () => false);
  const toggle = () => setNavCollapsed(!collapsed);

  // Admins keep the full rail regardless of their own status, so they can
  // walk the member-facing UI for diagnostics. Same rule AppNav applied.
  const full = isApproved || isAdmin;
  const primary = full ? PRIMARY : IN_REVIEW;
  const secondary = full ? SECONDARY : SECONDARY.filter((i) => i.key === "settings");

  const row = (it: Item) => {
    const on = it.key === active;
    return (
      <li key={it.key}>
        <Link
          href={it.href}
          onClick={onNavigate}
          aria-current={on ? "page" : undefined}
          title={collapsed ? it.label : undefined}
          className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-[0.825rem] no-underline transition-colors duration-150 ${
            on
              ? "border-border-strong bg-white/[0.08] font-medium text-text-primary"
              : "border-transparent text-text-secondary hover:border-border hover:bg-white/[0.04] hover:text-text-primary"
          }`}
        >
          {it.icon}
          {!collapsed && <span className="truncate">{it.label}</span>}
          {/* Only the Connections row carries a count, and only when
              there is one. It fails to nothing — see PendingBadge. The
              collapsed rail drops it: a bare number beside an unlabelled
              icon says nothing, and the row is 4.5rem wide. */}
          {it.key === "connections" && !collapsed && full && <PendingBadge />}
        </Link>
      </li>
    );
  };

  return (
    <div
      className={`flex h-full flex-col border-r border-border-subtle bg-bg-secondary transition-[width] duration-200 ${
        collapsed ? "w-[4.5rem]" : "w-[15rem]"
      }`}
    >
      {/* showWordmark={false}: the lockup asset is ~5:1, so at h-6 it is
          already ~119px. With the "FOUNDRY" wordmark and the collapse button
          beside it the header came to ~272px inside a 240px rail, and the
          button rendered on top of the mark. The lockup carries the brand on
          its own here; the page heading carries the rest.
          overflow-hidden so a future change clips instead of overlapping. */}
      <div
        className={`flex items-center gap-2 overflow-hidden px-4 py-5 ${
          collapsed ? "justify-center" : "justify-between"
        }`}
      >
        {!collapsed && (
          <Link href="/home" className="min-w-0 no-underline" onClick={onNavigate}>
            <BrandLogo size="sm" showWordmark={false} priority />
          </Link>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
          className="hidden h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border-strong bg-white/[0.04] text-text-secondary transition-colors duration-150 hover:border-accent hover:text-text-primary lg:flex"
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {collapsed ? <path d="M7 4l6 6-6 6" /> : <path d="M13 4l-6 6 6 6" />}
          </svg>
        </button>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3">
        {primary.length > 0 && (
          <>
            <ul className="space-y-1">{primary.map(row)}</ul>
            <hr className="my-4 border-border-subtle" />
          </>
        )}

        <ul className="space-y-1">{secondary.map(row)}</ul>
      </nav>

      <div className="space-y-2 border-t border-border-subtle p-3">
        {isAdmin && (
          <Link
            href="/admin"
            onClick={onNavigate}
            title={collapsed ? "Admin" : undefined}
            className="flex items-center gap-3 rounded-lg border border-border-strong bg-white/[0.05] px-3 py-2 text-[0.8rem] text-text-primary no-underline transition-colors duration-150 hover:border-accent hover:bg-white/[0.10]"
          >
            <span aria-hidden className="w-[18px] shrink-0 text-center">←</span>
            {!collapsed && <span className="truncate">Admin</span>}
          </Link>
        )}
        <Link
          href="/profile"
          onClick={onNavigate}
          title={collapsed ? (name ?? "View profile") : undefined}
          className="flex items-center gap-3 rounded-lg border border-transparent px-2 py-2 no-underline transition-colors duration-150 hover:border-border hover:bg-white/[0.04]"
        >
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-strong bg-white/[0.06] text-[0.75rem] font-medium text-text-primary"
          >
            {name?.trim().charAt(0).toUpperCase() || (
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                <circle cx="10" cy="7" r="3" />
                <path d="M4 17c0-3 2.7-4.5 6-4.5s6 1.5 6 4.5" />
              </svg>
            )}
          </span>
          {!collapsed && (
            <span className="min-w-0">
              {name ? (
                <>
                  <span className="block truncate text-[0.8rem] text-text-primary">{name}</span>
                  <span className="block text-[0.7rem] text-text-muted">View profile</span>
                </>
              ) : (
                <span className="block text-[0.8rem] text-text-primary">View profile</span>
              )}
            </span>
          )}
        </Link>
        <div className={collapsed ? "flex justify-center" : ""}>
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
