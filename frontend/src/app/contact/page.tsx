import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/auth/currentUser";
import AppShell from "@/components/app/AppShell";
import { BrandLogo } from "@/components/BrandLogo";
import ContactForm from "./ContactForm";

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
    <div className="px-4 py-10 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-[640px]">
          {member && (
            <Link
              href="/settings"
              className="inline-flex items-center text-[0.8rem] text-text-muted no-underline transition-colors duration-150 hover:text-text-secondary mb-6"
            >
              ← Settings
            </Link>
          )}
          <div className="mb-10 rule-draw pt-6">
            <p className="label-wide text-text-secondary mb-3">Contact</p>
            <h1 className="font-display text-text-primary leading-[1.1] tracking-tight text-[clamp(1.75rem,3.5vw,2.5rem)]">
              Get in touch
            </h1>
            <p className="text-[0.875rem] text-text-muted mt-3 leading-relaxed">
              {user ? (
                <>
                  Report a bug, ask a question, or flag something off. We&apos;ll reply to{" "}
                  <span className="text-text-secondary">{user.email}</span>.
                </>
              ) : (
                <>
                  Questions about Imperial Entrepreneurs, partnerships, or membership? Send us a
                  message and we&apos;ll get back to you.
                </>
              )}
            </p>
          </div>

          <ContactForm
            defaultName={member?.name ?? undefined}
            defaultEmail={user?.email ?? undefined}
            lockEmail={!!user?.email}
          />
      </div>
    </div>
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

  return (
    <div className="flex min-h-screen flex-col bg-bg-primary">
      <header className="border-b border-border-subtle px-4 py-4 sm:px-8 sm:py-5">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3">
          <Link href="/" className="shrink-0 no-underline">
            <BrandLogo size="sm" />
          </Link>
          <Link
            href="/"
            className="text-[0.8rem] text-text-muted no-underline transition-colors hover:text-text-secondary"
          >
            ← Back to home
          </Link>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="flex-1">
        {body}
      </main>
    </div>
  );
}
