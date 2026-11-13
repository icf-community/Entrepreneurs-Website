"use client";

import Link from "next/link";
import type { RecruiterJob } from "@/lib/ai/types";

export function JobPicker({
  jobs, jobId, onChange,
}: {
  jobs: RecruiterJob[];
  jobId: string | null;
  onChange: (id: string) => void;
}) {
  if (jobs.length === 0) {
    return (
      <p className="rounded-2xl border border-border bg-bg-card p-5 text-body text-text-secondary">
        Candidate search works with an open job you posted. <Link href="/opportunities/new" className="underline">Post a job</Link>
      </p>
    );
  }
  return (
    <label className="block">
      <span className="text-small text-text-muted">Job</span>
      <select
        value={jobId ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border-strong bg-tint-1 px-3 py-2 text-body text-text-primary"
      >
        {jobs.map((j) => (
          <option key={j.id} value={j.id}>{j.title} · {j.company}</option>
        ))}
      </select>
    </label>
  );
}
