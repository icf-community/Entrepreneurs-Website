import { PageHeaderSkeleton, TableSkeleton } from "@/components/ui/Skeleton";

// Admin pages (launch programme C1). This renders inside the admin layout,
// whose is_admin check has to finish first; what it covers is the page's
// own queue read, which is the slow part. Matches the admin pages' plain
// full-width layout (no app shell): the same gutter and column as the pages
// it stands in for, so nothing moves when the real page arrives.
export default function Loading() {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen px-[var(--gutter)] pb-24 pt-10 text-text-primary">
      <div className="mx-auto max-w-[var(--content-max)]">
        <PageHeaderSkeleton />
        <TableSkeleton rows={8} />
      </div>
    </main>
  );
}
