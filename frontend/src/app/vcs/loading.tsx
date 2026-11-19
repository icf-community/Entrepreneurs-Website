import { FilteredListLoadingSkeleton } from "@/components/FilteredListLoadingSkeleton";

// See events/loading.tsx for why this exists and renders the shell. The VC and
// grant cards are a grid, so the placeholder is one too.
export default function Loading() {
  return <FilteredListLoadingSkeleton active="vcs" body="cards" />;
}
