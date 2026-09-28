"use client";

import { ShellError } from "@/components/ShellError";

export default function CommunityError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ShellError error={error} retry={retry} active="community" label="the community feed" />;
}
