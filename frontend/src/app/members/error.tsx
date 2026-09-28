"use client";

import { ShellError } from "@/components/ShellError";

export default function MembersError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ShellError error={error} retry={retry} active="members" label="the member directory" />;
}
