"use client";

import { ShellError } from "@/components/ShellError";

export default function SettingsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ShellError error={error} retry={retry} active="settings" label="your settings" />;
}
