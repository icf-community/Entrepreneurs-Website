"use client";

import Link from "next/link";
import { useEffect, useRef, useSyncExternalStore } from "react";
import SignOutButton from "@/app/admin/SignOutButton";
import { PendingBadge } from "@/components/connections/PendingBadge";
import { hueOf } from "@/components/ui/avatarHue";
import { UnreadBadge } from "@/components/notifications/UnreadBadge";
import { Icon } from "@/design-system/icons/Icon";
import type { IconName } from "@/design-system/icons/names";
import { Roundel } from "@/design-system/logo/Roundel";
import { MESSAGING_ENABLED } from "@/lib/features";
import { LinkPending } from "./LinkPending";

// ════════════════════════════════════════════════════════════════════
// Foundry · App sidebar (Lumen)
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
// How it looks is shell.css: a ring is the cursor (it lights round the icon
// of the page you are on), the brand is the roundel alone, and the labels
// are only drawn away when the rail is collapsed. This file owns what the
// rail contains and how it behaves.
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
  | "settings"
  | "notifications";

type Item = { key: NavKey; href: string; label: string; icon: IconName };

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
  { key: "home", href: "/home", label: "Home", icon: "home" },
  { key: "community", href: "/community", label: "Community", icon: "community" },
  { key: "committee", href: "/committee", label: "Meet the Committee", icon: "committee" },
  { key: "members", href: "/members", label: "Members", icon: "members" },
  { key: "foundryAi", href: "/foundry-ai", label: "Foundry AI", icon: "foundry-ai" },
  { key: "connections", href: "/connections", label: "Connections", icon: "connections" },
  ...(MESSAGING_ENABLED
    ? [{ key: "messaging", href: "/messaging", label: "Messaging", icon: "messaging" } satisfies Item]
    : []),
  { key: "opportunities", href: "/opportunities", label: "Opportunities", icon: "opportunities" },
  { key: "events", href: "/events", label: "Events", icon: "events" },
  { key: "vcs", href: "/vcs", label: "Grants & VCs", icon: "vcs" },
];

// Members still in review get no PRIMARY rows, because every one of them is
// a dead end for them. AppNav handled that with a single "Return to home"
// item pointing at /pending, and dropping it left /settings with no way back
// out except the logo. This restores it. /pending self-guards with
// redirectAwayFrom, so a rejected member following it lands on /rejected.
const IN_REVIEW: Item[] = [
  { key: "home", href: "/pending", label: "Return to home", icon: "home" },
];

const SECONDARY: Item[] = [
  { key: "notifications", href: "/notifications", label: "Notifications", icon: "notifications" },
  { key: "calendar", href: "/calendar", label: "Calendar", icon: "calendar" },
  { key: "activity", href: "/my-activity", label: "My activity", icon: "activity" },
  { key: "submissions", href: "/my-submissions", label: "My submissions", icon: "submissions" },
  { key: "settings", href: "/settings", label: "Settings", icon: "settings" },
];

export default function Sidebar({
  active,
  name,
  isApproved = true,
  isAdmin = false,
  onNavigate,
  onClose,
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
  /** Passing this makes the rail the phone's drawer: always expanded, with a
   *  close control where the collapse control would be. */
  onClose?: () => void;
}) {
  const drawer = onClose !== undefined;
  const stored = useSyncExternalStore(subscribeNav, navSnapshot, () => false);
  // Collapsing is a desktop state; the drawer is always the labelled rail.
  const collapsed = stored && !drawer;
  const toggle = () => setNavCollapsed(!stored);

  // Admins keep the full rail regardless of their own status, so they can
  // walk the member-facing UI for diagnostics. Same rule AppNav applied.
  const full = isApproved || isAdmin;
  const primary = full ? PRIMARY : IN_REVIEW;
  const secondary = full ? SECONDARY : SECONDARY.filter((i) => i.key === "settings");

  const row = (it: Item) => (
    <NavRow key={it.key} item={it} active={active} collapsed={collapsed} full={full} onNavigate={onNavigate} />
  );

  return (
    <div className="lm-rail" data-collapsed={collapsed || undefined} data-drawer={drawer || undefined}>
      <SidebarHeader collapsed={collapsed} onToggle={toggle} onClose={onClose} onNavigate={onNavigate} />

      <nav aria-label="Main" className="lm-rail__nav">
        {primary.length > 0 && (
          <>
            <ul className="lm-rail__list">{primary.map(row)}</ul>
            <hr className="lm-rail__rule" />
          </>
        )}

        <ul className="lm-rail__list">{secondary.map(row)}</ul>
      </nav>

      <SidebarFooter collapsed={collapsed} isAdmin={isAdmin} name={name} onNavigate={onNavigate} />
    </div>
  );
}

