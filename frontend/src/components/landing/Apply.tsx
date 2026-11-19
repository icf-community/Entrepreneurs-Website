import { ButtonLink } from "@/components/ui/ButtonLink";
import { Glyph } from "@/design-system/icons/Glyph";
import { OrbitGlyph } from "@/design-system/OrbitGlyph";
import { APPLY, STEP_GLYPH, STEP_LABEL } from "@/lib/landing/content";
import { Lines } from "./Lines";

// Apply: the three steps of the real sign-up, one gate each in the scene, and then the one action the page exists for. "Join Foundry" here is the burn
// that puts the waiting visitor into orbit: a ring that follows the pill (scene/cta.ts builds its path from the pill's real size), a comet circling it,
// a warm light behind, and when it is pressed the ring locks and one ring leaves it. It is an ordinary link to /login: pressing it plays that and
// never delays or prevents the navigation.

export function Apply() {
  return (
    <section id="apply" data-section="apply" className="st st-apply" aria-labelledby="apply-h">
      <canvas className="poster" aria-hidden="true" />
      <header className="head lcol">
        <h2 id="apply-h" className="font-display">
          <Lines lines={APPLY.heading} />
        </h2>
        <p className="lede">{APPLY.line}</p>
      </header>
      <ol className="steps">
        {APPLY.steps.map((s, i) => (
          <li key={s.id} className="step band" data-i={i} data-id={s.id}>
            <Glyph name={STEP_GLYPH[s.id]} size={44} className="glyph dom-g" />
            <div className="tx">
              <p className="n">{s.n}</p>
              <h3 className="name font-display">{STEP_LABEL[s.id]}</h3>
              <p className="line">{s.line}</p>
            </div>
            <i className="leader" aria-hidden="true" />
          </li>
        ))}
      </ol>
      <div className="cta">
        <span className="pad">
          <ButtonLink id="join" className="btn btn-main" href={APPLY.cta.href} lit leading={<OrbitGlyph className="btn-g" />}>
            <span className="btn-ring" aria-hidden="true">
              <svg>
                <path className="r-base" pathLength="100" />
                <path className="r-glow" pathLength="100" />
                <path className="r-comet" pathLength="100" />
              </svg>
            </span>
            <span className="btn-sheen" aria-hidden="true">
              <i />
            </span>
            <span className="btn-t">{APPLY.cta.label}</span>
          </ButtonLink>
        </span>
        <p className="fine">
          {/* the mock's small amber tick-ring: drawn at 18 px by the stylesheet (the glyph is 48 on its own grid) */}
          <Glyph name={APPLY.fineGlyph} size={28} className="glyph fine-g" />
          <span>{APPLY.fine}</span>
        </p>
        <i className="leader sig" aria-hidden="true" />
        <i className="spark" aria-hidden="true" />
      </div>
    </section>
  );
}
