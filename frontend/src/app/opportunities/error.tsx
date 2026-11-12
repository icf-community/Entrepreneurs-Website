"use client";

import { ShellError } from "@/components/ShellError";

export default function OpportunitiesError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ShellError error={error} retry={retry} active="opportunities" label="opportunities" />;
}
