"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BrandLogo } from "@/components/BrandLogo";
import { ErrorBanner } from "@/components/forms/Banners";
import { inputCls } from "@/components/forms/styles";
import { cleanText } from "@/lib/text";
import { gradYearOptions, validateGradYear } from "@/lib/gradYears";
import type { Affiliation } from "@/lib/intake/steps";
import { destinationForStatus } from "@/lib/auth/status";
import { describeSupabaseError } from "@/lib/supabaseErrors";
import { Button } from "@/components/ui/Button";
import { invalidateDirectoryCache } from "@/app/profile/actions";
import { track } from "@/components/analytics/PostHogProvider";

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
    setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1));
  };

  const handleBack = () => {
    setError("");
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
    const { error: rpcError } = await supabase.rpc("submit_onboarding", {
      p_course:        cleanText(course),
      p_grad_year:     parseInt(gradYear, 10),
      p_linkedin_url:  cleanText(linkedin) || null,
      p_github_url:    cleanText(github) || null,
      p_portfolio_url: cleanText(portfolio) || null,
    });
    if (rpcError) {
      setError(describeSupabaseError(rpcError));
      setIsLoading(false);
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
    <div className="relative min-h-screen bg-bg-primary flex flex-col">
      <header className="sticky top-0 z-40 px-8 py-5 bg-bg-primary/90 backdrop-blur-md border-b border-border-subtle">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between">
          <Link href="/" className="no-underline">
            <BrandLogo size="sm" />
          </Link>
          <span className="text-[0.8rem] text-text-muted">
            Signed in as <span className="text-text-secondary">{firstName} {surname}</span>
          </span>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1 flex items-start justify-center px-8 py-12">
        <div className="w-full max-w-[640px]">
          <div className="text-center mb-8">
            <p className="label-wide text-text-secondary mb-3">Step {step + 1} of {TOTAL_STEPS} · {STEP_TITLES[step]}</p>
            <h1 className="font-display text-text-primary leading-[1.1] tracking-tight mb-4 text-[clamp(2rem,4vw,2.75rem)]">
              Who let you <span className="font-light text-text-secondary">in?</span>
            </h1>
            <p className="text-[0.9rem] text-text-secondary leading-[1.7]">
              {role !== "student"
                ? "Help us verify your Imperial connection and your work."
                : "A couple of questions, then you're through."}
              <br />
              <span className="text-text-muted text-[0.825rem]">
                You can go back to any step. There&apos;s more to add once you&apos;re in.
              </span>
            </p>
          </div>

          <ProgressBar current={step + 1} total={TOTAL_STEPS} />

          <form onSubmit={handleSubmit} className="mt-6 space-y-5 rounded-2xl bg-bg-card border border-border p-8">
            {error && <ErrorBanner>{error}</ErrorBanner>}

            {step === 0 && (
              <EducationStep
                role={role}
                course={course} setCourse={setCourse}
                gradYear={gradYear} setGradYear={setGradYear}
                inputCls={inputCls}
              />
            )}
            {step === 1 && (
              <LinksStep
                role={role}
                linkedin={linkedin} setLinkedin={setLinkedin}
                github={github} setGithub={setGithub}
                portfolio={portfolio} setPortfolio={setPortfolio}
                inputCls={inputCls}
              />
            )}

            <div className="pt-2 flex gap-3">
              {step > 0 && (
                <button
                  type="button"
                  onClick={handleBack}
                  disabled={isLoading}
                  className="px-5 py-3 rounded-xl bg-white/[0.05] border border-border-strong text-text-primary text-[0.85rem] hover:bg-white/[0.10] cursor-pointer transition-colors duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Back
                </button>
              )}
              {step < TOTAL_STEPS - 1 ? (
                <Button
                  type="button"
                  onClick={handleNext}
                  variant="primary"
                  size="lg"
                  className="flex-1"
                >
                  Continue
                </Button>
              ) : (
                <Button
                  type="submit"
                  loading={isLoading}
                  variant="primary"
                  size="lg"
                  className="flex-1"
                >
                  {role === "student" ? "Finish onboarding" : "Submit for review"}
                </Button>
              )}
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = (current / total) * 100;
  return (
    <div className="space-y-2" aria-label={`Step ${current} of ${total}`}>
      <div className="h-1 w-full rounded-full bg-white/[0.04] overflow-hidden">
        <div
          className="h-full bg-accent transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[0.7rem] text-text-muted">
        <span>{current} / {total}</span>
        <span>{Math.round(pct)}%</span>
      </div>
    </div>
  );
}

function EducationStep({
  role, course, setCourse, gradYear, setGradYear, inputCls,
}: {
  role: Affiliation;
  course: string; setCourse: (v: string) => void;
  gradYear: string; setGradYear: (v: string) => void;
  inputCls: string;
}) {
  return (
    <>
      <div>
        <label htmlFor="course" className="block text-[0.75rem] text-text-muted mb-1.5">
          {role === "student" ? "Course you're studying" : "Course studied"} <span className="text-[#ff6b6b]">*</span>
        </label>
        <input
          id="course"
          type="text"
          placeholder={role === "student" ? "e.g. BSc Mathematics" : "e.g. MEng Computing"}
          value={course}
          onChange={(e) => setCourse(e.target.value)}
          className={inputCls}
          maxLength={200}
          required
        />
      </div>
      <div>
        <label htmlFor="grad-year" className="block text-[0.75rem] text-text-muted mb-1.5">
          {role === "student" ? "Expected graduation year" : "Graduation year"} <span className="text-[#ff6b6b]">*</span>
        </label>
        <select
          id="grad-year"
          value={gradYear}
          onChange={(e) => setGradYear(e.target.value)}
          className={inputCls}
          required
        >
          <option value="">Select a year</option>
          {gradYearOptions(role).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>
    </>
  );
}

function LinksStep({
  role, linkedin, setLinkedin, github, setGithub, portfolio, setPortfolio, inputCls,
}: {
  role: Affiliation;
  linkedin: string; setLinkedin: (v: string) => void;
  github: string; setGithub: (v: string) => void;
  portfolio: string; setPortfolio: (v: string) => void;
  inputCls: string;
}) {
  return (
    <>
      <div>
        <label htmlFor="linkedin" className="block text-[0.75rem] text-text-muted mb-1.5">
          LinkedIn URL{" "}
          {role !== "student"
            ? <span className="text-[#ff6b6b]">*</span>
            : <span className="text-text-muted/70 ml-1">— optional</span>}
        </label>
        <input
          id="linkedin"
          type="url"
          placeholder="https://www.linkedin.com/in/your-handle"
          value={linkedin}
          onChange={(e) => setLinkedin(e.target.value)}
          className={inputCls}
          maxLength={512}
          required={role !== "student"}
        />
      </div>
      <div>
        <label htmlFor="github" className="block text-[0.75rem] text-text-muted mb-1.5">
          GitHub URL <span className="text-text-muted/70 ml-1">— optional</span>
        </label>
        <input
          id="github"
          type="url"
          placeholder="https://github.com/your-handle"
          value={github}
          onChange={(e) => setGithub(e.target.value)}
          className={inputCls}
          maxLength={512}
        />
      </div>
      <div>
        <label htmlFor="portfolio" className="block text-[0.75rem] text-text-muted mb-1.5">
          Portfolio URL <span className="text-text-muted/70 ml-1">— optional</span>
        </label>
        <input
          id="portfolio"
          type="url"
          placeholder="https://yourportfolio.com"
          value={portfolio}
          onChange={(e) => setPortfolio(e.target.value)}
          className={inputCls}
          maxLength={512}
        />
      </div>
    </>
  );
}
