"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MAX_NAME_LENGTH } from "@/lib/text";
import { SignupDisclosures } from "@/components/forms/SignupDisclosures";
import { TurnstileWidget } from "@/components/forms/TurnstileWidget";
import { turnstileConfigured } from "@/lib/turnstileConfig";
import Starfield from "@/components/Starfield";
import { destinationForStatus } from "@/lib/auth/status";
import { safeNextPath } from "@/lib/auth/safeNextPath";
import { Button } from "@/components/ui/Button";
import { ButtonTabs } from "@/components/ui/Tabs";
import { Divider } from "@/components/ui/Divider";
import { FormSection } from "@/components/ui/FormSection";
import { Input } from "@/components/ui/Input";
import { PageHead } from "@/components/ui/PageHead";
import { Select } from "@/components/ui/Select";
import { StepDots, type StepItem } from "@/components/ui/StepDots";
import { ErrorBanner } from "@/components/forms/Banners";
import { Field, FieldError } from "@/components/forms/Field";
import { Disc } from "@/design-system/icons/Disc";
import { Glyph } from "@/design-system/icons/Glyph";
import { Icon } from "@/design-system/icons/Icon";
import { Roundel } from "@/design-system/logo/Roundel";
import { AFFILIATIONS, NON_STUDENT_AFFILIATIONS, type Affiliation } from "@/lib/intake/steps";
import { friendlyAuthError } from "@/lib/auth/hooks/authErrorText";
import { useStudentAuth } from "@/lib/auth/hooks/useStudentAuth";
import { useAlumAuth } from "@/lib/auth/hooks/useAlumAuth";
import { useGoogleAuth } from "@/lib/auth/hooks/useGoogleAuth";
import { usePasswordRecovery } from "@/lib/auth/hooks/usePasswordRecovery";
import type { Mode, Role, Track } from "@/lib/auth/hooks/loginTypes";
import { track as trackEvent } from "@/lib/analytics/track";
import { Trail } from "@/components/ui/Trail";

/* ── The sky ──────────────────────────────────────────────────────── */
// The starfield is the one background this brand owns: the mark sits in the sky
// rather than on a picture of one, and it makes /login continuous with the hero.
// The page draws no background of its own, so the atmosphere (the warm core and
// the dust behind every page) shows through it.
function BackgroundEffects() {
  return <Starfield className="pointer-events-none absolute inset-0 h-full w-full" />;
}

/* ── Google icon ──────────────────────────────────────────────────── */
// A third-party mark with its own four brand colours: the one literal-colour
// drawing left in the product. It does not go through <Icon>.
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" />
      <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.547 0 9s.348 2.827.957 4.042l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
  );
}

/* ── ?role= link handling ─────────────────────────────────────────── */
// admin_delete_graduates emails every graduating student a link to
// /login?role=alum. That parameter has never been read — graduates landed
// on the chooser and picked manually, which was survivable with two
// options and is a mis-pick waiting to happen with six.
//
// 'student' is deliberately not honoured: that path needs a verified
// Imperial address and an OTP, and nothing links to it.
function getLinkedRole(searchParams: URLSearchParams): Affiliation | null {
  // react-doctor-disable-next-line react-doctor/url-prefilled-privileged-action -- reviewed: no privileged action is triggered directly from this URL param
  const r = searchParams.get("role");
  const valid = AFFILIATIONS.some((a) => a.value === r && a.value !== "student");
  return valid ? (r as Affiliation) : null;
}

/* ── Page ─────────────────────────────────────────────────────────── */
// Mode/Role/Track live in lib/auth/hooks/loginTypes.ts, shared with the
// four auth-flow hooks below.