// ─── One nav row ────────────────────────────────────────────────────
// The label stays in the page when the rail is collapsed (shell.css only
// draws it away), so every destination keeps its accessible name; `title` is
// the pointer's tooltip.
function NavRow({
  item, active, collapsed, full, onNavigate,
}: {
  item: Item;
  active: NavKey;
  collapsed: boolean;
  full: boolean;
  onNavigate?: () => void;
}) {
  const on = item.key === active;
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={on ? "page" : undefined}
        title={collapsed ? item.label : undefined}
        className="lm-navitem"
      >
        <span className="lm-navitem__mark">
          <Icon name={item.icon} size={20} />
        </span>
        <span className="lm-navitem__label">{item.label}</span>
        <LinkPending />
        {/* Only the Connections and Notifications rows carry a count, and
            only when there is one. They fail to nothing — see PendingBadge.
            The collapsed rail draws them away: a bare number beside a ring
            says nothing, and the row is a ring wide. */}
        {item.key === "connections" && full && <PendingBadge />}
        {item.key === "notifications" && full && <UnreadBadge />}
      </Link>
    </li>
  );
}

// ─── Brand + collapse toggle ────────────────────────────────────────
// The brand is the roundel alone: the lockup is ~5:1, which does not fit a
// rail with a control beside it, and a word set beside the roundel is not a
// lockup. Collapsed, the toggle sits under it. On the phone's drawer the
// collapse control becomes a close control, and takes focus when the drawer
// opens.
function SidebarHeader({
  collapsed, onToggle, onClose, onNavigate,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onClose?: () => void;
  onNavigate?: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawer = onClose !== undefined;
  useEffect(() => {
    if (drawer) closeRef.current?.focus();
  }, [drawer]);

  return (
    <div className="lm-rail__head">
      <Link href="/home" className="lm-rail__brand" onClick={onNavigate}>
        <Roundel size={48} label="Imperial Entrepreneurs" />
      </Link>
      {drawer ? (
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close navigation" className="lm-iconbtn">
          <Icon name="close" size={18} />
        </button>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
          className="lm-iconbtn lm-rail__toggle"
        >
          <Icon name={collapsed ? "chevron-right" : "chevron-left"} size={18} />
        </button>
      )}
    </div>
  );
}

// ─── Admin escape hatch + profile chip + sign out ──────────────────
function SidebarFooter({
  collapsed, isAdmin, name, onNavigate,
}: {
  collapsed: boolean;
  isAdmin: boolean;
  name?: string;
  onNavigate?: () => void;
}) {
  const initial = name?.trim().charAt(0).toUpperCase();
  return (
    <div className="lm-rail__foot">
      {isAdmin && (
        <Link
          href="/admin"
          onClick={onNavigate}
          title={collapsed ? "Admin" : undefined}
          className="lm-navitem"
          data-tone="outline"
        >
          <span className="lm-navitem__mark">
            <Icon name="arrow-left" size={18} />
          </span>
          <span className="lm-navitem__label">Admin</span>
        </Link>
      )}
      <Link
        href="/profile"
        onClick={onNavigate}
        title={collapsed ? (name ?? "View profile") : undefined}
        className="lm-navitem"
        data-tone="profile"
      >
        <span className="lm-navitem__mark" data-person data-hue={hueOf(name)} aria-hidden>
          {initial || <Icon name="profile" size={18} />}
        </span>
        <span className="lm-navitem__lines">
          {name ? (
            <>
              <span className="text-text-primary">{name}</span>
              <span className="lm-navitem__sub">View profile</span>
            </>
          ) : (
            <span className="text-text-primary">View profile</span>
          )}
        </span>
      </Link>
      <SignOutButton variant="rail" />
    </div>
  );
}
