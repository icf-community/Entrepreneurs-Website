"use client";

import { ShellError } from "@/components/ShellError";

export default function ProfileError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ShellError error={error} retry={retry} active="settings" label="your profile" />;
}