export default function LoginClient() {
  const router = useRouter();
  const supabase = createClient();

  const [mode, setMode] = useState<Mode>("signup");

  const searchParams = useSearchParams();
  const linkedRole = getLinkedRole(searchParams);
  const [role, setRole] = useState<Role>(linkedRole);
  // A ?role= link skips the chooser and lands on the form with the dropdown
  // already set, which is what keeps the graduation handoff working.
  const [track, setTrack] = useState<Track | null>(linkedRole ? "other" : null);

  // Alum form fields
  const [firstName, setFirstName] = useState("");
  const [surname, setSurname] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [tcAgreed, setTcAgreed] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  // On-screen OTP code entry (replaces the emailed magic link — Microsoft 365
  // Safe Links pre-fetches link URLs and burns the single-use token, so codes
  // are the only reliable path for our Imperial mail audience).
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");

  // Cloudflare Turnstile for the auth send-endpoints (sign-in / sign-up /
  // resend / password reset). Login talks to Supabase directly from the
  // browser, so we use Supabase's native captcha: pass options.captchaToken and
  // GoTrue verifies it server-side. A token is single-use, so after each send
  // we bump turnstileNonce, which remounts the widget (via its key) to issue a
  // fresh token for the next send/resend. Inert unless both the public site key
  // (widget) and the dashboard captcha setting are configured.
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileNonce, setTurnstileNonce] = useState(0);
  const refreshTurnstile = () => {
    setTurnstileToken("");
    setTurnstileNonce((n) => n + 1);
  };

  // Tick the resend cooldown to 0 once per second when active.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  // The /auth/callback route bounces failed OAuth attempts back here with
  // ?error=...; read it on mount (not during render — that would cause
  // a hydration mismatch since the server never sees window.location),
  // then strip it from the URL so a refresh doesn't re-show.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const e = params.get("error");
    if (!e) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(friendlyAuthError(e));
    const url = new URL(window.location.href);
    url.searchParams.delete("error");
    window.history.replaceState({}, "", url.toString());
  }, []);

  // Sign-in successful — route by admin status + profile state. Shares the
  // status mapping with /auth/callback and /auth/confirm so email and OAuth
  // paths can't drift apart. Fail-closed: any RPC/lookup failure sends them
  // to '/' rather than risk wrong-routing.
  const routeAfterSignIn = async () => {
    // Shared by every flow (student OTP, alum password, Google OAuth) that
    // reaches a session, so this one call site covers the whole auth funnel
    // rather than needing a capture in each of the four hooks above.
    trackEvent("auth_completed", { mode, track });

    // Tried first, ahead of the admin/status branching below: whichever
    // page sent the member to /login still runs the same guard on the way
    // back, so an approved-only or admin-only "next" that this member
    // shouldn't see re-redirects them correctly from there. This is just
    // "try to go back", not a second copy of the access decision.
    const next = safeNextPath(searchParams.get("next"), window.location.origin);
    if (next) {
      router.replace(next);
      router.refresh();
      return;
    }

    const { data: isAdmin } = await supabase.rpc("is_admin");
    if (isAdmin) {
      router.replace("/admin");
      router.refresh();
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/");
      router.refresh();
      return;
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", user.id)
      .single();
    router.replace(destinationForStatus(profile?.status));
    router.refresh();
  };

  const resetForm = () => {
    setFirstName("");
    setSurname("");
    setEmail("");
    setPassword("");
    setRepeatPassword("");
    setError("");
    setEmailSent(false);
    setResendCooldown(0);
    setTcAgreed(false);
    setForgotSent(false);
    setCode("");
    setVerifying(false);
    setVerifyError("");
    refreshTurnstile();
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setTrack(null);
    setRole(null);
    resetForm();
  };

  const backToChooser = () => {
    setTrack(null);
    setRole(null);
    resetForm();
  };

  // Each flow's send/verify/resend handlers live in their own hook —
  // lib/auth/hooks/use{Student,Alum,Google}Auth.ts and usePasswordRecovery —
  // split out of this component so the ~450-line handler section that used
  // to live here reads (and changes) by flow instead of as one block. State
  // stays here, since mode/track/role switching has to coordinate resets
  // across all four flows at once.
  const sharedHandlerState = {
    supabase,
    isLoading, resendCooldown, turnstileToken,
    setError, setIsLoading, setEmailSent, setResendCooldown,
    setVerifying, setVerifyError, refreshTurnstile, routeAfterSignIn,
  };

  const { handleStudentSubmit, handleStudentResend, handleStudentVerify } = useStudentAuth({
    ...sharedHandlerState,
    mode, email, firstName, surname, tcAgreed, code,
  });

  const { handleAlumResend, handleAlumVerify, handleAlumSubmit } = useAlumAuth({
    ...sharedHandlerState,
    mode, role, firstName, surname, email, password, repeatPassword, tcAgreed, code,
  });

  const { handleGoogle } = useGoogleAuth({ supabase, setError, setIsLoading });

  const { handleForgotPassword, exitForgot } = usePasswordRecovery({
    supabase, email, isLoading, resendCooldown, turnstileToken,
    setError, setIsLoading, setForgotSent, setResendCooldown, refreshTurnstile,
  });

  return (
    // No background of its own: the atmosphere is the night behind every page. (overflow-x-clip, not -hidden: a hidden overflow is a scroll
    // container, and the mark's `sticky` would then stick to this box instead of the screen.)
    <div className="relative flex min-h-screen flex-col overflow-x-clip">
      <BackgroundEffects />

      {/* Below a desktop the mark is the roundel alone at the top (48 px); from lg up it is the big one beside the form. */}
      <header className="relative z-10 px-[var(--gutter)] py-5 lg:hidden">
        <Link href="/" className="inline-block no-underline">
          <Roundel size={48} label="Imperial Entrepreneurs" className="text-star" />
        </Link>
      </header>

      {/* Main */}
      <main id="main-content" tabIndex={-1} className="relative z-10 flex flex-1 items-center justify-center px-[var(--gutter)] pb-10 pt-2 lg:py-12">
        <div className="flex w-full items-center justify-center gap-[clamp(3rem,8vw,8rem)]">
          <AuthMark />

          <div className="w-full max-w-[460px]">
            <AuthHeading mode={mode} track={track} />

            {/* Card. The Sign up / Log in switch sits at its head: returning users kept
                missing the small "Already have an account? Sign in" link at the foot, so
                the mode switch is offered here as two buttons too; the foot link stays
                for anyone who scrolls down expecting it there. */}
            <FormSection className="mt-6">
              <ModeToggle mode={mode} onSwitch={switchMode} />

              {/* Error */}
              {error && <ErrorBanner>{error}</ErrorBanner>}

              <AuthCardBody
                mode={mode} track={track}
                role={role} setRole={setRole}
                firstName={firstName} setFirstName={setFirstName}
                surname={surname} setSurname={setSurname}
                email={email} setEmail={setEmail}
                password={password} setPassword={setPassword}
                repeatPassword={repeatPassword} setRepeatPassword={setRepeatPassword}
                emailSent={emailSent}
                resendCooldown={resendCooldown}
                isLoading={isLoading}
                tcAgreed={tcAgreed} setTcAgreed={setTcAgreed}
                forgotSent={forgotSent}
                code={code} setCode={setCode}
                verifying={verifying} verifyError={verifyError}
                onPickTrack={(t) => {
                  setTrack(t);
                  // The student path writes role: "student" itself; keeping
                  // the state in step means nothing downstream has to know
                  // which of the two set it.
                  setRole(t === "student" ? "student" : null);
                  setError("");
                }}
                onStudentVerify={handleStudentVerify}
                onStudentSubmit={handleStudentSubmit}
                onStudentResend={handleStudentResend}
                onAlumVerify={handleAlumVerify}
                onAlumSubmit={handleAlumSubmit}
                onAlumResend={handleAlumResend}
                onGoogle={handleGoogle}
                onForgot={handleForgotPassword}
                onForgotReset={exitForgot}
                onBack={backToChooser}
              />

              {/* Bot challenge for the auth send-endpoints. One widget for every
                  sub-view (request / resend / forgot); remounts via key to mint a
                  fresh single-use token after each send. Renders nothing unless
                  the public site key is set. */}
              {turnstileConfigured && track !== null && (
                <div className="flex justify-center">
                  <TurnstileWidget key={turnstileNonce} onToken={setTurnstileToken} />
                </div>
              )}

              {/* Toggle */}
              <div className="border-t border-border-subtle pt-5 text-center">
                <p className="text-body text-text-muted">
                  {mode === "signup" ? "Already have an account?" : "Don't have an account?"}{" "}
                  <Button
                    type="button"
                    variant="quiet"
                    size="sm"
                    onClick={() => switchMode(mode === "signup" ? "signin" : "signup")}
                  >
                    {mode === "signup" ? "Sign in" : "Sign up"}
                  </Button>
                </p>
              </div>
            </FormSection>
          </div>
        </div>
      </main>

      <AuthFooter />
    </div>
  );
}

