import type { ReactNode } from "react";
import AppShell from "@/components/app/AppShell";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Definition, DefinitionList } from "@/components/ui/DefinitionList";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { PageHeaderSkeleton, Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";
import { Page } from "@/components/ui/Page";
import { Trail } from "@/components/ui/Trail";

// The chrome shared by /opportunities/[id], /events/[id] and /vcs/[id]:
// nav, a way back to the list the reader came from, and the masthead.
//
// Sibling of ListingPageShell, and deliberately the same masthead (PageHead) so
// a listing's own page reads as part of its section rather than as a different
// app. Narrower measure though: this is one thing to read, not a grid to scan.
// The way back and the section's name are PageHead's context trail.

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
      <Page width="page">
        <PageHead
          className="mb-8"
          context={<Trail href={backHref} label={backLabel} current={eyebrow} />}
          title={title}
          lede={meta}
        />
        {children}
      </Page>
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
    <EmptyState
      icon="eye-off"
      action={
        <ButtonLink href={backHref} variant="ghost" size="md">
          {backLabel}
        </ButtonLink>
      }
    >
      This {kind} has closed, or the poster or an admin removed it. Everything
      still open is on the list.
    </EmptyState>
  );
}

/**
 * A labelled fact in the detail grid. Renders nothing for an empty value.
 * It is a DefinitionList entry (a term and its definition), so it sits inside a
 * <DefinitionList>, on a Panel.
 */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <Definition term={label}>{children}</Definition>;
}

/** The facts of a listing: one ruled surface holding a DefinitionList of <Fact>s. */
export function Facts({ children }: { children: ReactNode }) {
  return (
    <Panel className="p-5 sm:p-6">
      <DefinitionList>{children}</DefinitionList>
    </Panel>
  );
}

/** The description block every one of the three pages opens its body with. */
export function Description({ text }: { text: string }) {
  return (
    <section className="grid gap-3">
      <h2 className="label-wide text-text-muted">Description</h2>
      <p className="measure-prose whitespace-pre-wrap text-lead text-text-secondary">{text}</p>
    </section>
  );
}

/**
 * The last block of a listing's page: what the reader can do about it. A hairline
 * with a lit end, its name, then the actions (the one lit button among them).
 */
export function ActionSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4">
      <Divider />
      <h2 className="label-wide text-text-muted">{title}</h2>
      {children}
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
      <Page width="page">
        <SkeletonRegion>
          <PageHeaderSkeleton />
          <div className="grid gap-10">
            <div className="grid gap-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
            <Panel className="p-5 sm:p-6">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="grid gap-2">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ))}
              </div>
            </Panel>
            <Skeleton className="h-11 w-48 rounded-full" />
          </div>
        </SkeletonRegion>
      </Page>
    </AppShell>
  );
}
