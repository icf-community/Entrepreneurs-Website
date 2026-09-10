"use client";

import { useState, useEffect } from "react";
import { BrandLogo } from "@/components/BrandLogo";
import { scrollBehavior } from "@/lib/motion";

const NAV_LINKS = [
  { label: "Who are we?", href: "#who-we-are" },
  { label: "Community",   href: "#community" },
  { label: "Opportunities", href: "#opportunities" },
  { label: "Events",      href: "#events" },
  { label: "Apply",       href: "#apply" },
];

function Logo() {
  return (
    <a
      href="#"
      onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: scrollBehavior() }); }}
      className="no-underline inline-block"
      aria-label="Foundry — Imperial Entrepreneurs"
    >
      <BrandLogo size="md" priority />
    </a>
  );
}

function NavLink({ label, href, isActive, onClick }: {
  label: string;
  href: string;
  isActive: boolean;
  onClick: (e: React.MouseEvent<HTMLAnchorElement>, href: string) => void;
}) {
  return (
    <a
      href={href}
      onClick={(e) => onClick(e, href)}
      className={`relative label-wide whitespace-nowrap no-underline transition-colors duration-150 ${isActive ? "text-text-primary" : "text-text-secondary hover:text-text-primary"}`}
    >
      {label}
      {isActive && (
        <span className="underline-draw absolute -bottom-1 left-0 right-0 h-px bg-accent" />
      )}
    </a>
  );
}

function JoinButton() {
  return (
    <a
      href="/login"
      className="hidden md:inline-flex items-center whitespace-nowrap rounded-lg px-5 py-2 text-sm font-semibold no-underline bg-accent text-bg-primary transition-colors duration-150 hover:bg-accent-dim"
    >
      Join Foundry
    </a>
  );
}

function HamburgerButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Toggle menu"
      className="md:hidden flex flex-col gap-1 border border-border-strong rounded-lg p-2 bg-white/[0.05] cursor-pointer"
    >
      <span className={`block w-[18px] h-px bg-text-secondary rounded transition-[transform,opacity] duration-200 ${open ? "rotate-45 translate-x-0.5 translate-y-[5px]" : ""}`} />
      <span className={`block w-[18px] h-px bg-text-secondary rounded transition-[transform,opacity] duration-200 ${open ? "opacity-0" : ""}`} />
      <span className={`block w-[18px] h-px bg-text-secondary rounded transition-[transform,opacity] duration-200 ${open ? "-rotate-45 translate-x-0.5 -translate-y-[5px]" : ""}`} />
    </button>
  );
}

export default function Navbar() {
  const [scrolled,      setScrolled]      = useState(false);
  const [menuOpen,      setMenuOpen]      = useState(false);
  const [activeSection, setActiveSection] = useState("");

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 20);
      const ids = NAV_LINKS.map((l) => l.href.replace("#", ""));
      for (const id of [...ids].reverse()) {
        const el = document.getElementById(id);
        if (el && window.scrollY >= el.offsetTop - 120) {
          setActiveSection(id);
          break;
        }
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    document.getElementById(href.replace("#", ""))?.scrollIntoView({ behavior: scrollBehavior() });
    setMenuOpen(false);
  };

  return (
    <header
      className={scrolled ? "fixed top-0 left-0 right-0 z-50 px-8 transition-colors duration-300 bg-bg-primary/92 backdrop-blur-md border-b border-border" : "fixed top-0 left-0 right-0 z-50 px-8 transition-colors duration-300 bg-transparent border-b border-transparent"}
    >
      <nav className="max-w-[1200px] mx-auto h-16 flex items-center gap-6">
        <Logo />

        {/* Desktop links. With "Who are we?" no longer allowed to wrap
            (whitespace-nowrap), the row's true content width — logo +
            5 links + Join Foundry, none of them shrinkable — exceeds the
            site's 1200px content width at gap-8 (40px): ~1254px needed vs
            1200px available. The flex-shrink algorithm then mis-sized the
            logo box under the strain (a nested-flex min-content quirk) and
            let its text paint outside its own box instead of visibly
            overflowing. gap-6 (30px) brings total content to ~1134px —
            comfortable real slack, not a few px of luck. */}
        <div className="hidden md:flex items-center gap-6">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.href}
              {...link}
              isActive={activeSection === link.href.replace("#", "")}
              onClick={handleNavClick}
            />
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <JoinButton />
          <HamburgerButton open={menuOpen} onClick={() => setMenuOpen(!menuOpen)} />
        </div>
      </nav>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="md:hidden -mx-8 flex flex-col gap-5 border-t border-border bg-bg-primary/95 px-8 py-6 backdrop-blur-md">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(e) => handleNavClick(e, link.href)}
              className="label-wide text-[0.8rem] text-text-secondary no-underline hover:text-text-primary transition-colors"
            >
              {link.label}
            </a>
          ))}
          <a
            href="/login"
            className="inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-base font-semibold no-underline bg-accent text-bg-primary"
          >
            Join Foundry
          </a>
        </div>
      )}

      {/* Mobile-only sticky CTA — JoinButton above is desktop-only
          (hidden md:inline-flex), and its only other mobile path was
          inside the hamburger dropdown, which most visitors never open.
          Hidden while the dropdown itself is open to avoid stacking two
          "Join Foundry" buttons. Footer.tsx carries matching bottom
          padding on mobile so this never covers its content. */}
      {!menuOpen && (
        <div className="md:hidden fixed inset-x-0 bottom-0 z-50 border-t border-border bg-bg-primary/95 px-4 py-3 backdrop-blur-md [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
          <a
            href="/login"
            className="flex items-center justify-center rounded-lg px-5 py-3 text-sm font-semibold no-underline bg-accent text-bg-primary transition-colors duration-150 hover:bg-accent-dim"
          >
            Join Foundry
          </a>
        </div>
      )}
    </header>
  );
}