/* ── The mark, and the foot ───────────────────────────────────────── */
// From a desktop up the roundel stands beside the form, large, in the warm light the atmosphere
// already puts behind the mark: the page's presence, with no words added. It breathes (slowly, and
// not at all under reduced motion). It sits at the head of the row and, on a long form, stays in view
// as the page scrolls. Below lg the header carries the small one instead.
function AuthMark() {
  return (
    <Link href="/" className="sticky top-[max(1.5rem,calc(50svh-9rem))] hidden shrink-0 self-start place-items-center no-underline lg:grid">
      <span aria-hidden="true" className="anim-breathe absolute -inset-1/3 rounded-full bg-lit-glow blur-3xl" />
      <Roundel size={208} label="Imperial Entrepreneurs" className="relative text-star" />
    </Link>
  );
}

const FOOT_LINK = "inline-flex min-h-[var(--touch)] items-center px-3 text-small text-text-secondary no-underline transition-colors duration-150 hover:text-text-primary";

function AuthFooter() {
  return (
    <footer className="relative z-10 px-[var(--gutter)] pb-6">
      <div className="mx-auto flex max-w-[1200px] flex-wrap justify-center gap-x-4">
        <Link href="/privacy" className={FOOT_LINK}>
          Privacy
        </Link>
        <Link href="/terms" className={FOOT_LINK}>
          Terms
        </Link>
        <Link href="/contact" className={FOOT_LINK}>
          Contact
        </Link>
      </div>
    </footer>
  );
}

/* ── Heading + subtitle ───────────────────────────────────────────── */
// The page's opening is PageHead: the way back is its trail, the h1 is the title, the line under it is
// the lede. The emphasis is a weight step inside one face, not a colour change into a serif italic.
function AuthHeading({ mode, track }: { mode: Mode; track: Track | null }) {
  const heading =
    mode === "signup" ? (
      <><span className="text-text-secondary">Join the </span><span className="font-normal">Foundry.</span></>
    ) : (
      <><span className="text-text-secondary">Welcome </span><span className="font-normal">back.</span></>
    );

  const subtitle =
    track === null
      ? mode === "signup"
        ? "Tell us how you're connected to Imperial."
        : "Tell us how you sign in."
      : track === "student"
        ? mode === "signup"
          ? "We'll email a verification code to your Imperial email."
          : "Enter your Imperial email and we'll email you a sign-in code."
        : mode === "signup"
          ? "Your profile will be manually reviewed before access is granted."
          : "Sign in with your email and password.";

  return (
    <PageHead
      context={<Trail href="/" label="Back to home" />}
      title={heading}
      lede={subtitle}
    />
  );
}

