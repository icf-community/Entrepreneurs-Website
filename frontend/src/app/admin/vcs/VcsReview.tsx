"use client";

import type { ComponentProps } from "react";
import VcReviewCard from "./VcReviewCard";
import { bulkApproveVcGrants, bulkRejectVcGrants } from "./actions";
import { BulkReview } from "@/app/admin/BulkReview";

type Item = ComponentProps<typeof VcReviewCard>["vc"];

export default function VcsReview({ items }: { items: Item[] }) {
  return (
    <BulkReview
      items={items}
      getId={(v) => v.id}
      renderCard={(v) => <VcReviewCard vc={v} />}
      bulkApprove={(ids) => {
        const versionById = new Map(items.map((v) => [v.id, v.editVersion]));
        return bulkApproveVcGrants(
          ids.flatMap((id) => {
            const editVersion = versionById.get(id);
            return editVersion === undefined ? [] : [{ id, editVersion }];
          }),
        );
      }}
      bulkReject={bulkRejectVcGrants}
      noun="listing"
      emptyMessage="Nothing pending. The queue is clear."
    />
  );
}
