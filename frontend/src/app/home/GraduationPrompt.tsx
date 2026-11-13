"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { confirmGraduation } from "./actions";

// Shown once to a student an admin has asked (20261011000005). Answering
// either way clears it; graduates keep their account.
export function GraduationPrompt({ currentYear }: { currentYear: number }) {
  const router = useRouter();
  const toast = useToast();
  const [answer, setAnswer] = useState<"yes" | "no" | null>(null);
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
    <section aria-labelledby="grad-heading" className="mb-10 rounded-2xl border border-border-strong bg-bg-card p-5">
      <h2 id="grad-heading" className="text-lead font-medium text-text-primary">Have you graduated?</h2>
      <p className="mt-1 text-body text-text-muted">
        Confirm it to keep your account and see roles for graduates.{" "}
        <Link href="/settings" className="underline">Add a personal email</Link> before your Imperial address is switched off.
      </p>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Have you graduated?">
        <Button type="button" variant={answer === "yes" ? "primary" : "ghost"} aria-pressed={answer === "yes"}
          onClick={() => setAnswer("yes")}>Yes, I&apos;ve graduated</Button>
        <Button type="button" variant={answer === "no" ? "primary" : "ghost"} aria-pressed={answer === "no"}
          onClick={() => setAnswer("no")}>Not yet</Button>
      </div>
      {answer === "yes" && (
        <label className="mt-4 flex items-center gap-2 text-body text-text-secondary">
          <input type="checkbox" checked={stillEnrolled} onChange={(e) => setStillEnrolled(e.target.checked)}
            className="h-4 w-4 rounded border border-border-strong" />
          I&apos;m starting another degree at Imperial
        </label>
      )}
      {answer === "no" && (
        <label className="mt-4 flex items-center gap-2 text-body text-text-secondary">
          I now expect to graduate in
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-lg border border-border-strong bg-tint-1 px-2 py-1 text-text-primary">
            {Array.from({ length: 7 }, (_, i) => currentYear + i).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      )}
      {answer && (
        <div className="mt-4">
          <Button type="button" onClick={save} loading={saving}>Save</Button>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-body text-danger">{error}</p>}
    </section>
  );
}