/* ── Sign up / Log in toggle ──────────────────────────────────────── */
const MODES: readonly { value: Mode; label: string }[] = [
  { value: "signup", label: "Sign up" },
  { value: "signin", label: "Log in" },
];

function ModeToggle({ mode, onSwitch }: { mode: Mode; onSwitch: (next: Mode) => void }) {
  return <ButtonTabs variant="segmented" fill items={MODES} value={mode} onSelect={onSwitch} />;
}

/* ── Card body (chooser / student / alum) ─────────────────────────── */
// Pulled out of LoginClient's render so the mode/track branching reads as
// one block instead of being interleaved with the toggle/turnstile/footer
// markup around it. Props are the same ones each branch already took.
function AuthCardBody({
  mode, track,
  role, setRole,
  firstName, setFirstName,
  surname, setSurname,
  email, setEmail,
  password, setPassword,
  repeatPassword, setRepeatPassword,
  emailSent, resendCooldown, isLoading,
  tcAgreed, setTcAgreed,
  forgotSent,
  code, setCode, verifying, verifyError,
  onPickTrack,
  onStudentVerify, onStudentSubmit, onStudentResend,
  onAlumVerify, onAlumSubmit, onAlumResend,
  onGoogle, onForgot, onForgotReset, onBack,
}: {
  mode: Mode; track: Track | null;
  role: Role; setRole: (v: Role) => void;
  firstName: string; setFirstName: (v: string) => void;
  surname: string; setSurname: (v: string) => void;
  email: string; setEmail: (v: string) => void;
  password: string; setPassword: (v: string) => void;
  repeatPassword: string; setRepeatPassword: (v: string) => void;
  emailSent: boolean;
  resendCooldown: number;
  isLoading: boolean;
  tcAgreed: boolean; setTcAgreed: (v: boolean) => void;
  forgotSent: boolean;
  code: string; setCode: (v: string) => void;
  verifying: boolean; verifyError: string;
  onPickTrack: (t: Track) => void;
  onStudentVerify: (e: React.FormEvent) => void;
  onStudentSubmit: (e: React.FormEvent) => void;
  onStudentResend: () => void;
  onAlumVerify: (e: React.FormEvent) => void;
  onAlumSubmit: (e: React.FormEvent) => void;
  onAlumResend: () => void;
  onGoogle: () => void;
  onForgot: () => void;
  onForgotReset: () => void;
  onBack: () => void;
}) {
  if (track === null) {
    return <Chooser mode={mode} onPick={onPickTrack} />;
  }

  if (track === "student") {
    return (
      <StudentMagicLinkFlow
        mode={mode}
        firstName={firstName} setFirstName={setFirstName}
        surname={surname} setSurname={setSurname}
        email={email} setEmail={setEmail}
        emailSent={emailSent}
        isLoading={isLoading}
        resendCooldown={resendCooldown}
        tcAgreed={tcAgreed} setTcAgreed={setTcAgreed}
        code={code} setCode={setCode}
        verifying={verifying} verifyError={verifyError}
        onVerify={onStudentVerify}
        onSubmit={onStudentSubmit}
        onResend={onStudentResend}
        onBack={onBack}
      />
    );
  }

  return (
    <AlumForm
      mode={mode}
      role={role} setRole={setRole}
      firstName={firstName} setFirstName={setFirstName}
      surname={surname} setSurname={setSurname}
      email={email} setEmail={setEmail}
      password={password} setPassword={setPassword}
      repeatPassword={repeatPassword} setRepeatPassword={setRepeatPassword}
      emailSent={emailSent}
      resendCooldown={resendCooldown}
      isLoading={isLoading}
      tcAgreed={tcAgreed} setTcAgreed={setTcAgreed}
      forgotSent={forgotSent}
      code={code} setCode={setCode}
      verifying={verifying} verifyError={verifyError}
      onVerify={onAlumVerify}
      onSubmit={onAlumSubmit}
      onResend={onAlumResend}
      onGoogle={onGoogle}
      onForgot={onForgot}
      onForgotReset={onForgotReset}
      onBack={onBack}
    />
  );
}

