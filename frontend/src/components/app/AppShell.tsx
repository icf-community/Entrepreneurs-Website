"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Sidebar, { type NavKey } from "./Sidebar";
import { SiteBanner } from "@/components/SiteBanner";
import { Icon } from "@/design-system/icons/Icon";
import { Roundel } from "@/design-system/logo/Roundel";

// ════════════════════════════════════════════════════════════════════
// Foundry · App shell (Lumen)
//
// Sidebar + content column. The rail is fixed on desktop and a drawer
// below lg — the same breakpoint the old AppNav switched to a hamburger,
// so nothing changes about which devices get which affordance. The look of
// all of it is shell.css; the shell draws no background of its own, so the
// atmosphere (surfaces.css) shows behind every member page.
//
// The drawer locks body scroll while open, as AppNav's did. What is added:
// the page behind it (the rail, the app bar, the content) is `inert` while it
// is open, so focus cannot wander out of it into content it covers and a screen
// reader does not read what is hidden; focus moves to its close control when it
// opens and comes back to the menu control when it closes; and it closes by
// itself if the window grows to a desktop while it is open (the scroll lock
// would otherwise outlive the drawer). It is not a Sheet (ui/Sheet.tsx): it is
// the same labelled rail the desktop shows, and must stay in the page.
// ════════════════════════════════════════════════════════════════════

export default function AppShell({
  active,
  name,
  isApproved = true,
  isAdmin = false,
  children,
}: {
  active: NavKey;
  name?: string;
  isApproved?: boolean;
  isAdmin?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // 64rem is Tailwind's lg, the breakpoint shell.css shows the rail at.
    const desktop = window.matchMedia("(min-width: 64rem)");
    const onResize = (e: MediaQueryListEvent) => {
      if (e.matches) setOpen(false);
    };
    document.addEventListener("keydown", onEsc);
    desktop.addEventListener("change", onResize);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onEsc);
      desktop.removeEventListener("change", onResize);
      document.body.style.overflow = prev;
      menu?.focus();
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="lm-shell">
      {/* Desktop rail */}
      <aside className="lm-shell__rail" inert={open || undefined}>
        <Sidebar active={active} name={name} isApproved={isApproved} isAdmin={isAdmin} />
      </aside>

      {/* Mobile drawer. The scrim is not a control: the close button inside
          the drawer and Escape are the keyboard's ways out. */}
      {open && (
        <>
          <div aria-hidden="true" onClick={close} className="lm-scrim" />
          <aside className="lm-drawer">
            <Sidebar
              active={active}
              name={name}
              isApproved={isApproved}
              isAdmin={isAdmin}
              onNavigate={close}
              onClose={close}
            />
          </aside>
        </>
      )}

      <div className="lm-shell__main" inert={open || undefined}>
        <header className="lm-appbar">
          <button
            ref={menuRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            aria-expanded={open}
            className="lm-iconbtn"
          >
            <Icon name="menu" size={20} />
          </button>
          <Link href="/home" className="lm-appbar__brand">
            <Roundel size={45} label="Imperial Entrepreneurs" />
          </Link>
        </header>

        <SiteBanner />
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
