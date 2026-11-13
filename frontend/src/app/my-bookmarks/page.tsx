import Link from "next/link";
import AppShell from "@/components/app/AppShell";
import { requireApprovedUser } from "@/lib/auth/guard";
import { listBookmarkedOpportunities } from "@/lib/data/opportunities";
import { markedIds } from "@/lib/data/activity";
import OpportunitiesClient from "../opportunities/OpportunitiesClient";

export default async function MyBookmarksPage() {
  const { supabase, isAdmin, displayName } = await requireApprovedUser();

  const [items, appliedIds] = await Promise.all([
    listBookmarkedOpportunities(supabase),
    markedIds(supabase, "opportunity", "applied"),
  ]);

  // Everything on this page is bookmarked by definition — that is what the
  // query selects — so the stars render filled without a second read.
  const bookmarkedIds = items.map((i) => i.id);

  return (
    <AppShell active="opportunities" name={displayName} isAdmin={isAdmin}>
      <div className="px-4 sm:px-8 py-10 sm:py-12">
        <div className="max-w-[1200px] mx-auto">
          <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
            <div className="rule-draw pt-6">
              <p className="label-wide text-text-secondary mb-3 md:mb-0">Bookmarks</p>
              <h1 className="font-display text-text-primary leading-[1.1] tracking-tight text-display md:col-start-2 md:row-start-1">
                Saved opportunities
              </h1>
              <p className="text-body text-text-muted mt-3 leading-relaxed md:col-start-2">
                {items.length === 0
                  ? "Nothing saved yet. Tap the star on any opportunity in the directory to save it for later."
                  : `${items.length} saved opportunit${items.length === 1 ? "y" : "ies"} still open for applications.`}
              </p>
            </div>
            <Link
              href="/opportunities"
              className="text-body text-text-secondary no-underline transition-colors duration-150 hover:text-text-primary"
            >
              ← Browse all opportunities
            </Link>
          </div>

          {items.length === 0 ? (
            <div className="rounded-lg border border-border bg-bg-card px-6 py-14 text-center">
              <p className="text-body text-text-muted leading-relaxed">
                When you find a role that looks interesting, click the star to save it here. Saved opportunities stay in this list while they&apos;re open and disappear once the application deadline passes.
              </p>
              <Link
                href="/opportunities"
                className="inline-block mt-5 px-4 py-2 rounded-lg bg-accent text-bg-primary text-body font-medium no-underline transition-colors hover:bg-accent-light"
              >
                Browse opportunities →
              </Link>
            </div>
          ) : (
            <OpportunitiesClient items={items} bookmarkedIds={bookmarkedIds} appliedIds={appliedIds} removeOnUnbookmark />
          )}
        </div>
      </div>
    </AppShell>
  );
}
