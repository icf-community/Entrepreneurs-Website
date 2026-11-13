import Link from "next/link";
import { Icon } from "@/design-system/icons/Icon";
import { Lockup } from "@/design-system/logo/Lockup";
import { FOOTER } from "@/lib/landing/content";

// The footer is a strip: the 2026 lockup, the two social links (the design system's brand marks), the four legal pages, and the two lines the law asks for on
// every public page (the copyright and the company's trading disclosure, verbatim from the live site). The lockup links back to the top, as the live logo did.

export function Footer() {
  return (
    <footer id="footer" data-section="footer" className="st st-footer" aria-label={FOOTER.label}>
      <canvas className="poster" aria-hidden="true" />
      <div className="strip">
        <a className="lockup" href="#hero" aria-label={FOOTER.lockupLabel}>
          <Lockup height={56} />
        </a>
        <ul className="social">
          {FOOTER.social.map((s) => (
            <li key={s.id}>
              <a href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label}>
                <Icon name={s.id} size={22} />
              </a>
            </li>
          ))}
        </ul>
        <ul className="flinks">
          {FOOTER.links.map((l) => (
            <li key={l.href}>
              <Link href={l.href}>{l.label}</Link>
            </li>
          ))}
        </ul>
        <div className="legal">
          <p>{FOOTER.copyright}</p>
          <p className="disclosure">{FOOTER.disclosure}</p>
        </div>
      </div>
    </footer>
  );
}
