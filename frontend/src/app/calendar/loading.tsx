import AppShell from "@/components/app/AppShell";
import { CardGridSkeleton, PageHeaderSkeleton } from "@/components/ui/Skeleton";

// Painted the instant a navigation to this route starts, before the server
// has finished anything. Next.js wraps the segment in a Suspense boundary
// automatically and swaps this out when page.tsx streams in.
//
// Without it the browser sits on the *previous* page until the server
// responds, which reads as an unresponsive click.
//
// The shell is rendered here too so the chrome doesn't flash: it looks
// identical either side of the swap. isApproved is true because every
// route with a loading.tsx is behind requireApprovedUser; the real nav
// replaces this within the same paint.
//
// The <main> carries the same id and tabIndex as the real page's. Without
// them the skip link points at nothing for as long as the skeleton is on
// screen — which e2e/a11y.spec.ts caught, because with streaming the
// document finishes loading while the fallback is still displayed. (AppShell
// draws the <main>.) The page is drawn in its own column, so nothing shifts
// when the real one streams in.
export default function Loading() {
  return (
    <AppShell active="calendar">
      <div className="px-[var(--gutter)] pb-20 pt-6 sm:pt-10">
        <div className="mx-auto max-w-[var(--content-max)]">
          <PageHeaderSkeleton />
          <CardGridSkeleton count={3} />
        </div>
      </div>
    </AppShell>
  );
}
