"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
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
    <form onSubmit={save} className="space-y-4">
      <Question legend="Are you currently enrolled on a degree course?" name="edu-enrolled" value={enrolled} onChange={setEnrolled} />
      <Question legend="Have you completed a degree?" name="edu-graduated" value={graduated} onChange={setGraduated} />
      {error && <p role="alert" className="text-[0.8rem] text-[#ff8080]">{error}</p>}
      {saved && !error && <p role="status" className="text-[0.8rem] text-text-muted">Saved.</p>}
      <Button type="submit" size="sm" loading={saving}>
        {compact ? "Confirm and show jobs" : "Save"}
      </Button>
    </form>
  );
}

function Question({
  legend, name, value, onChange,
}: { legend: string; name: string; value: Answer; onChange: (v: Answer) => void }) {
  return (
    <fieldset>
      <legend className="text-[0.85rem] text-text-primary">{legend}</legend>
      <div className="mt-2 flex gap-3">
        {(["yes", "no"] as const).map((v) => (
          <label
            key={v}
            className={`cursor-pointer rounded-lg border px-4 py-2 text-[0.8rem] ${value === v ? "border-accent bg-white/[0.08] text-text-primary" : "border-border-strong text-text-secondary hover:border-accent"}`}
          >
            <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} className="mr-2" />
            {v === "yes" ? "Yes" : "No"}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
