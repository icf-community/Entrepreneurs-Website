import { Glyph } from "@/design-system/icons/Glyph";
import { AUDIENCE_GLYPH, AUDIENCE_LABEL, WHO } from "@/lib/landing/content";

// Who we are: the story, then the six audiences one by one (the scene turns its six orbits to meet each as it takes the reading line), then the access rule.

export function Who() {
  return (
    <section id="who-we-are" data-section="who-we-are" className="st st-who" aria-labelledby="who-h">
      <canvas className="poster" aria-hidden="true" />
      <header className="head rcol">
        <h2 id="who-h" className="font-display">
          {WHO.heading}
        </h2>
        {WHO.story.map((t) => (
          <p key={t} className="story">
            {t}
          </p>
        ))}
      </header>
      {/* The live page set "Who can join" above the six roles; the mock names the list instead. It stays words in the page (visually hidden), and it is the list's name. */}
      <p id="roles-label" className="sr-only">
        {WHO.rolesLabel}
      </p>
      <ul className="roles rcol" aria-labelledby="roles-label">
        {WHO.roles.map((r, i) => (
          <li key={r.id} className="role" data-i={i} data-id={r.id}>
            <Glyph name={AUDIENCE_GLYPH[r.id]} size={44} className="glyph dom-g" />
            <div className="tx">
              <h3 className="name font-display">{AUDIENCE_LABEL[r.id]}</h3>
              <p className="line">{r.line}</p>
            </div>
            <i className="leader" aria-hidden="true" />
          </li>
        ))}
      </ul>
      <p className="access rcol">{WHO.access}</p>
    </section>
  );
}
