import AppShell from "@/components/app/AppShell";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHead } from "@/components/ui/PageHead";
import { Icon } from "@/design-system/icons/Icon";
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
      <div className="px-[var(--gutter)] pb-20 pt-6 sm:pt-10">
        <div className="mx-auto max-w-[var(--content-max)]">
          <PageHead
            context="Bookmarks"
            title="Saved opportunities"
            lede={
              items.length === 0
                ? "Nothing saved yet. Tap the star on any opportunity in the directory to save it for later."
                : `${items.length} saved opportunit${items.length === 1 ? "y" : "ies"} still open for applications.`
            }
            actions={
              <ButtonLink href="/opportunities" variant="ghost" size="sm">
                <Icon name="arrow-left" size={16} />
                <span className="sr-only">← </span>Browse all opportunities
              </ButtonLink>
            }
            className="mb-8"
          />

          {items.length === 0 ? (
            <EmptyState
              icon="bookmark"
              action={
                <ButtonLink href="/opportunities" size="md">
                  Browse opportunities<span className="sr-only"> →</span>
                  <Icon name="arrow-right" size={16} />
                </ButtonLink>
              }
            >
              When you find a role that looks interesting, click the star to save it here. Saved opportunities stay in this list while they&apos;re open and disappear once the application deadline passes.
            </EmptyState>
          ) : (
            <OpportunitiesClient items={items} bookmarkedIds={bookmarkedIds} appliedIds={appliedIds} removeOnUnbookmark />
          )}
        </div>
      </div>
    </AppShell>
  );
}
