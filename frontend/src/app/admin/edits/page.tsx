import Link from "next/link";
import {
  listPendingListingEdits,
  changedFields,
  FIELD_LABELS,
} from "@/lib/listings/edits";
import EditsReview from "./EditsReview";

export default async function AdminListingEditsPage() {
  const items = await listPendingListingEdits();

  // The diff is computed here, not in the client component, so the same
  // function decides what the reviewer sees and what the proposal email
  // said changed.
  const changed = Object.fromEntries(
    items.map((e) => [e.id, changedFields(e.current, e.proposed)]),
  );

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-bg-primary text-text-primary px-8 py-12">
      <div className="max-w-[1200px] mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8 rule-draw pt-6">
          <div className="min-w-0">
            <p className="label-wide text-text-secondary mb-3">Admin · review queue</p>
            <h1 className="font-display text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.1] tracking-tight">
              Proposed changes
            </h1>
            <p className="text-[0.85rem] text-text-muted mt-2 max-w-[70ch] leading-relaxed">
              {items.length} waiting. Each of these listings is <em>already live</em> and stays
              live exactly as published until you approve the change — nothing here is
              currently hidden from members.
            </p>
          </div>
          <Link href="/admin" className="text-[0.8rem] text-text-secondary no-underline hover:text-text-primary">
            ← Admin home
          </Link>
        </div>

        <EditsReview items={items} labels={FIELD_LABELS} changed={changed} />
      </div>
    </main>
  );
}
