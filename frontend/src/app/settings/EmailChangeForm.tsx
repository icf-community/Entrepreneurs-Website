"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { isImperialEmail } from "@/lib/auth/imperialEmail";
import { verifyOtpServerSide } from "@/lib/auth/verifyOtpGate";
import { ErrorBanner, SuccessBanner } from "@/components/forms/Banners";
import { Field } from "@/components/forms/Field";
import { Icon } from "@/design-system/icons/Icon";
import type { Affiliation } from "@/lib/intake/steps";
import { SettingsSection } from "./SettingsSection";

// ════════════════════════════════════════════════════════════════════
// Change your email address.
//
// HOW GOTRUE ACTUALLY BEHAVES HERE, measured against a local stack whose
// auth config matches the hosted project. The previous version of this
// file described the opposite behaviour and shipped broken, so the
// measurement is recorded here rather than summarised.
//
// updateUser({ email }) writes the pending address to email_change and
// sends a 6-digit code to BOTH mailboxes. With "Secure email change" on
// (it is, in the hosted project) each code confirms one side and BOTH are
// required:
//
//   POST /verify { email: <current>, token: <old-inbox code> }
//     -> 200 {"code":"200","msg":"Confirmation link accepted. Please
//             proceed to confirm link sent to the other email"}
//        no user, no session. email_change_confirm_status 0 -> 1.
//        THE ADDRESS HAS NOT CHANGED.
//
//   POST /verify { email: <new>, token: <new-inbox code> }
//     -> 200 with a user and a session. auth.users.email now moves.
//
// TWO CONSEQUENCES, both of which the first version of this form got
// wrong.
//
// The new-address code is NOT unverifiable. It has to be sent addressed
// to the NEW address, because GoTrue looks that token up by email_change
// while the current-address token is looked up by email. Sending it with
// the current address fails, which is what "it cannot be verified" was
// mistakenly concluded from.
//
// A 200 IS NOT SUCCESS. The single-confirmation response is a 200, so
// supabase-js returns error: null and the old code treated that as a
// completed change — it showed a success screen while the account had not
// moved, and the member was then told to sign in with an address that did
// not exist. Nothing below reports success on the absence of an error;
// it reports success when the returned user actually carries the new
// address.
//
// WHY BOTH INBOXES IS THE RIGHT SHAPE. The old-address code is what stops
// someone on a stolen session moving the account to an address they
// control. The new-address code is what stops a typo moving the account
// to an address nobody can read. Neither alone covers both.
//
// There is no password step: Google accounts have no password identity,
// so it would have to be skipped exactly where it was meant to help. The
// old inbox is the reauthentication.
//
// The domain check runs before updateUser rather than relying on the DB
// trigger, because the trigger fires on the final write — by which point
// the member has already been asked for two codes. See
// lib/auth/imperialEmail.ts.
// ════════════════════════════════════════════════════════════════════

type Stage = "idle" | "codes" | "done";

