"use client";

import { SegmentError } from "@/components/SegmentError";

export default function CommunityError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <SegmentError error={error} retry={retry} label="the community feed" />;
}
