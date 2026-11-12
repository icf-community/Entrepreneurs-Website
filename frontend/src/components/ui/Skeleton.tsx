// ════════════════════════════════════════════════════════════════════
// Foundry · Skeleton
//
// Placeholder blocks shown while a Suspense boundary resolves. Sized to
// the real content so the layout doesn't jump when the data lands —
// a skeleton that shifts everything on arrival is worse than a spinner.
//
// The pulse animates opacity from 1, so the global reduced-motion rule
// in globals.css (duration 0.01ms, iteration-count 1) lands it on a
// visible static block rather than an invisible one. That's why this
// doesn't need its own reduced-motion special case, unlike the hero
// fade-ups which start at opacity 0.
// ════════════════════════════════════════════════════════════════════

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-md bg-white/[0.055] ${className}`}
    />
  );
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

/** Card grid placeholder, sized to the listing/member cards. */
export function CardGridSkeleton({ count = 6, className = "" }: { count?: number; className?: string }) {
  return (
    <SkeletonRegion className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="p-6 rounded-2xl bg-bg-card border border-border">
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-3 w-2/5 mt-3" />
          <Skeleton className="h-3 w-full mt-5" />
          <Skeleton className="h-3 w-11/12 mt-2" />
          <div className="flex gap-2 mt-5">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** Stacked-row placeholder, for the list-style pages. */
export function RowListSkeleton({ count = 5, className = "" }: { count?: number; className?: string }) {
  return (
    <SkeletonRegion className={`space-y-3 ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="p-5 rounded-2xl bg-bg-card border border-border">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-1/4 mt-2.5" />
            </div>
            <Skeleton className="h-8 w-24 rounded-lg shrink-0" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** The search box + filter bar every list page renders above its results. */
export function FilterBarSkeleton() {
  return (
    <SkeletonRegion label="Loading filters…">
      <Skeleton className="h-[46px] w-full rounded-xl" />
      <div className="flex items-center gap-3 mt-4">
        <Skeleton className="h-7 w-24 rounded-full" />
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-4 w-16 ml-auto" />
      </div>
    </SkeletonRegion>
  );
}

/** Table placeholder, for the admin list views. */
export function TableSkeleton({ rows = 8, className = "" }: { rows?: number; className?: string }) {
  return (
    <SkeletonRegion className={`rounded-2xl bg-bg-card border border-border overflow-hidden ${className}`}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border-subtle last:border-0">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 w-56" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-16 rounded-lg ml-auto" />
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** Eyebrow + title + subtitle, the header every page opens with. */
export function PageHeaderSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`mb-8 ${className}`}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-9 w-[22rem] max-w-full mt-3" />
      <Skeleton className="h-3 w-40 mt-4" />
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
          <Skeleton className="h-11 w-full rounded-lg" />
        </div>
      ))}
    </SkeletonRegion>
  );
}
