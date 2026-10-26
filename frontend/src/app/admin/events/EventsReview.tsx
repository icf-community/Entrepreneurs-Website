"use client";

import type { ComponentProps } from "react";
import EventReviewCard from "./EventReviewCard";
import { bulkApproveEvents, bulkRejectEvents } from "./actions";
import { BulkReview } from "@/app/admin/BulkReview";

type Item = ComponentProps<typeof EventReviewCard>["ev"];

export default function EventsReview({ items }: { items: Item[] }) {
  return (
    <BulkReview
      items={items}
      getId={(e) => e.id}
      renderCard={(e) => <EventReviewCard ev={e} />}
      bulkApprove={(ids) => {
        const versionById = new Map(items.map((e) => [e.id, e.editVersion]));
        return bulkApproveEvents(
          ids.flatMap((id) => {
            const editVersion = versionById.get(id);
            return editVersion === undefined ? [] : [{ id, editVersion }];
          }),
        );
      }}
      bulkReject={bulkRejectEvents}
      noun="event"
      emptyMessage="Nothing pending. The queue is clear."
    />
  );
}
