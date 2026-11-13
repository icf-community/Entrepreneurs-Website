import type { Metadata } from "next";
import Link from "next/link";
import AppShell from "@/components/app/AppShell";
import { redirect } from "next/navigation";
import { requireApprovedUser } from "@/lib/auth/guard";
import { MESSAGING_ENABLED } from "@/lib/features";

// ════════════════════════════════════════════════════════════════════
// Foundry · Messaging (not yet)
//
// A placeholder with the rail around it, gated the same way every other
// member page is: an approved-only route that happens to have nothing
// behind it yet is still an approved-only route.
//
// It says what is coming and offers the two things members would have
// come here to do in the meantime, rather than being a dead end with a
// nice heading on it.
// ════════════════════════════════════════════════════════════════════

export const metadata: Metadata = {
  title: "Messaging",
  robots: { index: false, follow: false },
};

export default async function MessagingPage() {
  // Hidden until messaging is built (B18). 307 via redirect(), so nothing
  // caches the hop and restoring the page needs no cache purge.
  if (!MESSAGING_ENABLED) redirect("/home");
  const { isAdmin, displayName } = await requireApprovedUser();

  return (
    <AppShell active="messaging" name={displayName} isAdmin={isAdmin}>
      <div className="mx-auto flex w-full max-w-[1100px] flex-col items-center px-6 py-20 text-center sm:px-10 sm:py-28">
        <span
          aria-hidden
          className="anim-fade-in relative mb-8 flex h-16 w-16 items-center justify-center rounded-2xl border border-border-strong bg-tint-2"
        >
          <span className="absolute inset-0 rounded-2xl bg-accent-muted/40 blur-xl" />
          <svg
            width="28"
            height="28"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="relative text-text-primary"
          >
            <path d="M4 4.5h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H8.5L5 17v-3.5H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z" />
            <path d="M7 8h6M7 10.5h3.5" />
          </svg>
        </span>

        <p className="label-wide anim-fade-up mb-5 text-text-muted">Messaging</p>

        <h1 className="anim-fade-up font-display text-display leading-[1.02] tracking-tight text-text-primary">
          Coming Soon!
        </h1>

        <div aria-hidden className="anim-fade-up mx-auto my-7 h-px w-24 bg-border-strong" />

        <p className="anim-fade-up max-w-[34rem] text-lead leading-relaxed text-text-secondary">
          Member-to-member messaging is being built. Soon you will be able to reach
          anyone in the directory from here — introductions, questions about a role,
          or a note to someone building in your space — without leaving Foundry.
        </p>

        <p className="anim-fade-up mt-6 max-w-[34rem] text-body leading-relaxed text-text-muted">
          Until then, member profiles carry the contact links people have chosen to
          share, and every opportunity lists how to apply.
        </p>

        <div className="anim-fade-up mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/members"
            className="inline-flex items-center gap-2 rounded-lg border border-border-strong bg-tint-3 px-5 py-2.5 text-body text-text-primary no-underline transition-colors duration-150 hover:border-accent hover:bg-tint-4"
          >
            Browse members
            <span aria-hidden>→</span>
          </Link>
          <Link
            href="/opportunities"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-transparent px-5 py-2.5 text-body text-text-secondary no-underline transition-colors duration-150 hover:border-border-strong hover:text-text-primary"
          >
            See opportunities
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