/* ── Chooser ──────────────────────────────────────────────────────── */
// Two doors, not six.
//
// The old chooser laid out all six affiliations as equal cards, which made
// the reader distinguish "Recent graduate" from "Alumni founder" before
// they had any reason to care — and on this page that difference decides
// nothing: both take the identical password-plus-review path. Six near
// identical boxes are read by scanning, not by knowing, so the fine print
// was doing the work the layout should have done.
//
// These two are the fork that actually exists in the code below. Which of
// the five someone is moves onto the form, where it is a declaration for
// the reviewing admin rather than a branch.
function Chooser({ mode, onPick }: { mode: Mode; onPick: (t: Track) => void }) {
  return (
    <div className="grid gap-3">
      <Door
        glyph="book"
        title="Current student"
        blurb={
          mode === "signup"
            ? "Undergrad, postgrad or PhD. Verified by your Imperial email."
            : undefined
        }
        onClick={() => onPick("student")}
      />
      <Door
        glyph="lighthouse"
        title="Alum, mentor, investor or staff"
        blurb={
          mode === "signup"
            ? "Everyone else. Your profile will be verified by an admin."
            : undefined
        }
        onClick={() => onPick("other")}
      />
    </div>
  );
}

// A door is one button that holds all of its words (so its name is the title and the blurb, as before), drawn as an Entry row:
// the identity glyph in its ring (which lights as the row is pointed at), the title, the line under it, an arrow that moves on.
function Door({ glyph, title, blurb, onClick }: { glyph: "book" | "lighthouse"; title: string; blurb?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-glyph=""
      className="lm-entry group w-full cursor-pointer border border-border-strong bg-tint-1 text-left transition-colors duration-150 hover:border-lit-line hover:bg-tint-2"
    >
      <span className="lm-disc">
        <Glyph name={glyph} ring={false} size={28} />
      </span>
      <span className="min-w-0">
        <span className="lm-entry__title block">{title}</span>
        {blurb && <span className="lm-entry__meta block">{blurb}</span>}
      </span>
      <Icon name="arrow-right" size={16} className="text-text-muted transition-[color,transform] duration-150 group-hover:translate-x-0.5 group-hover:text-text-primary" />
    </button>
  );
}

/* ── Shared first-name/surname fields ─────────────────────────────── */
// Identical in both signup forms (student + alum) — pulled out once so the
// two are kept in step rather than hand-edited in parallel.
function NameFields({
  firstName, setFirstName, surname, setSurname,
}: {
  firstName: string; setFirstName: (v: string) => void;
  surname: string; setSurname: (v: string) => void;
}) {
  return (
    <div className="grid gap-5 min-[360px]:grid-cols-2">
      <Field label="First name">
        <Input
          id="first-name"
          type="text"
          autoComplete="given-name"
          placeholder="First name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          maxLength={MAX_NAME_LENGTH}
        />
      </Field>
      <Field label="Surname">
        <Input
          id="surname"
          type="text"
          autoComplete="family-name"
          placeholder="Surname"
          value={surname}
          onChange={(e) => setSurname(e.target.value)}
          maxLength={MAX_NAME_LENGTH}
        />
      </Field>
    </div>
  );
}

/* ── Back link, and where you are in a flow that sends a code or a link ───── */
// The way back is a ghost button with a drawn arrow; the arrow character stays in its name as hidden text, as it was.
// A flow that ends in an inbox shows where you are as dots at the other end of the row (the words are read, not drawn).
function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick} leading={<Icon name="arrow-left" size={16} />}>
      <span className="sr-only">← </span>Back
    </Button>
  );
}

const CODE_STEPS: readonly StepItem[] = [
  { id: "details", label: "Your details" },
  { id: "code", label: "Your code" },
];

// The same three marks run across /login and /reset-password, so asking for a link, opening it and choosing a password read as one flow.
// (/reset-password is the third; it carries its own copy of this list.)
const RECOVERY_STEPS: readonly StepItem[] = [
  { id: "request", label: "Request a link" },
  { id: "inbox", label: "Open the link" },
  { id: "password", label: "Choose a password" },
];

function FlowHead({
  onBack, steps, current, label,
}: {
  onBack: () => void;
  steps?: readonly StepItem[];
  current?: string;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <BackLink onClick={onBack} />
      {steps && current && label ? <StepDots steps={steps} current={current} label={label} /> : null}
    </div>
  );
}

