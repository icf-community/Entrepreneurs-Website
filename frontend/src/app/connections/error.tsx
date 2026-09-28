"use client";

import { ShellError } from "@/components/ShellError";

export default function ConnectionsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ShellError error={error} retry={retry} active="connections" label="your connections" />;
}
