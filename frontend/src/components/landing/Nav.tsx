import type { CSSProperties } from "react";
import Link from "next/link";
import { Glyph } from "@/design-system/icons/Glyph";
import { Roundel } from "@/design-system/logo/Roundel";
import { ROUNDEL } from "@/design-system/logo/logo-data";
import { NAV } from "@/lib/landing/content";

// The nav is Ascent's altitude rail and nothing else: five glyph ticks on the right edge, a gauge, and the real roundel as the cursor that
// rides it. There is no top bar. The one other control is a quiet "Sign in" (and, on a phone, "Menu", which opens the same five links as a
// panel). The brand lives in the cursor and in the footer's lockup. The ticks are placed by CSS (landing.css), the gauge and the cursor are
// moved by the scene (scene/nav.ts); every tick is a real anchor and works without JavaScript.

// The ring's centre, not the box's, sits on the rail: the rocket breaks out of the ring, so the roundel is taller than its ring.
const CURSOR_TOP = `calc(var(--cd) * -${(ROUNDEL.cy / ROUNDEL.w - 0.5).toFixed(4)})`;

export function Nav() {
  return (
    <header className="nav" id="nav">
      <div className="nav-end">
        <Link className="signin" href={NAV.signIn.href}>
          {NAV.signIn.label}
        </Link>
        <button className="menu-btn" type="button" aria-expanded="false" aria-controls="rail-links" aria-label={NAV.menu.ariaLabel}>
          {NAV.menu.label}
        </button>
      </div>
      <nav className="rail" id="rail" aria-label={NAV.railLabel}>
        <div className="gauge" aria-hidden="true">
          <i className="seg seg-up" />
          <i className="seg seg-down" />
        </div>
        <ol className="rail-links" id="rail-links">
          {NAV.links.map((link, i) => (
            <li key={link.id} data-i={i} style={{ "--i": i } as CSSProperties}>
              <a href={link.href}>
                <Glyph name={link.glyph} size={32} className="glyph tick" />
                <span className="lbl">{link.label}</span>
              </a>
            </li>
          ))}
        </ol>
        <span className="cursor" aria-hidden="true">
          <i className="orbit" />
          <Roundel className="cursor-mark" style={{ top: CURSOR_TOP }} />
        </span>
      </nav>
    </header>
  );
}