/* ── Shared OTP code-entry panel ──────────────────────────────────── */
// Shown after an email code is sent (student sign-in/up + alum signup). The
// user types the 6-digit code; onVerify runs the flow-specific verifyOtp.
function CodeEntryPanel({
  mode, email, code, setCode, verifying, verifyError,
  resendCooldown, isLoading, onVerify, onResend, onBack, showGoogleHint,
}: {
  mode: Mode;
  email: string;
  code: string; setCode: (v: string) => void;
  verifying: boolean; verifyError: string;
  resendCooldown: number; isLoading: boolean;
  onVerify: (e: React.FormEvent) => void;
  onResend: () => void;
  onBack: () => void;
  /** Alum signup only: GoTrue's anti-enumeration design shows this same panel,
   *  with no code ever sent, for an address that already has a Google-only
   *  account — nothing else on this screen says so. */
  showGoogleHint?: boolean;
}) {
  const canResend = resendCooldown <= 0 && !isLoading && !verifying;
  return (
    <div className="grid gap-5">
      <FlowHead onBack={onBack} steps={CODE_STEPS} current="code" label={mode === "signup" ? "Sign-up progress" : "Sign-in progress"} />
      <form onSubmit={onVerify} className="grid justify-items-center gap-4 py-2 text-center">
        <Disc size="lg">
          <Icon name="mail" size={24} />
        </Disc>
        <h2 className="font-display text-title text-text-primary">Enter your code</h2>
        <p className="text-body text-text-secondary">
          We emailed a 6-digit code to <span className="text-text-primary">{email}</span>. Enter it below to {mode === "signup" ? "finish signing up" : "sign in"}.
        </p>

        <div className="w-full">
          <label htmlFor="otp-code" className="sr-only">Verification code</label>
          {/* react-doctor-disable-next-line react-doctor/no-autofocus -- OTP input shown only after user-initiated email submit, not on page load; interaction-triggered autofocus */}
          <Input
            id="otp-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d*"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            autoFocus
            invalid={Boolean(verifyError)}
            className="data text-center text-heading font-medium tracking-[0.4em] placeholder:tracking-[0.4em]"
          />
        </div>

        {verifyError && (
          <div className="w-full [&>p]:justify-center">
            <FieldError>{verifyError}</FieldError>
          </div>
        )}

        <Button
          type="submit"
          loading={verifying}
          disabled={code.length !== 6 || verifying}
          variant="primary"
          size="lg"
          className="w-full"
        >
          Verify
        </Button>

        <p className="text-small text-text-muted">
          The code expires in 30 minutes. Check your spam folder if it doesn&apos;t arrive within a minute.
        </p>
        {showGoogleHint && (
          <p className="text-small text-text-muted">
            No code arriving? Signed up with Google before? Use <span className="text-text-secondary">Continue with Google</span> instead.
          </p>
        )}
        <Button type="button" variant="quiet" size="sm" onClick={onResend} disabled={!canResend}>
          {isLoading
            ? "Resending…"
            : resendCooldown > 0
              ? `Resend in ${resendCooldown}s`
              : "Didn’t receive it? Resend"}
        </Button>
      </form>
    </div>
  );
}

