import Link from "next/link";
import GraduatesClient from "./GraduatesClient";
import { requireAdminPage } from "@/lib/auth/guard";

// Default cutoff = last calendar year. The admin can override.
function defaultCutoff(): number {
  return new Date().getFullYear() - 1;
}

export default async function AdminGraduatesPage() {
  await requireAdminPage();
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-bg-primary text-text-primary px-8 py-12">
      <div className="max-w-[820px] mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8 rule-draw pt-6">
          <div className="min-w-0">
            <p className="label-wide text-text-secondary mb-3">Admin · graduates</p>
            <h1 className="font-display text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.1] tracking-tight">
              Ask graduating students to confirm
            </h1>
            <p className="text-[0.85rem] text-text-muted mt-2 leading-relaxed">
              Graduates keep their accounts. Each student asked confirms once and, if they&apos;ve graduated, becomes a recent graduate.
            </p>
          </div>
          <Link
            href="/admin"
            className="text-[0.8rem] text-text-secondary no-underline transition-colors duration-150 hover:text-text-primary"
          >
            ← Admin home
          </Link>
        </div>

        <GraduatesClient defaultCutoff={defaultCutoff()} />
      </div>
    </main>
  );
}
