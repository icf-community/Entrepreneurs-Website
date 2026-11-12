"use client";

import { ShellError } from "@/components/ShellError";

export default function CommitteeError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ShellError error={error} retry={retry} active="committee" label="the committee page" />;
}
