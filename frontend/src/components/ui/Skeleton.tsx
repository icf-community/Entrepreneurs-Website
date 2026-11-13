import { Panel } from "./Panel";

// ════════════════════════════════════════════════════════════════════
// Foundry · Skeleton (Lumen)
//
// Placeholder blocks shown while a Suspense boundary resolves. Sized to
// the real content so the layout doesn't jump when the data lands —
// a skeleton that shifts everything on arrival is worse than a spinner.
//
// Quiet by design: a block is a faint tint of ink, and a very slow sweep of
// light crosses it (4 s, with a long rest). Where an avatar or a glyph will be,
// a ring. The look and the motion are in src/design-system/overlays.css
// (.lm-skel); under prefers-reduced-motion the sweep stops and what is left is
// the still block.
//
// The e2e suite counts on two things, and both stay: a region is aria-busy
// ("wait for streamed sections to replace their skeletons") and every block
// keeps the `animate-pulse` class (the specs assert there are none left once a
// page has settled). Tailwind's pulse itself is switched off by .lm-skel, which
// replaces it with the sweep.
// ════════════════════════════════════════════════════════════════════

export function Skeleton({ className = "", shape = "line" }: { className?: string; shape?: "line" | "ring" }) {
  return <div aria-hidden className={`animate-pulse lm-skel ${className}`} data-shape={shape === "ring" ? "ring" : undefined} />;
}

/**
 * Wrapper for a skeleton region. Announces "Loading…" once, rather than
 * letting a screen reader read out a wall of decorative blocks, and marks
 * the region busy so assistive tech knows content is on its way.
 */
export function SkeletonRegion({
  label = "Loading…",
  className = "",
  children,
}: {
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Card grid placeholder, sized to the listing/member cards: a ring, two lines of name, two of text, two chips. */
export function CardGridSkeleton({ count = 6, className = "" }: { count?: number; className?: string }) {
  return (
    <SkeletonRegion className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <Panel key={i} className="p-6">
          <div className="flex items-center gap-4">
            <Skeleton shape="ring" className="size-11 shrink-0" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3 w-2/5 mt-2.5" />
            </div>
          </div>
          <Skeleton className="h-3 w-full mt-5" />
          <Skeleton className="h-3 w-11/12 mt-2" />
          <div className="flex gap-2 mt-5">
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        </Panel>
      ))}
    </SkeletonRegion>
  );
}

/** Stacked-row placeholder, for the list-style pages: a ring, a name and a line, a control at the end. */
export function RowListSkeleton({ count = 5, className = "" }: { count?: number; className?: string }) {
  return (
    <SkeletonRegion className={`space-y-3 ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <Panel key={i} className="p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <Skeleton shape="ring" className="size-11 shrink-0" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-1/4 mt-2.5" />
              </div>
            </div>
            <Skeleton className="h-11 w-24 rounded-full shrink-0" />
          </div>
        </Panel>
      ))}
    </SkeletonRegion>
  );
}

/** The search box + filter bar every list page renders above its results. */
export function FilterBarSkeleton() {
  return (
    <SkeletonRegion label="Loading filters…">
      <Skeleton className="h-12 w-full rounded-lg" />
      <div className="flex items-center gap-3 mt-4">
        <Skeleton className="h-11 w-24 rounded-full" />
        <Skeleton className="h-11 w-20 rounded-full" />
        <Skeleton className="h-4 w-16 ml-auto" />
      </div>
    </SkeletonRegion>
  );
}

/** Table placeholder, for the admin list views. */
export function TableSkeleton({ rows = 8, className = "" }: { rows?: number; className?: string }) {
  return (
    <SkeletonRegion className={`min-w-0 ${className}`}>
      <Panel className="overflow-hidden">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border-subtle last:border-0">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-56" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-16 rounded-full ml-auto" />
          </div>
        ))}
      </Panel>
    </SkeletonRegion>
  );
}

/** A page's opening: the context line, the title and the lede, drawn to the size PageHead sets them at. */
export function PageHeaderSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`lm-skel-head mb-8 ${className}`}>
      <Skeleton className="h-3 w-24" />
      <div className="grid grid-cols-1 gap-3">
        <Skeleton className="lm-skel--title w-[22rem] max-w-full" />
        <Skeleton className="h-4 w-full max-w-[24rem]" />
      </div>
    </div>
  );
}

/** Label + field pairs, for form pages. */
export function FormSkeleton({ fields = 4, className = "" }: { fields?: number; className?: string }) {
  return (
    <SkeletonRegion className={`space-y-6 ${className}`}>
      {Array.from({ length: fields }, (_, i) => (
        <div key={i}>
          <Skeleton className="h-3 w-1/4 mb-2" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      ))}
    </SkeletonRegion>
  );
}
