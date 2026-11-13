import { Glyph } from "@/design-system/icons/Glyph";
import { AUDIENCE_GLYPH, COMMUNITY, EXAMPLE } from "@/lib/landing/content";
import { Lines } from "./Lines";

// Community: a profile is skills, sectors and what you are looking for. The picker is the live page's chips, as a small instrument: the three skills
// and two sectors the page opens with are chosen, "+" lays the others in, and a pick lights the example members who share it (scene/ui.ts). The four
// members are examples (PRODUCT.md): they carry the quiet "Example" marker. Without JavaScript the whole picker lays out open (landing.css).

const has = (list: readonly string[], v: string) => list.includes(v);

function Tag({ kind, label, on }: { kind: "skills" | "sectors"; label: string; on: boolean }) {
  return (
    <li>
      <button className="tag" type="button" aria-pressed={on} data-kind={kind} data-v={label}>
        <span className="tag-b">{label}</span>
      </button>
    </li>
  );
}

export function Community() {
  return (
    <section id="community" data-section="community" className="st st-community" aria-labelledby="comm-h">
      <canvas className="poster" aria-hidden="true" />
      <header className="head lcol">
        <h2 id="comm-h" className="font-display">
          <Lines lines={COMMUNITY.heading} />
        </h2>
        <p className="lede">{COMMUNITY.line}</p>
      </header>
      <div className="picker lcol" id="picker" role="group" aria-label={COMMUNITY.pickerLabel}>
        <div className="picker-all" id="picker-all">
          <div className="tg" data-kind="skills">
            <p className="tg-l" id="tg-skills">
              {COMMUNITY.skillsLabel}
            </p>
            <ul aria-labelledby="tg-skills">
              {COMMUNITY.skills.map((s) => (
                <Tag key={s} kind="skills" label={s} on={has(COMMUNITY.activeSkills, s)} />
              ))}
            </ul>
          </div>
          <div className="tg" data-kind="sectors">
            <p className="tg-l" id="tg-sectors">
              {COMMUNITY.sectorsLabel}
            </p>
            <ul aria-labelledby="tg-sectors">
              {COMMUNITY.sectors.map((s) => (
                <Tag key={s} kind="sectors" label={s} on={has(COMMUNITY.activeSectors, s)} />
              ))}
            </ul>
          </div>
        </div>
        <button className="more" type="button" aria-expanded="false" aria-controls="picker-all" aria-label={COMMUNITY.moreLabel}>
          <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
            <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="2.3" />
            <path d="M24 16V32M16 24H32" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <p className="ex lcol">{EXAMPLE}</p>
      <ul className="members">
        {COMMUNITY.profiles.map((p, i) => (
          <li key={p.id} className="member band" data-i={i} data-id={p.id}>
            <Glyph name={AUDIENCE_GLYPH[p.audience]} size={44} className="glyph dom-g" />
            <div className="tx">
              <h3 className="name font-display">{p.name}</h3>
              <p className="sr-only">{p.role}</p>
              <p className="bio">{p.line}</p>
              <p className="look">
                <span className="look-l">{COMMUNITY.lookingLabel}</span> <span className="look-v">{p.looking}</span>
              </p>
            </div>
            <i className="leader" aria-hidden="true" />
          </li>
        ))}
      </ul>
    </section>
  );
}
