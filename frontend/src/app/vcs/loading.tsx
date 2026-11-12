import { FilteredListLoadingSkeleton } from "@/components/FilteredListLoadingSkeleton";

// See events/loading.tsx for why this exists and renders the shell.
export default function Loading() {
  return <FilteredListLoadingSkeleton active="vcs" body="rows" />;
}
