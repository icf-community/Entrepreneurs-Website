"use client";

import { ShellError } from "@/components/ShellError";

export default function MyBookmarksError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ShellError error={error} retry={retry} active="opportunities" label="your bookmarks" />;
}
