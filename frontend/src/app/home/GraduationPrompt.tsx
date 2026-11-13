"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FieldError } from "@/components/forms/Field";
import { Button } from "@/components/ui/Button";
import { ButtonTabs } from "@/components/ui/Tabs";
import { Checkbox } from "@/components/ui/Checkbox";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { confirmGraduation } from "./actions";

type Answer = "yes" | "no" | "";

// Shown once to a student an admin has asked (20261011000005). Answering
// either way clears it; graduates keep their account.
export function GraduationPrompt({ currentYear }: { currentYear: number }) {
  const router = useRouter();
  const toast = useToast();
  const [answer, setAnswer] = useState<Answer>("");
  const [stillEnrolled, setStillEnrolled] = useState(false);
  const [year, setYear] = useState(currentYear + 1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await confirmGraduation(answer === "yes", stillEnrolled, answer === "no" ? year : null);
      if (!res.ok) { setError(res.error); return; }
      toast(answer === "yes" ? "Congratulations — you're now listed as a recent graduate." : "Thanks, we've updated your year.", "success");
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel as="section" aria-labelledby="grad-heading" className="grid gap-4 p-5 sm:p-6">
      <div className="grid gap-1.5">
        <h2 id="grad-heading" className="font-display text-title text-text-primary">Have you graduated?</h2>
        <p className="measure-prose text-body text-text-secondary">
          Confirm it to keep your account and see roles for graduates.{" "}
          <Link href="/settings" className="text-accent-light underline underline-offset-4">Add a personal email</Link> before your Imperial address is switched off.
        </p>
      </div>

      <ButtonTabs<Answer>
        variant="segmented"
        label="Have you graduated?"
        items={[
          { value: "yes", label: "Yes, I've graduated" },
          { value: "no", label: "Not yet" },
        ]}
        value={answer}
        onSelect={setAnswer}
        className="justify-self-start"
      />

      {answer === "yes" && (
        <Checkbox
          label="I'm starting another degree at Imperial"
          checked={stillEnrolled}
          onChange={(e) => setStillEnrolled(e.target.checked)}
        />
      )}
      {answer === "no" && (
        <label className="flex flex-wrap items-center gap-3 text-body text-text-secondary">
          I now expect to graduate in
          <Select compact value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28">
            {Array.from({ length: 7 }, (_, i) => currentYear + i).map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
        </label>
      )}
      {answer && (
        <div>
          <Button type="button" size="md" onClick={save} loading={saving}>Save</Button>
        </div>
      )}
      {error && <FieldError>{error}</FieldError>}
    </Panel>
  );
}
