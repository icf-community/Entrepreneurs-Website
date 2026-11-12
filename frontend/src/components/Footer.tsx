import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";

const LINKEDIN_URL  = "https://www.linkedin.com/company/imperial-entrepreneurs/";
const INSTAGRAM_URL = "https://www.instagram.com/imperialentrepreneurs/";

export default function Footer() {
  return (
    // Extra bottom padding on mobile clears Navbar's fixed sticky CTA bar,
    // which would otherwise sit on top of this content at the bottom of
    // the page.
    <footer className="border-t border-border bg-bg-secondary pt-12 pb-28 px-8 md:py-12">
      <div className="max-w-[1200px] mx-auto flex flex-wrap justify-between items-center gap-6">
        <BrandLogo size="xs" />

        <nav className="flex flex-wrap items-center gap-4">
          {/* Social logos */}
          <div className="flex items-center gap-2">
            <a
              href={LINKEDIN_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Imperial Entrepreneurs on LinkedIn"
              className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-border-strong text-text-secondary no-underline transition-colors duration-150 hover:bg-[#0A66C2] hover:border-[#0A66C2] hover:text-white"
            >
              <LinkedInIcon />
            </a>
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Imperial Entrepreneurs on Instagram"
              className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-border-strong text-text-secondary no-underline transition-colors duration-150 hover:bg-[#E1306C] hover:border-[#E1306C] hover:text-white"
            >
              <InstagramIcon />
            </a>
          </div>

          {/* Page links */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.75rem]">
            <Link href="/contact" className="text-text-muted no-underline transition-colors duration-150 hover:text-text-secondary">Contact</Link>
            <Link href="/privacy" className="text-text-muted no-underline transition-colors duration-150 hover:text-text-secondary">Privacy</Link>
            <Link href="/cookies" className="text-text-muted no-underline transition-colors duration-150 hover:text-text-secondary">Cookies</Link>
            <Link href="/terms" className="text-text-muted no-underline transition-colors duration-150 hover:text-text-secondary">Terms</Link>
          </div>
        </nav>

        <div className="w-full space-y-1.5 text-[0.75rem] text-text-muted">
          <p>© 2026 IC Founders Ltd · Built by students, for founders</p>
          {/* Trading disclosures (Companies Act 2006 / 2015 Regs) and the
              E-Commerce Regs reg 6 identity, on every public page. */}
          <p className="max-w-[760px] text-[0.7rem] leading-relaxed">
            Foundry is run by IC Founders Ltd for Imperial Entrepreneurs, an Imperial College Union society, and is
            not operated or endorsed by Imperial College London. IC Founders Ltd, registered in England and Wales,
            company number 17171277, registered office 71–75 Shelton Street, London WC2H 9JQ ·
            contact@imperialentrepreneurs.com
          </p>
        </div>
      </div>
    </footer>
  );
}

function LinkedInIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 11-.001-4.12 2.06 2.06 0 01.001 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}