export default function EmailChangeForm({
  currentEmail,
  role,
}: {
  currentEmail: string;
  role: Affiliation;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [stage, setStage] = useState<Stage>("idle");
  const [newEmail, setNewEmail] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [codeCurrent, setCodeCurrent] = useState("");
  const [codeNew, setCodeNew] = useState("");
  // A verified code is spent. If the second one then fails, resubmitting
  // the first would be rejected as invalid and the member could never
  // finish. Remembering which side has landed keeps a retry to the code
  // that is actually outstanding.
  const [currentConfirmed, setCurrentConfirmed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // A six-digit code: figures, centred and spaced out so each one can be checked against the email. Tabular figures, not a monospace face.
  const codeCls = "data text-center tracking-[0.3em]";

  const pending = newEmail.trim().toLowerCase();

  const finish = () => {
    setStage("done");
    setCodeCurrent("");
    setCodeNew("");
    router.refresh();
  };

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!pending || !pending.includes("@") || pending.startsWith("@") || pending.endsWith("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    // Redundant against the code we send to the new address — a typo cannot
    // complete the change either way — but it stops the code being posted to
    // a stranger's inbox in the first place.
    if (pending !== confirmEmail.trim().toLowerCase()) {
      setError("The two addresses don't match.");
      return;
    }
    if (pending === currentEmail.trim().toLowerCase()) {
      setError("That's already your email address.");
      return;
    }
    if (role === "student" && !isImperialEmail(pending)) {
      setError("Student accounts must keep an @imperial.ac.uk or @ic.ac.uk address.");
      return;
    }

    setIsLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ email: pending });
      // An address that already has an account is deliberately NOT reported.
      // See isEmailTaken below.
      if (updateError && !isEmailTaken(updateError)) {
        setError(updateError.message);
        return;
      }
      setCurrentConfirmed(false);
      setStage("codes");
    } catch {
      setError("Couldn't reach the server. Try again in a moment.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      if (!currentConfirmed) {
        // Addressed to the CURRENT address: GoTrue finds this token by
        // auth.users.email. Rate limit + verifyOtp both run server-side now
        // (verifyOtpServerSide) — see that file for why.
        const result = await verifyOtpServerSide(currentEmail, codeCurrent, "email_change");
        if (!result.ok) {
          setError(friendlyCodeError(result.error, "old"));
          return;
        }
        // A project with "Secure email change" turned off applies the change
        // on this one code and hands back a session, leaving nothing to
        // confirm. Checking the returned address rather than assuming the
        // setting is what keeps this form correct either way.
        if (result.data.userEmail?.toLowerCase() === pending) {
          if (result.data.session) {
            await supabase.auth.setSession({
              access_token: result.data.session.accessToken,
              refresh_token: result.data.session.refreshToken,
            });
          }
          finish();
          return;
        }
        // The expected "Secure email change" response: error is null, but
        // there is also no user/session — this one code only confirms the
        // old side, nothing to sync yet.
        setCurrentConfirmed(true);
      }

      // Addressed to the NEW address: GoTrue finds this token by
      // auth.users.email_change, so the current address will not match it.
      const result = await verifyOtpServerSide(pending, codeNew, "email_change");
      if (!result.ok) {
        setError(friendlyCodeError(result.error, "new"));
        return;
      }
      if (result.data.userEmail?.toLowerCase() !== pending) {
        setError("We couldn't complete the change. Start again to get a new pair of codes.");
        return;
      }
      if (result.data.session) {
        await supabase.auth.setSession({
          access_token: result.data.session.accessToken,
          refresh_token: result.data.session.refreshToken,
        });
      }
      finish();
    } finally {
      setIsLoading(false);
    }
  };

  if (stage === "done") {
    return (
      <SettingsSection title="Email address">
        <SuccessBanner>
          Your email address has been changed. Use the new address next time you sign in.
        </SuccessBanner>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title="Change email address"
      description={
        stage === "idle" ? (
          <>
            We&apos;ll send a code to your old address and another to the new one. Both are needed:
            the first confirms it&apos;s you, the second confirms you can read the new inbox.
            {role === "student" && " Student accounts must stay on an Imperial address."}
          </>
        ) : (
          <>Enter both codes to complete the change. They expire in 30 minutes.</>
        )
      }
    >
      <form onSubmit={stage === "idle" ? handleRequest : handleConfirm} className="grid gap-5">
        {error && <ErrorBanner>{error}</ErrorBanner>}

        {stage === "idle" ? (
          <>
            <Field label="New email address">
              <Input
                id="new-email"
                type="email"
                autoComplete="email"
                value={newEmail}
                onChange={(ev) => setNewEmail(ev.target.value)}
                placeholder={role === "student" ? "you@imperial.ac.uk" : "you@example.com"}
                required
              />
            </Field>

            <Field label="Confirm new email address">
              <Input
                id="confirm-email"
                type="email"
                autoComplete="off"
                value={confirmEmail}
                onChange={(ev) => setConfirmEmail(ev.target.value)}
                placeholder="Type it again"
                required
              />
            </Field>
          </>
        ) : (
          <>
            <div>
              <Field label="Code sent to your old email address">
                <Input
                  id="code-current"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={codeCurrent}
                  onChange={(ev) => setCodeCurrent(ev.target.value.replace(/\D/g, ""))}
                  className={codeCls}
                  placeholder="000000"
                  disabled={currentConfirmed}
                  required={!currentConfirmed}
                />
              </Field>
              {currentConfirmed && (
                <p className="mt-2 flex items-center gap-2 text-small text-accent-light">
                  <Icon name="check" size={16} />
                  Confirmed. Only the code sent to your new address is still needed.
                </p>
              )}
            </div>

            <Field label="Code sent to your new email address">
              <Input
                id="code-new"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={codeNew}
                onChange={(ev) => setCodeNew(ev.target.value.replace(/\D/g, ""))}
                className={codeCls}
                placeholder="000000"
                required
              />
            </Field>

            {/* An unrequested email change is an account-takeover signal, so the
                way out has to be on the screen at the moment it is noticed. */}
            <p className="text-small leading-relaxed text-text-muted">
              Didn&apos;t ask for this? Don&apos;t enter the codes —{" "}
              <Link href="/contact" className="text-accent-light underline underline-offset-2">
                contact the team
              </Link>{" "}
              and we&apos;ll secure the account.
            </p>
          </>
        )}

        <div>
          <Button type="submit" loading={isLoading} variant="primary" size="md">
            {stage === "idle" ? "Send codes" : "Confirm change"}
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}

/**
 * Is this the "that address already has an account" failure?
 *
 * GoTrue answers a change to a registered address with 422 `email_exists`
 * — "A user with this email address has already been registered". Showing
 * that is a user-enumeration oracle: any signed-in member could test
 * addresses one at a time and learn which are registered, one guess per
 * attempt.
 *
 * resetPasswordForEmail is deliberately anti-enumeration — it reports the
 * same outcome whether or not the account exists — and this flow now
 * matches it. A taken address advances to the code screen exactly as a
 * free one does. No codes were sent, so the change cannot complete, and
 * the two cases are indistinguishable from the outside.
 *
 * Nothing is lost by staying quiet: on this error GoTrue sent no mail and
 * wrote no pending change, so the account is untouched either way. The
 * member whose typo landed on a real address sees the same "start again"
 * route out as one whose codes went astray.
 *
 * Matched on the error code, with the message as a fallback in case a
 * GoTrue version omits the code.
 */
function isEmailTaken(err: { code?: string; message: string }): boolean {
  if (err.code === "email_exists") return true;
  return /already (been )?registered|already exists/i.test(err.message);
}

/**
 * Friendly copy for a failed code.
 *
 * GoTrue answers a wrong code and a stale one with the same string —
 * "Token has expired or is invalid" — so splitting them into separate
 * messages means guessing, and guessing "expired" tells someone who just
 * mistyped to start over when they only needed to retype. One message
 * that covers both is the honest version. `which` is named because two
 * code fields are on screen and "that code is incorrect" no longer says
 * which one to look at.
 */
function friendlyCodeError(raw: string, which: "old" | "new"): string {
  const e = raw.toLowerCase();
  const field = which === "old" ? "old" : "new";
  if (e.includes("rate") || e.includes("too many")) {
    return "Too many attempts. Wait a moment and try again.";
  }
  if (e.includes("expired") || e.includes("invalid") || e.includes("token")) {
    return `The code for your ${field} email address is incorrect or has expired. Check it, or start again to get a new pair.`;
  }
  return `We couldn't verify the code for your ${field} email address. Please try again.`;
}
