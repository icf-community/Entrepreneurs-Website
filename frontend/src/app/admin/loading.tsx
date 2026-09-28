import { PageHeaderSkeleton, TableSkeleton } from "@/components/ui/Skeleton";

// Admin pages (launch programme C1). This renders inside the admin layout,
// whose is_admin check has to finish first; what it covers is the page's
// own queue read, which is the slow part. Matches the admin pages' plain
// full-width layout (no app shell).
export default function Loading() {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-bg-primary text-text-primary px-8 py-12">
      <div className="max-w-[1200px] mx-auto">
        <PageHeaderSkeleton className="pt-6" />
        <TableSkeleton rows={8} />
      </div>
    </main>
  );
}
