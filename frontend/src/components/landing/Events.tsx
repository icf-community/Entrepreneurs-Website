import { Glyph } from "@/design-system/icons/Glyph";
import { EVENTS, EVENT_GLYPH, EVENT_LABEL, EXAMPLE } from "@/lib/landing/content";
import { Lines } from "./Lines";

// Events: four example events, each a date, a title, a place and a type (the type is read when the event takes the reading line, or is pointed at, or
// focused). The scene reads the same four as the moons of a calendar dial.

export function Events() {
  return (
    <section id="events" data-section="events" className="st st-events" aria-labelledby="ev-h">
      <canvas className="poster" aria-hidden="true" />
      <header className="head rcol">
        <h2 id="ev-h" className="font-display">
          <Lines lines={EVENTS.heading} />
        </h2>
        <p className="lede">{EVENTS.line}</p>
      </header>
      <p className="ex rcol">{EXAMPLE}</p>
      <ol className="events">
        {EVENTS.items.map((e, i) => (
          <li key={e.id} className="event rcol" data-i={i} data-id={e.id}>
            <button className="ev" type="button">
              <Glyph name={EVENT_GLYPH[e.type]} size={44} className="glyph dom-g" />
              <span className="ev-tx">
                <span className="ev-d">
                  {e.day} {e.month}
                </span>
                <span className="ev-t">{e.title}</span>
                <span className="ev-p">{e.place}</span>
                <span className="ev-k">{EVENT_LABEL[e.type]}</span>
              </span>
            </button>
            <i className="leader" aria-hidden="true" />
          </li>
        ))}
      </ol>
    </section>
  );
}
