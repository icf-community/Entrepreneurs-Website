import type { Metadata } from "next";
import AppShell from "@/components/app/AppShell";
import { PageHead } from "@/components/ui/PageHead";
import { requireApprovedUser } from "@/lib/auth/guard";
import { myNotifications } from "@/lib/data/notifications";
import NotificationsList from "./NotificationsList";

export const metadata: Metadata = {
  title: "Notifications",
  robots: { index: false, follow: false },
};

export default async function NotificationsPage() {
  const { supabase, isAdmin, displayName } = await requireApprovedUser();
  const items = await myNotifications(supabase);

  return (
    <AppShell active="notifications" name={displayName} isAdmin={isAdmin}>
      <div className="px-[var(--gutter)] pb-20 pt-6 sm:pt-10">
        <div className="mx-auto max-w-[44rem]">
          <PageHead context="Notifications" title="What's new for you" className="mb-8" />
          <NotificationsList initial={items} />
        </div>
      </div>
    </AppShell>
  );
}
