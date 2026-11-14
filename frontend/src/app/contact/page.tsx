import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/auth/currentUser";
import AppShell from "@/components/app/AppShell";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { PageHead } from "@/components/ui/PageHead";
import { Icon } from "@/design-system/icons/Icon";
import { PublicHeader } from "@/app/login/PublicHeader";
import ContactForm from "./ContactForm";
import { Page } from "@/components/ui/Page";
import { Trail } from "@/components/ui/Trail";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with Foundry, the founder community for Imperial College London students and alumni.",
};

// Public front door: reachable by anyone (prospective members, alumni,
// sponsors, press), not just signed-in users. Spam is held off by Turnstile
// + the Upstash submit bucket, not an auth wall. Signed-in members still get
// the member nav + their verified email prefilled.
export default async function ContactPage() {
  const supabase = await createClient();
  const { user } = await currentUser(supabase);

  let member: { isApproved: boolean; isAdmin: boolean; name: string | null } | null = null;
  if (user) {
    const [profileRes, isAdminRes] = await Promise.all([
      supabase.from("profiles").select("status, first_name, surname").eq("id", user.id).single(),
      supabase.rpc("is_admin"),
    ]);
    const profile = profileRes.data;
    if (profile) {
      const name = [profile.first_name, profile.surname].filter(Boolean).join(" ").trim() || null;
      member = { isApproved: profile.status === "approved", isAdmin: !!isAdminRes.data, name };
    }
  }

  const body = (
    <Page width="narrow" align={member ? undefined : "center"}>
      {/* The trail: a member came from Settings, so the way back is the first step of it; a visitor is just on Contact. */}
      <PageHead
        context={member ? <Trail href="/settings" label="Settings" current="Contact" /> : "Contact"}
        title="Get in touch"
        lede={
          user ? (
            <>
              Report a bug, ask a question, or flag something off. We&apos;ll reply to{" "}
              <span className="text-text-primary">{user.email}</span>.
            </>
          ) : (
            <>
              Questions about Imperial Entrepreneurs, partnerships, or membership? Send us a
              message and we&apos;ll get back to you.
            </>
          )
        }
      />

      <div className="mt-8">
        <ContactForm
          defaultName={member?.name ?? undefined}
          defaultEmail={user?.email ?? undefined}
          lockEmail={!!user?.email}
        />
      </div>
    </Page>
  );

  // Signed in: the member rail, in whatever mode their status allows.
  // Signed out: a plain header, because /contact is a public front door and
  // an anonymous visitor has no destinations to put in a rail.
  if (member) {
    return (
      <AppShell active="settings" name={member.name ?? undefined} isApproved={member.isApproved} isAdmin={member.isAdmin}>
        {body}
      </AppShell>
    );
  }

  // No background of its own: the atmosphere is the night behind every page.
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader>
        <ButtonLink href="/" variant="quiet" size="sm" leading={<Icon name="arrow-left" size={16} />}>
          <span className="sr-only">← </span>Back to home
        </ButtonLink>
      </PublicHeader>
      <main id="main-content" tabIndex={-1} className="flex-1">
        {body}
      </main>
    </div>
  );
}
