import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import { PageHead } from "@/components/ui/PageHead";
import { requireApprovedUser } from "@/lib/auth/guard";
import { posterName } from "@/lib/data/profiles";
import EventForm from "./EventForm";
import { Page } from "@/components/ui/Page";

export const metadata: Metadata = { title: "Post an event" };

export default async function NewEventPage() {
  const { supabase, user, isAdmin, displayName } = await requireApprovedUser();

  const poster = await posterName(supabase, user.id);
  if (!poster) redirect("/login");

  return (
    <AppShell active="events" name={displayName} isAdmin={isAdmin}>
      <Page width="page">
        <PageHead
          className="mb-8"
          context="Post an event"
          title="Share an event with the network"
          lede="Submissions go to the admin queue for review before they appear on the Events tab."
        />

        <EventForm
          signupEmail={user.email ?? ""}
          defaultOrganiser={poster.displayName}
          mode="user"
        />
      </Page>
    </AppShell>
  );
}
