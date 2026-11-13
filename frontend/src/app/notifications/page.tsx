import type { Metadata } from "next";
import AppShell from "@/components/app/AppShell";
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
      <div className="px-4 sm:px-8 py-10 sm:py-12">
        <div className="max-w-[760px] mx-auto">
          <p className="label-wide text-text-secondary mb-3">Notifications</p>
          <h1 className="font-display text-display leading-[1.1] tracking-tight mb-8">
            What&apos;s new for you
          </h1>
          <NotificationsList initial={items} />
        </div>
      </div>
    </AppShell>
  );
}
