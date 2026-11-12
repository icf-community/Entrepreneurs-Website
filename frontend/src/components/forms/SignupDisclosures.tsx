"use client";

import Link from "next/link";
import { useState } from "react";

// 18+ confirmation and T&C agreement checkbox, plus an expandable email-usage
// notice. The useStudentAuth / useAlumAuth hooks record the acceptance
// (lib/legal.ts) in the new account's metadata.
// Used by both the alumni signup form and the student verification-link
// signup flow. Parent owns the `agreed` state so it can gate the submit
// button.
export function SignupDisclosures({
  agreed, onChange,
}: {
  agreed: boolean;
  onChange: (v: boolean) => void;
}) {
  const [emailNoticeOpen, setEmailNoticeOpen] = useState(false);

  return (
    <div className="pt-1 space-y-3 border-t border-border-subtle mt-1">
      <label className="flex items-start gap-3 cursor-pointer select-none mt-3">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-[3px] w-4 h-4 shrink-0 accent-white cursor-pointer"
          aria-describedby="tc-disclosure"
        />
        <span id="tc-disclosure" className="text-[0.78rem] text-text-secondary leading-relaxed">
          I&apos;m 18 or over, and I agree to the{" "}
          <Link href="/terms" target="_blank" className="text-accent hover:text-accent-light no-underline">
            Terms &amp; Conditions
          </Link>
          . I&apos;ve read the{" "}
          <Link href="/privacy" target="_blank" className="text-accent hover:text-accent-light no-underline">
            Privacy Policy
          </Link>
          .
        </span>
      </label>

      <button
        type="button"
        onClick={() => setEmailNoticeOpen((o) => !o)}
        className="text-[0.72rem] text-text-muted hover:text-text-secondary bg-transparent border-0 cursor-pointer transition-colors flex items-center gap-1 pl-7"
      >
        <span>{emailNoticeOpen ? "▾" : "▸"}</span>
        How we&apos;ll use your email
      </button>

      {emailNoticeOpen && (
        <div className="pl-7 text-[0.72rem] text-text-muted leading-relaxed space-y-1.5">
          <p>We only send emails about your account and what you do on Foundry:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>Sign-in codes and password resets.</li>
            <li>Decisions on your application and on anything you post or report.</li>
            <li>Connection requests and acceptances (you can turn the summary off).</li>
            <li>Account notices, including the graduate cleanup, and replies when you contact us.</li>
          </ul>
          <p className="pt-1">
            We don&apos;t send marketing emails. Other members only see your address if you connect with them.
            When you delete your account we delete it, except for a few records we keep for a set time, listed in
            the <Link href="/privacy" target="_blank" className="text-accent hover:text-accent-light no-underline">Privacy Policy</Link>.
          </p>
        </div>
      )}
    </div>
  );
}