/* ── Student verification-link flow ───────────────────────────────── */
function StudentMagicLinkFlow({
  mode,
  firstName, setFirstName,
  surname, setSurname,
  email, setEmail,
  emailSent, isLoading, resendCooldown,
  tcAgreed, setTcAgreed,
  code, setCode, verifying, verifyError,
  onVerify, onSubmit, onResend, onBack,
}: {
  mode: Mode;
  firstName: string; setFirstName: (v: string) => void;
  surname: string; setSurname: (v: string) => void;
  email: string; setEmail: (v: string) => void;
  emailSent: boolean;
  isLoading: boolean;
  resendCooldown: number;
  tcAgreed: boolean; setTcAgreed: (v: boolean) => void;
  code: string; setCode: (v: string) => void;
  verifying: boolean; verifyError: string;
  onVerify: (e: React.FormEvent) => void;
  onSubmit: (e: React.FormEvent) => void;
  onResend: () => void;
  onBack: () => void;
}) {
  if (emailSent) {
    return (
      <CodeEntryPanel
        mode={mode}
        email={email}
        code={code} setCode={setCode}
        verifying={verifying} verifyError={verifyError}
        resendCooldown={resendCooldown} isLoading={isLoading}
        onVerify={onVerify} onResend={onResend} onBack={onBack}
      />
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <FlowHead onBack={onBack} steps={CODE_STEPS} current="details" label={mode === "signup" ? "Sign-up progress" : "Sign-in progress"} />

      {mode === "signup" && (
        <NameFields
          firstName={firstName} setFirstName={setFirstName}
          surname={surname} setSurname={setSurname}
        />
      )}

      <div>
        <Field label="Imperial email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@imperial.ac.uk"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <p className="mt-2 text-small text-text-muted">
          Must end in @imperial.ac.uk or @ic.ac.uk.
        </p>
      </div>

      {mode === "signup" && (
        <SignupDisclosures agreed={tcAgreed} onChange={setTcAgreed} />
      )}

      <Button
        type="submit"
        loading={isLoading}
        disabled={isLoading || (mode === "signup" && !tcAgreed)}
        variant="primary"
        size="lg"
        className="w-full"
      >
        {mode === "signup" ? "Send verification code" : "Send sign-in code"}
      </Button>
    </form>
  );
}

/* ── Alum form ────────────────────────────────────────────────────── */
function AlumForm({
  mode,
  role, setRole,
  firstName, setFirstName,
  surname, setSurname,
  email, setEmail,
  password, setPassword,
  repeatPassword, setRepeatPassword,
  emailSent, resendCooldown,
  isLoading,
  tcAgreed, setTcAgreed,
  forgotSent,
  code, setCode, verifying, verifyError, onVerify,
  onSubmit, onResend, onGoogle, onForgot, onForgotReset, onBack,
}: {
  mode: Mode;
  /** The affiliation being declared. Signup only — sign-in doesn't care
   *  which of the five you are, only that you use a password. */
  role: Role; setRole: (v: Role) => void;
  firstName: string; setFirstName: (v: string) => void;
  surname: string; setSurname: (v: string) => void;
  email: string; setEmail: (v: string) => void;
  password: string; setPassword: (v: string) => void;
  repeatPassword: string; setRepeatPassword: (v: string) => void;
  emailSent: boolean;
  resendCooldown: number;
  isLoading: boolean;
  tcAgreed: boolean; setTcAgreed: (v: boolean) => void;
  forgotSent: boolean;
  code: string; setCode: (v: string) => void;
  verifying: boolean; verifyError: string;
  onVerify: (e: React.FormEvent) => void;
  onSubmit: (e: React.FormEvent) => void;
  onResend: () => void;
  onGoogle: () => void;
  onForgot: () => void;
  onForgotReset: () => void;
  onBack: () => void;
}) {
  const [forgotView, setForgotView] = useState(false);

  // After signup, "Confirm email" requires the alum to verify before they have
  // a session. Show the shared code-entry panel; the resend re-sends the signup
  // confirmation (type "signup").
  if (emailSent) {
    return (
      <CodeEntryPanel
        mode={mode}
        email={email}
        code={code} setCode={setCode}
        verifying={verifying} verifyError={verifyError}
        resendCooldown={resendCooldown} isLoading={isLoading}
        onVerify={onVerify} onResend={onResend} onBack={onBack}
        showGoogleHint={mode === "signup"}
      />
    );
  }

  // Password-recovery sub-view (sign-in only). Sends a PKCE reset link to the
  // entered email; it lands on /auth/callback?next=/reset-password.
  if (forgotView) {
    const backToSignIn = () => { onForgotReset(); setForgotView(false); };
    return (
      <ForgotPasswordFlow
        email={email} setEmail={setEmail}
        resendCooldown={resendCooldown} isLoading={isLoading}
        forgotSent={forgotSent}
        onForgot={onForgot}
        onBack={backToSignIn}
      />
    );
  }

  const selected = NON_STUDENT_AFFILIATIONS.find((a) => a.value === role);

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      {/* Signing up ends in an inbox (a code), so it shows where you are; signing in with a password does not. */}
      <FlowHead
        onBack={onBack}
        steps={mode === "signup" ? CODE_STEPS : undefined}
        current="details"
        label="Sign-up progress"
      />

      {/* First field, above the sign-up controls, because it is the thing
          the chooser stopped asking. The blurb below it carries the wording
          the six cards used to, so nothing that helped someone place
          themselves was lost in the collapse — it is just no longer six
          simultaneous walls of text. */}
      {mode === "signup" && (
        <AffiliationSelect role={role} setRole={setRole} selected={selected} />
      )}

      <GoogleSignupSection
        mode={mode} role={role} selected={selected}
        isLoading={isLoading} onGoogle={onGoogle}
      />

      {mode === "signup" && (
        <NameFields
          firstName={firstName} setFirstName={setFirstName}
          surname={surname} setSurname={setSurname}
        />
      )}

      <Field label="Email">
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      <PasswordFields
        mode={mode}
        password={password} setPassword={setPassword}
        repeatPassword={repeatPassword} setRepeatPassword={setRepeatPassword}
        onForgotClick={() => { onForgotReset(); setForgotView(true); }}
      />

      {mode === "signup" && (
        <SignupDisclosures agreed={tcAgreed} onChange={setTcAgreed} />
      )}

      <Button
        type="submit"
        loading={isLoading}
        disabled={isLoading || (mode === "signup" && !tcAgreed)}
        variant="primary"
        size="lg"
        className="w-full"
      >
        {mode === "signup" ? "Create account" : "Sign in"}
      </Button>
    </form>
  );
}

/* ── Password-recovery sub-view ───────────────────────────────────── */
function ForgotPasswordFlow({
  email, setEmail, resendCooldown, isLoading, forgotSent, onForgot, onBack,
}: {
  email: string; setEmail: (v: string) => void;
  resendCooldown: number; isLoading: boolean;
  forgotSent: boolean;
  onForgot: () => void;
  onBack: () => void;
}) {
  if (forgotSent) {
    const canSend = resendCooldown <= 0 && !isLoading;
    return (
      <div className="grid gap-5">
        <FlowHead onBack={onBack} steps={RECOVERY_STEPS} current="inbox" label="Password reset progress" />
        <div className="grid justify-items-center gap-4 py-4 text-center">
          <Disc size="lg">
            <Icon name="mail" size={24} />
          </Disc>
          <h2 className="font-display text-title text-text-primary">Check your inbox</h2>
          <p className="text-body text-text-secondary">
            If an account exists for <span className="text-text-primary">{email}</span>, we&apos;ve sent a password-reset link.
          </p>
          <p className="text-small text-text-muted">
            The link expires in 30 minutes. Open it in the same browser you&apos;re using now.
          </p>
          <Button type="button" variant="quiet" size="sm" onClick={onForgot} disabled={!canSend}>
            {isLoading
              ? "Resending…"
              : resendCooldown > 0
                ? `Resend in ${resendCooldown}s`
                : "Didn’t receive it? Resend"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); onForgot(); }} className="grid gap-5">
      <FlowHead onBack={onBack} steps={RECOVERY_STEPS} current="request" label="Password reset progress" />
      <div className="grid gap-2">
        <h2 className="font-display text-title text-text-primary">Reset your password</h2>
        <p className="text-body text-text-secondary">
          Enter your email and we&apos;ll send you a link to set a new password.
        </p>
      </div>
      <Field label="Email">
        <Input
          id="reset-email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Button
        type="submit"
        loading={isLoading}
        disabled={resendCooldown > 0 || isLoading}
        variant="primary"
        size="lg"
        className="w-full"
      >
        {resendCooldown > 0 ? (
          `Resend in ${resendCooldown}s`
        ) : (
          "Send reset link"
        )}
      </Button>
      <p className="px-2 text-center text-small text-text-muted">
        Signed up with Google? Use <span className="text-text-secondary">Continue with Google</span> instead.
      </p>
    </form>
  );
}

