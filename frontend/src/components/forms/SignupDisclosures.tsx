"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Icon } from "@/design-system/icons/Icon";

// 18+ confirmation and T&C agreement checkbox, plus an expandable email-usage
// notice. The useStudentAuth / useAlumAuth hooks record the acceptance
// (lib/legal.ts) in the new account's metadata.
// Used by both the alumni signup form and the student verification-link
// signup flow. Parent owns the `agreed` state so it can gate the submit
// button.
//
// Exactly one checkbox lives here and the login screen counts on that. Its
// words carry two links, which stay underlined: inside a sentence a link must
// be told apart from the text without relying on colour.
const LINK = "text-accent-light underline decoration-lit-line underline-offset-4 transition-colors hover:decoration-accent-light";

export function SignupDisclosures({
  agreed, onChange,
}: {
  agreed: boolean;
  onChange: (v: boolean) => void;
}) {
  const [emailNoticeOpen, setEmailNoticeOpen] = useState(false);
  const noticeId = useId();

  return (
    <div className="mt-1 space-y-3 border-t border-border-subtle pt-1">
      <label className="lm-choice mt-3 select-none">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => onChange(e.target.checked)}
          className="lm-check"
          aria-describedby="tc-disclosure"
        />
        <span id="tc-disclosure" className="lm-choice__text text-small leading-relaxed">
          I&apos;m 18 or over, and I agree to the{" "}
          <Link href="/terms" target="_blank" className={LINK}>
            Terms &amp; Conditions
          </Link>
          . I&apos;ve read the{" "}
          <Link href="/privacy" target="_blank" className={LINK}>
            Privacy Policy
          </Link>
          .
        </span>
      </label>

      <button
        type="button"
        onClick={() => setEmailNoticeOpen((o) => !o)}
        aria-expanded={emailNoticeOpen}
        aria-controls={noticeId}
        className="flex min-h-[var(--touch)] cursor-pointer items-center gap-2 border-0 bg-transparent pl-1 text-small text-text-muted transition-colors hover:text-text-secondary"
      >
        <Icon name="chevron-down" size={16} className="lm-chev lm-chev--right" />
        How we&apos;ll use your email
      </button>

      {emailNoticeOpen && (
        <div id={noticeId} className="anim-panel space-y-2 pl-1 text-small leading-relaxed text-text-muted">
          <p>We only send emails about your account and what you do on Foundry:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Sign-in codes and password resets.</li>
            <li>Decisions on your application and on anything you post or report.</li>
            <li>Connection requests and acceptances (you can turn the summary off).</li>
            <li>Account notices, including the graduate cleanup, and replies when you contact us.</li>
          </ul>
          <p className="pt-1">
            We don&apos;t send marketing emails. Other members only see your address if you connect with them.
            When you delete your account we delete it, except for a few records we keep for a set time, listed in
            the <Link href="/privacy" target="_blank" className={LINK}>Privacy Policy</Link>.
          </p>
        </div>
      )}
    </div>
  );
}
