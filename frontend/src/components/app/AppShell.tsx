"use client";

import { useEffect, useState, type ReactNode } from "react";
import Sidebar, { type NavKey } from "./Sidebar";
import { SiteBanner } from "@/components/SiteBanner";

// ════════════════════════════════════════════════════════════════════
// Foundry · App shell
//
// Sidebar + content column. The rail is fixed on desktop and a drawer
// below lg — the same breakpoint the old AppNav switched to a hamburger,
// so nothing changes about which devices get which affordance.
//
// The drawer traps nothing and locks body scroll while open, matching
// what AppNav already did; that behaviour is kept rather than reinvented.
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

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onEsc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onEsc);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="flex min-h-screen bg-bg-primary">
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-screen shrink-0 lg:block">
        <Sidebar active={active} name={name} isApproved={isApproved} isAdmin={isAdmin} />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="anim-fade-in fixed inset-0 z-40 cursor-default bg-black/60 lg:hidden"
          />
          <aside className="anim-panel fixed inset-y-0 left-0 z-50 lg:hidden">
            <Sidebar active={active} name={name} isApproved={isApproved} isAdmin={isAdmin} onNavigate={() => setOpen(false)} />
          </aside>
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border-subtle bg-bg-primary/92 px-4 py-3 backdrop-blur-md lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            aria-expanded={open}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-border-strong bg-white/[0.04] text-text-secondary transition-colors duration-150 hover:border-accent hover:text-text-primary"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
              <path d="M3 6h14M3 10h14M3 14h14" />
            </svg>
          </button>
          <span className="text-[0.8rem] text-text-secondary">Foundry</span>
        </header>

        <SiteBanner />
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
