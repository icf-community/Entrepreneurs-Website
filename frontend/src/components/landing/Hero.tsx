import { ButtonLink } from "@/components/ui/ButtonLink";
import { Glyph } from "@/design-system/icons/Glyph";
import { AUDIENCES } from "@/design-system/icons/glyphs";
import { OrbitGlyph } from "@/design-system/OrbitGlyph";
import { HERO } from "@/lib/landing/content";
import { Lines } from "./Lines";

// The first screen: the headline, the one lit action, and the six audiences as six glyphs (the live page's paragraph of audiences is carried by
// the row; hovering or focusing a glyph names that audience in the caption and lights its orbit in the scene: scene/who.ts). The mark itself is the
// scene's, drawn in stars at the right of the words. The h1 is real text in the server's HTML, and it is what the page paints first.

export function Hero() {
  return (
    <section id="hero" data-section="hero" className="st st-hero" aria-labelledby="h1">
      <canvas className="poster" aria-hidden="true" />
      <div className="hero-copy">
        <h1 id="h1" className="display-xl">
          <Lines lines={HERO.headline} />
        </h1>
        <div className="actions">
          <ButtonLink className="btn" href={HERO.cta.href} leading={<OrbitGlyph className="btn-g" />}>
            <span className="btn-t">{HERO.cta.label}</span>
          </ButtonLink>
        </div>
        <div className="who-wrap who" id="who" role="group" aria-label={HERO.audienceLabel}>
          <ul className="who-row">
            {AUDIENCES.map((a, i) => (
              <li key={a.id}>
                <button type="button" className="who-btn" data-i={i} aria-label={a.full}>
                  <Glyph name={a.glyph} size={46} className="glyph who-glyph" />
                </button>
              </li>
            ))}
          </ul>
          <p className="who-cap" aria-live="polite">
            {HERO.caption}
          </p>
        </div>
      </div>
      <a className="cue" href={HERO.cue.href}>
        <Glyph name={HERO.cue.glyph} size={40} className="glyph cue-g" />
        <span className="sr-only">{HERO.cue.label}</span>
      </a>
    </section>
  );
}
