import { Glyph } from "@/design-system/icons/Glyph";
import { EXAMPLE, KIND_GLYPH, OPPORTUNITIES } from "@/lib/landing/content";
import { Lines } from "./Lines";

// Opportunities: three example listings, each a glyph (a briefcase for a role, a coin for funding), the kind, the title, the company, and the pay with
// its equity and place. The scene launches three satellites off the rail's Opportunities tick as this station arrives, one per listing.

/** A hand-set equity mark in the logo's line language: a ring with a wedge. Decorative: the word "Equity" is beside it as visually hidden text. */
function Pie() {
  return (
    <svg className="pie" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 12V4.4A7.6 7.6 0 0 1 18.9 8.7Z" fill="currentColor" />
    </svg>
  );
}

export function Opportunities() {
  return (
    <section id="opportunities" data-section="opportunities" className="st st-opps" aria-labelledby="opps-h">
      <canvas className="poster" aria-hidden="true" />
      <header className="head lcol">
        <h2 id="opps-h" className="font-display">
          <Lines lines={OPPORTUNITIES.heading} />
        </h2>
        <p className="lede">{OPPORTUNITIES.line}</p>
      </header>
      <p className="ex lcol">{EXAMPLE}</p>
      <ul className="listings">
        {OPPORTUNITIES.items.map((o, i) => (
          <li key={o.id} className="listing lcol" data-i={i} data-id={o.id} data-kind={o.kind}>
            <Glyph name={KIND_GLYPH[o.kind]} size={44} className="glyph dom-g" />
            <div className="tx">
              <p className="kind">{o.tag}</p>
              <h3 className="title font-display">{o.title}</h3>
              <p className="co">{o.company}</p>
              <p className="meta">
                <span className="pay">
                  <span className="sr-only">{OPPORTUNITIES.labels.pay} </span>
                  {o.pay}
                </span>
                {o.equity && (
                  <>
                    {" "}
                    <span className="eq">
                      <Pie />
                      <span className="sr-only">{OPPORTUNITIES.labels.equity} </span>
                      {o.equity}
                    </span>
                  </>
                )}{" "}
                <span className="where">
                  <span className="sr-only">{OPPORTUNITIES.labels.place} </span>
                  {o.place}
                </span>
              </p>
            </div>
            <i className="leader" aria-hidden="true" />
          </li>
        ))}
      </ul>
    </section>
  );
}
