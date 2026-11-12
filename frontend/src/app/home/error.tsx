"use client";

import { ShellError } from "@/components/ShellError";

export default function HomeError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ShellError error={error} retry={retry} active="home" label="your home page" />;
}