/* ── Affiliation dropdown (alum signup only) ──────────────────────── */
function AffiliationSelect({
  role, setRole, selected,
}: {
  role: Role; setRole: (v: Role) => void;
  selected: { value: string; label: string; blurb: string } | undefined;
}) {
  return (
    <div>
      <Field label="How you're connected">
        <Select
          id="affiliation"
          value={role ?? ""}
          onChange={(e) => setRole((e.target.value || null) as Role)}
        >
          <option value="">Select one…</option>
          {NON_STUDENT_AFFILIATIONS.map((a) => (
            <option key={a.value} value={a.value}>{a.label}</option>
          ))}
        </Select>
      </Field>
      {selected && (
        <p className="mt-2 text-small text-text-muted">
          {selected.blurb}
        </p>
      )}
    </div>
  );
}

/* ── Google continue button + consent copy ────────────────────────── */
// Inside a sentence a link is told apart from the words by an underline, not by colour alone.
const TEXT_LINK = "text-accent-light underline decoration-lit-line underline-offset-4 transition-colors hover:decoration-accent-light";

function GoogleSignupSection({
  mode, role, selected, isLoading, onGoogle,
}: {
  mode: Mode;
  role: Role;
  selected: { value: string; label: string; blurb: string } | undefined;
  isLoading: boolean;
  onGoogle: () => void;
}) {
  return (
    <>
      {/* The neutral control with the full-colour G on it: the dark-surface treatment Google's own guidance allows. */}
      <Button
        type="button"
        variant="ghost"
        size="lg"
        className="w-full"
        onClick={onGoogle}
        disabled={isLoading}
        leading={<GoogleIcon />}
      >
        Continue with Google
      </Button>

      {/* OAuth can't distinguish signup from sign-in client-side, and the
          checkbox only renders in signup mode, so consent for the Google path
          is captured by this always-visible notice (affirmative action + clear
          terms) rather than the hard checkbox gate used for email/password. */}
      {/* tg_handle_new_user maps a Google signup to 'alum' outright — the
          client cannot attach role metadata to an OAuth signup, so the
          dropdown above genuinely does not reach this button. Saying so is
          the alternative to a picker that silently doesn't apply. */}
      {mode === "signup" && role && role !== "alum" && (
        <p className="px-2 text-center text-small text-text-muted">
          Google sign-up is recorded as an alumni founder. The admin reviewing
          you will set it to {selected?.label.toLowerCase()}.
        </p>
      )}

      <p className="px-2 text-center text-small text-text-muted">
        By continuing with Google, you confirm you&apos;re 18 or over and agree to our{" "}
        <Link href="/terms" target="_blank" className={TEXT_LINK}>
          Terms &amp; Conditions
        </Link>
        , and that you&apos;ve read our{" "}
        <Link href="/privacy" target="_blank" className={TEXT_LINK}>
          Privacy Policy
        </Link>
        .
      </p>

      <div className="flex items-center gap-3">
        <Divider end="none" className="flex-1" />
        <span className="text-small text-text-muted">or</span>
        <Divider end="none" className="flex-1" />
      </div>
    </>
  );
}

/* ── Password + repeat-password fields ────────────────────────────── */
function PasswordFields({
  mode, password, setPassword, repeatPassword, setRepeatPassword, onForgotClick,
}: {
  mode: Mode;
  password: string; setPassword: (v: string) => void;
  repeatPassword: string; setRepeatPassword: (v: string) => void;
  onForgotClick: () => void;
}) {
  return (
    <>
      <Field label="Password">
        <Input
          id="password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      {mode === "signin" && (
        <div className="-mt-3 flex justify-end">
          <Button type="button" variant="quiet" size="sm" onClick={onForgotClick}>
            Forgot your password?
          </Button>
        </div>
      )}

      {mode === "signup" && (
        <Field label="Repeat password">
          <Input
            id="repeat-password"
            type="password"
            autoComplete="new-password"
            placeholder="Repeat password"
            value={repeatPassword}
            onChange={(e) => setRepeatPassword(e.target.value)}
          />
        </Field>
      )}
    </>
  );
}
