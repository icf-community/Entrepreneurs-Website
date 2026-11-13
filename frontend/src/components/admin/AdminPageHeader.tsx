import Link from "next/link";
import type { ReactNode } from "react";

// The "Admin · <title>" eyebrow + heading + description + "← Admin home"
// link, identical across every /admin/* page that wants it.
export function AdminPageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 mb-8 rule-draw pt-6">
      <div className="min-w-0">
        <p className="label-wide text-text-secondary mb-3">{eyebrow}</p>
        <h1 className="font-display text-display leading-[1.1] tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="text-body text-text-muted mt-2 max-w-[60ch] leading-relaxed">
            {description}
          </p>
        )}
      </div>
      <Link
        href="/admin"
        className="text-body rounded-lg border border-border-strong bg-tint-2 px-4 py-1.5 text-text-primary no-underline hover:border-accent"
      >
        ← Admin home
      </Link>
    </div>
  );
}
