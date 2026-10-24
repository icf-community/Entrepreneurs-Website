import { FilteredListLoadingSkeleton } from "@/components/FilteredListLoadingSkeleton";

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
export default function Loading() {
  return <FilteredListLoadingSkeleton active="events" body="rows" />;
}
