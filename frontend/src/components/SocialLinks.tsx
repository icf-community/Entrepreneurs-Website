import { externalHref } from "@/lib/safeUrl";

type Props = {
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl?: string | null;
};

export default function SocialLinks({ linkedinUrl, githubUrl, portfolioUrl }: Props) {
  if (!linkedinUrl && !githubUrl && !portfolioUrl) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {linkedinUrl && (
        <a
          href={externalHref(linkedinUrl)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="LinkedIn profile"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-white/[0.04] px-3 py-1.5 text-[0.7rem] font-medium text-text-secondary no-underline transition-colors duration-150 hover:bg-white/[0.10] hover:text-text-primary hover:border-[#0A66C2]"
        >
          <LinkedInIcon />
          LinkedIn
        </a>
      )}
      {githubUrl && (
        <a
          href={externalHref(githubUrl)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub profile"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-white/[0.04] px-3 py-1.5 text-[0.7rem] font-medium text-text-secondary no-underline transition-colors duration-150 hover:bg-white/[0.10] hover:text-text-primary hover:border-accent"
        >
          <GitHubIcon />
          GitHub
        </a>
      )}
      {portfolioUrl && (
        <a
          href={externalHref(portfolioUrl)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Portfolio site"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-white/[0.04] px-3 py-1.5 text-[0.7rem] font-medium text-text-secondary no-underline transition-colors duration-150 hover:bg-white/[0.10] hover:text-text-primary hover:border-accent"
        >
          <PortfolioIcon />
          Portfolio
        </a>
      )}
    </div>
  );
}

function LinkedInIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 11-.001-4.12 2.06 2.06 0 01.001 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .3a12 12 0 00-3.8 23.38c.6.12.83-.26.83-.58v-2.04c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.09-.73.09-.73 1.2.09 1.83 1.24 1.83 1.24 1.08 1.84 2.81 1.3 3.5 1 .1-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 016 0c2.28-1.55 3.29-1.23 3.29-1.23.65 1.66.24 2.88.12 3.18a4.65 4.65 0 011.23 3.22c0 4.61-2.81 5.63-5.49 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.21.7.83.58A12 12 0 0012 .3" />
    </svg>
  );
}

function PortfolioIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15 15 0 010 20" />
      <path d="M12 2a15 15 0 000 20" />
    </svg>
  );
}
