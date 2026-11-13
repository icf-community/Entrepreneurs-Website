import Link from "next/link";
import type { ReactNode } from "react";
import AppShell from "@/components/app/AppShell";
import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";

// The chrome shared by /opportunities/[id], /events/[id] and /vcs/[id]:
// nav, a way back to the list the reader came from, and the masthead.
//
// Sibling of ListingPageShell, and deliberately the same title-block
// grammar — a rule across the measure, the section's name beneath it, the
// heading at the page's own left margin — so a listing's own page reads as
// part of its section rather than as a different app. Narrower measure
// though: this is one thing to read, not a grid to scan.

export default function ListingDetailShell({
  active, isAdmin, backHref, backLabel, eyebrow, title, meta, children,
}: {
  active: "opportunities" | "events" | "vcs";
  isAdmin: boolean;
  backHref: string;
  /** Completes "← …", e.g. "All opportunities". */
  backLabel: string;
  eyebrow: string;
  title: string;
  /** One line under the heading: the facts a reader scans for first. */
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AppShell active={active} isAdmin={isAdmin}>
      <div className="px-4 py-10 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-[820px]">
          <Link
            href={backHref}
            className="mb-6 inline-flex items-center text-body text-text-muted no-underline transition-colors duration-150 hover:text-text-secondary"
          >
            ← {backLabel}
          </Link>
          <header className="rule-draw mb-8 pt-4">
            <p className="label-wide mb-6 text-text-muted">{eyebrow}</p>
            <h1 className="text-[clamp(1.6rem,3vw,2.3rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-text-primary">
              {title}
            </h1>
            {meta && (
              <p className="mt-3 text-body leading-relaxed text-text-muted">{meta}</p>
            )}
          </header>
          {children}
        </div>
      </div>
    </AppShell>
  );
}

/**
 * Body for the miss case, rendered inside the shell above.
 *
 * A listing has its own page for exactly as long as it is approved and
 * current — the three list RPCs drop past events and expired roles, and a
 * poster or admin can pull a row at any time. So a dead id is routine,
 * not exceptional, and /my-activity links to marked listings long after
 * they close. notFound() would answer those with the signed-out marketing
 * 404; this says what happened, inside the app, next to a way onward.
 */
export function ListingGone({
  kind, backHref, backLabel,
}: {
  kind: "opportunity" | "event" | "VC/grant";
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-bg-card px-6 py-12 text-center">
      <p className="mx-auto max-w-[46ch] text-body leading-relaxed text-text-muted">
        This {kind} has closed, or the poster or an admin removed it. Everything
        still open is on the list.
      </p>
      <Link
        href={backHref}
        className="mt-6 inline-flex items-center rounded-lg border border-border-strong bg-tint-2 px-4 py-2 text-body text-text-primary no-underline transition-colors hover:bg-tint-4 hover:border-accent"
      >
        {backLabel}
      </Link>
    </div>
  );
}

/** A labelled fact in the detail grid. Renders nothing for an empty value. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  if (children == null || children === "") return null;
  return (
    <div>
      <div className="mb-1 text-small text-text-muted">{label}</div>
      <div className="text-body text-text-secondary">{children}</div>
    </div>
  );
}

/** The description block every one of the three pages opens its body with. */
export function Description({ text }: { text: string }) {
  return (
    <section>
      <h2 className="mb-2 text-small text-text-muted">Description</h2>
      <p className="whitespace-pre-wrap text-lead leading-relaxed text-text-secondary">{text}</p>
    </section>
  );
}

/**
 * The loading.tsx body for all three detail routes.
 *
 * Same reasoning as the list pages' skeletons: without one, the browser
 * sits on the previous page until the server answers, which reads as an
 * unresponsive click. The shell is drawn here too so the chrome doesn't
 * flash between the fallback and the real page.
 *
 * A loading.tsx wraps its child segments as well, so this also stands in
 * for [id]/edit — which until now inherited the *list* page's skeleton,
 * filter bar and all.
 */
export function ListingDetailSkeleton({ active }: { active: "opportunities" | "events" | "vcs" }) {
  return (
    <AppShell active={active}>
      <div className="px-4 py-10 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-[820px]">
          <SkeletonRegion>
            <Skeleton className="h-3 w-32" />
            <div className="mb-8 mt-8 border-t border-border-subtle pt-6">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-5 h-8 w-[24rem] max-w-full" />
              <Skeleton className="mt-4 h-3 w-56" />
            </div>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-2/3" />
            <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i}>
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="mt-2 h-3 w-32" />
                </div>
              ))}
            </div>
            <Skeleton className="mt-9 h-10 w-48" />
          </SkeletonRegion>
        </div>
      </div>
    </AppShell>
  );
}
