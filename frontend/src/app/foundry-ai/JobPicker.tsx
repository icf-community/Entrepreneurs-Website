"use client";

import { Field } from "@/components/forms/Field";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Notice } from "@/components/ui/Notice";
import { Select } from "@/components/ui/Select";
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
      <Notice
        tone="lit"
        icon="opportunities"
        action={<ButtonLink href="/opportunities/new" variant="ghost" size="sm">Post a job</ButtonLink>}
      >
        Candidate search works with an open job you posted.
      </Notice>
    );
  }
  return (
    <Field label="Job">
      <Select value={jobId ?? ""} onChange={(e) => onChange(e.target.value)}>
        {jobs.map((j) => (
          <option key={j.id} value={j.id}>{j.title} · {j.company}</option>
        ))}
      </Select>
    </Field>
  );
}
