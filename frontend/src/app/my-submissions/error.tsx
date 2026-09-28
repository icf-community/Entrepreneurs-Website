"use client";

import { ShellError } from "@/components/ShellError";

export default function MySubmissionsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ShellError error={error} retry={retry} active="submissions" label="your submissions" />;
}
