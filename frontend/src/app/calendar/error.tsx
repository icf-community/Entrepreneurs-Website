"use client";

import { SegmentError } from "@/components/SegmentError";

export default function CalendarError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <SegmentError error={error} retry={retry} label="the calendar" />;
}
