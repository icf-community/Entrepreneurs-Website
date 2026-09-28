"use client";

import AppShell from "@/components/app/AppShell";
import type { NavKey } from "@/components/app/Sidebar";
import { SegmentError } from "@/components/SegmentError";

// B9: every member page renders AppShell inside page.tsx (there are no
// segment layouts), so a segment error.tsx replaces the navigation along
// with the page. Wrapping SegmentError in AppShell keeps the sidebar, so a
// failed section is a message with "Try again" and a way elsewhere, not a
// dead end. No name/admin data is available here; the shell renders its
// generic state, which is fine for an error screen.
export function ShellError({
  error,
  retry,
  active,
  label,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  active: NavKey;
  label: string;
}) {
  return (
    <AppShell active={active}>
      <SegmentError error={error} retry={retry} label={label} />
    </AppShell>
  );
}
