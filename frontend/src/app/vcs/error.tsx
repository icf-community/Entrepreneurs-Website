"use client";

import { ShellError } from "@/components/ShellError";

export default function VcsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ShellError error={error} retry={retry} active="vcs" label="VCs and grants" />;
}
