"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BrandLogo } from "@/components/BrandLogo";
import { ErrorBanner } from "@/components/forms/Banners";
import { Field } from "@/components/forms/Field";
import { cleanText } from "@/lib/text";
import { gradYearOptions, validateGradYear } from "@/lib/gradYears";
import type { Affiliation } from "@/lib/intake/steps";
import { destinationForStatus } from "@/lib/auth/status";
import { describeSupabaseError } from "@/lib/supabaseErrors";
import { Button } from "@/components/ui/Button";
import { FormActions } from "@/components/ui/FormActions";
import { FormSection } from "@/components/ui/FormSection";
import { Input } from "@/components/ui/Input";
import { PageHead } from "@/components/ui/PageHead";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Select } from "@/components/ui/Select";
import { invalidateDirectoryCache } from "@/app/profile/actions";
import { track } from "@/lib/analytics/track";

// ════════════════════════════════════════════════════════════════════
// Foundry · Onboarding — identity only
//
// This is the admission gate, not the profile. It collects exactly what
// admin_list_pending_profiles reviews (course, grad year, LinkedIn) plus
// GitHub/portfolio, then flips status via submit_onboarding. Everything
// richer — photo, CV, skills, interests, venture, intent — moved to
// /intake, which runs only after approval (20260901000006's header
// comment has the full reasoning for the split). Bio and "what you're
// working on" are asked there too, not here.
// ════════════════════════════════════════════════════════════════════

type Props = {
  role: Affiliation;
  firstName: string;
  surname: string;
};

const LINKEDIN_RE = /^https?:\/\/([a-z0-9-]+\.)*linkedin\.com\//i;
const GITHUB_RE   = /^https?:\/\/([a-z0-9-]+\.)*github\.com\//i;
const URL_RE      = /^https?:\/\/.+/i;

const TOTAL_STEPS = 2;
const STEP_TITLES = ["Your studies", "Links"];

export default function OnboardingForm({ role, firstName, surname }: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [course, setCourse] = useState("");
  const [gradYear, setGradYear] = useState<string>("");
  const [linkedin, setLinkedin] = useState("");
  const [github, setGithub] = useState("");
  const [portfolio, setPortfolio] = useState("");

  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const validateStep = (s: number): string | null => {
    if (s === 0) {
      const c = cleanText(course);
      if (!c) return "Course is required.";
      if (c.length > 200) return "Course must be 200 characters or fewer.";
      const y = parseInt(gradYear, 10);
      if (!y) return "Please pick a valid graduation year.";
      const yearErr = validateGradYear(role, y);
      if (yearErr) return yearErr;
    }
    if (s === 1) {
      const lk = cleanText(linkedin);
      const gh = cleanText(github);
      const pf = cleanText(portfolio);
      if (role !== "student" && !lk)
        return "A LinkedIn URL is required for accounts without an Imperial email address.";
      if (lk && !LINKEDIN_RE.test(lk)) return "Please enter a valid LinkedIn URL.";
      if (gh && !GITHUB_RE.test(gh)) return "Please enter a valid GitHub URL or leave it blank.";
      if (pf && !URL_RE.test(pf)) return "Portfolio URL must start with http:// or https://.";
    }
    return null;
  };

  const handleNext = () => {
    const err = validateStep(step);
    if (err) {
      setError(err);
      return;
    }
    setError("");
    setDir("fwd");
    setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1));
  };

  const handleBack = () => {
    setError("");
    setDir("back");
    setStep((s) => Math.max(0, s - 1));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateStep(step);
    if (err) {
      setError(err);
      return;
    }

    setIsLoading(true);
    let rpcError: Awaited<ReturnType<typeof supabase.rpc>>["error"];
    try {
      ({ error: rpcError } = await supabase.rpc("submit_onboarding", {
        p_course:        cleanText(course),
        p_grad_year:     parseInt(gradYear, 10),
        p_linkedin_url:  cleanText(linkedin) || null,
        p_github_url:    cleanText(github) || null,
        p_portfolio_url: cleanText(portfolio) || null,
      }));
    } finally {
      setIsLoading(false);
    }
    if (rpcError) {
      setError(describeSupabaseError(rpcError));
      return;
    }
    track("onboarding_completed", { role });
    // The RPC decides the status: student ⇒ approved, everything else ⇒
    // pending_review (allow-list, default deny — 20260828000002). Route on
    // the same rule, through destinationForStatus rather than a second
    // hardcoded path — an approved student lands on /home, which then
    // bounces them into /intake for the rest of their profile.
    // The RPC above ran client-side, so nothing on the server knows the
    // directory changed. Tell it, and let that Server Action resolve,
    // before starting the route transition below — calling it after
    // router.replace() races the action's RSC response against a route
    // tree that's already being torn down, which is what produced this
    // form's own "An unexpected response was received from the server"
    // error in production.
    await invalidateDirectoryCache();
    router.replace(
      destinationForStatus(role === "student" ? "approved" : "pending_review"),
    );
    router.refresh();
  };

  return (
    // no background of its own: the atmosphere (the night behind every page) shows through
    <div className="flex min-h-screen flex-col">
      <header className="z-40 border-b border-border-subtle bg-bg-primary/85 px-[var(--gutter)] backdrop-blur-md sm:sticky sm:top-0">
        <div className="mx-auto flex max-w-[var(--content-max)] flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3.5">
          {/* below 430px the lockup and the "Foundry" wordmark do not fit one line (the lockup may not shrink): the lockup keeps the room */}
          <Link href="/" className="no-underline max-[430px]:[&_.font-display]:hidden">
            <BrandLogo size="sm" />
          </Link>
          <span className="text-small text-text-muted">
            Signed in as <span className="text-text-secondary">{firstName} {surname}</span>
          </span>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1 px-[var(--gutter)] pb-20 pt-4">
        <div className="mx-auto w-full max-w-[640px]">
          <PageHead
            context={<>Step {step + 1} of {TOTAL_STEPS} · {STEP_TITLES[step]}</>}
            title={<>Who let you <span className="text-text-secondary">in?</span></>}
            lede={
              <>
                {role !== "student"
                  ? "Help us verify your Imperial connection and your work."
                  : "A couple of questions, then you're through."}
                <span className="mt-2 block text-small text-text-muted">
                  You can go back to any step. There&apos;s more to add once you&apos;re in.
                </span>
              </>
            }
          />

          <div className="my-7">
            <ProgressBar
              value={step + 1}
              max={TOTAL_STEPS}
              label={`Step ${step + 1} of ${TOTAL_STEPS}`}
              valueText={`Step ${step + 1} of ${TOTAL_STEPS}`}
              start={`${step + 1} / ${TOTAL_STEPS}`}
              end={`${Math.round(((step + 1) / TOTAL_STEPS) * 100)}%`}
            />
          </div>

          <FormSection as="form" onSubmit={handleSubmit}>
            {error && <ErrorBanner>{error}</ErrorBanner>}

            {/* the fields enter from the side you are travelling toward, so Back visibly reverses Continue */}
            <div key={step} className={`grid gap-6 ${dir === "fwd" ? "anim-step-fwd" : "anim-step-back"}`}>
              {step === 0 && (
                <EducationStep
                  role={role}
                  course={course} setCourse={setCourse}
                  gradYear={gradYear} setGradYear={setGradYear}
                />
              )}
              {step === 1 && (
                <LinksStep
                  role={role}
                  linkedin={linkedin} setLinkedin={setLinkedin}
                  github={github} setGithub={setGithub}
                  portfolio={portfolio} setPortfolio={setPortfolio}
                />
              )}
            </div>

            {/* KEEP AS WRITTEN (pre-existing): Continue and the submit button are both a <Button> at this same position, so React reuses
                the one DOM node and flips its type; the click that advances to step 2 therefore also submits the form. Giving the two
                buttons different `key`s stops that. It is left alone here because it changes what a student's first click does. */}
            <FormActions align="between">
              {step > 0 && (
                <Button type="button" variant="ghost" size="lg" onClick={handleBack} disabled={isLoading}>
                  Back
                </Button>
              )}
              {step < TOTAL_STEPS - 1 ? (
                <Button type="button" onClick={handleNext} variant="primary" size="lg" className="ml-auto">
                  Continue
                </Button>
              ) : (
                <Button type="submit" loading={isLoading} variant="primary" size="lg" lit className="ml-auto">
                  {role === "student" ? "Finish onboarding" : "Submit for review"}
                </Button>
              )}
            </FormActions>
          </FormSection>
        </div>
      </main>
    </div>
  );
}

