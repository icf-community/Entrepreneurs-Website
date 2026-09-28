"use client";

import { ShellError } from "@/components/ShellError";

export default function MyActivityError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ShellError error={error} retry={retry} active="activity" label="your activity" />;
}
