"use client";

import type { ComponentProps } from "react";
import OpportunityReviewCard from "./OpportunityReviewCard";
import { bulkApproveOpportunities, bulkRejectOpportunities } from "./actions";
import { BulkReview } from "@/app/admin/BulkReview";

type Item = ComponentProps<typeof OpportunityReviewCard>["opportunity"];

export default function OpportunitiesReview({ items }: { items: Item[] }) {
  return (
    <BulkReview
      items={items}
      getId={(o) => o.id}
      renderCard={(o) => <OpportunityReviewCard opportunity={o} />}
      bulkApprove={(ids) => {
        const versionById = new Map(items.map((o) => [o.id, o.editVersion]));
        return bulkApproveOpportunities(
          ids.flatMap((id) => {
            const editVersion = versionById.get(id);
            return editVersion === undefined ? [] : [{ id, editVersion }];
          }),
        );
      }}
      bulkReject={bulkRejectOpportunities}
      noun="opportunity"
      emptyMessage="Nothing pending. The queue is clear."
    />
  );
}