function EducationStep({
  role, course, setCourse, gradYear, setGradYear,
}: {
  role: Affiliation;
  course: string; setCourse: (v: string) => void;
  gradYear: string; setGradYear: (v: string) => void;
}) {
  return (
    <>
      <Field label={role === "student" ? "Course you're studying" : "Course studied"} required>
        <Input
          id="course"
          type="text"
          placeholder={role === "student" ? "e.g. BSc Mathematics" : "e.g. MEng Computing"}
          value={course}
          onChange={(e) => setCourse(e.target.value)}
          maxLength={200}
          required
        />
      </Field>
      <Field label={role === "student" ? "Expected graduation year" : "Graduation year"} required>
        <Select
          id="grad-year"
          value={gradYear}
          onChange={(e) => setGradYear(e.target.value)}
          required
        >
          <option value="">Select a year</option>
          {gradYearOptions(role).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </Select>
      </Field>
    </>
  );
}

function LinksStep({
  role, linkedin, setLinkedin, github, setGithub, portfolio, setPortfolio,
}: {
  role: Affiliation;
  linkedin: string; setLinkedin: (v: string) => void;
  github: string; setGithub: (v: string) => void;
  portfolio: string; setPortfolio: (v: string) => void;
}) {
  return (
    <>
      <Field
        label="LinkedIn URL"
        required={role !== "student"}
        hint={role !== "student" ? undefined : "— optional"}
      >
        <Input
          id="linkedin"
          type="url"
          placeholder="https://www.linkedin.com/in/your-handle"
          value={linkedin}
          onChange={(e) => setLinkedin(e.target.value)}
          maxLength={512}
          required={role !== "student"}
        />
      </Field>
      <Field label="GitHub URL" hint="— optional">
        <Input
          id="github"
          type="url"
          placeholder="https://github.com/your-handle"
          value={github}
          onChange={(e) => setGithub(e.target.value)}
          maxLength={512}
        />
      </Field>
      <Field label="Portfolio URL" hint="— optional">
        <Input
          id="portfolio"
          type="url"
          placeholder="https://yourportfolio.com"
          value={portfolio}
          onChange={(e) => setPortfolio(e.target.value)}
          maxLength={512}
        />
      </Field>
    </>
  );
}
