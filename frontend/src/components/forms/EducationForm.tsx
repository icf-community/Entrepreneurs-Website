"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/design-system/icons/Icon";
import { Button } from "@/components/ui/Button";
import { Radio } from "@/components/ui/Radio";
import { FieldError } from "@/components/forms/Field";
import { setMyEducation } from "@/app/settings/actions";

// Two yes/no questions that decide which jobs a member sees (AI-plan §7.2):
// a job is for students, graduates or both, and someone who is enrolled on
// a postgraduate course after a first degree is both. Self-declared, and
// changeable any time.

type Answer = "yes" | "no" | "";

export function EducationForm({
  initialEnrolled, initialGraduated, compact = false,
}: { initialEnrolled: boolean | null; initialGraduated: boolean | null; compact?: boolean }) {
  const router = useRouter();
  const toAnswer = (v: boolean | null): Answer => (v === null ? "" : v ? "yes" : "no");
  const [enrolled, setEnrolled] = useState<Answer>(() => toAnswer(initialEnrolled));
  const [graduated, setGraduated] = useState<Answer>(() => toAnswer(initialGraduated));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrolled || !graduated) { setError("Answer both questions."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await setMyEducation(enrolled === "yes", graduated === "yes");
      if (!res.ok) { setError(res.error); return; }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="grid gap-5">
      <Question legend="Are you currently enrolled on a degree course?" name="edu-enrolled" value={enrolled} onChange={setEnrolled} />
      <Question legend="Have you completed a degree?" name="edu-graduated" value={graduated} onChange={setGraduated} />
      {error && <FieldError>{error}</FieldError>}
      {saved && !error && (
        <p role="status" className="flex items-center gap-2 text-small text-text-muted">
          <Icon name="success" size={18} className="text-success" />
          Saved.
        </p>
      )}
      <div>
        <Button type="submit" size="sm" loading={saving}>
          {compact ? "Confirm and show jobs" : "Save"}
        </Button>
      </div>
    </form>
  );
}

function Question({
  legend, name, value, onChange,
}: { legend: string; name: string; value: Answer; onChange: (v: Answer) => void }) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-body text-text-primary">{legend}</legend>
      {/* Yes and No stay side by side on a phone (two equal columns); from sm they keep their own width. */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
        {(["yes", "no"] as const).map((v) => (
          <Radio
            key={v}
            card
            name={name}
            value={v}
            checked={value === v}
            onChange={() => onChange(v)}
            label={v === "yes" ? "Yes" : "No"}
            className="sm:min-w-32"
          />
        ))}
      </div>
    </fieldset>
  );
}
