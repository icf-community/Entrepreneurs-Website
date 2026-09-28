import { FormSkeleton, Skeleton } from "@/components/ui/Skeleton";

// Same reasoning as members/loading.tsx: painted the instant navigation
// starts, sized like the real page so nothing jumps when it streams in
// (launch programme C1).
// Onboarding has no app shell (the member isn't approved yet).
export default function Loading() {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-bg-primary px-4 py-12">
      <div className="max-w-[560px] mx-auto">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-2/3 mt-3 mb-8" />
        <FormSkeleton fields={5} />
      </div>
    </main>
  );
}
