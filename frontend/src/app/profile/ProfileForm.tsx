"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ChipGroup, type ChipItem } from "@/components/forms/ChipGroup";
import { ErrorBanner, SuccessBanner } from "@/components/forms/Banners";
import { inputCls } from "@/components/forms/styles";
import {
  Field, ChoiceCards, PillChoice, TagInput, FilePicker, RankPicker, SkillPicker, type SkillOption,
} from "@/components/intake/controls";
import { AvatarCropper } from "@/components/media/AvatarCropper";
import { cleanName, cleanText, isValidName, MAX_NAME_LENGTH } from "@/lib/text";
import { gradYearOptions, validateGradYear } from "@/lib/gradYears";
import { describeSupabaseError, isSessionExpiredError } from "@/lib/supabaseErrors";
import { Button } from "@/components/ui/Button";
import { invalidateDirectoryCache } from "@/app/profile/actions";
import {
  requestAvatarTicket, confirmAvatarUpload, removeAvatar,
  requestCvTicket, confirmCvUpload, removeCv, getMyCvDownloadUrl,
  getMySuggestedCvSkillIds,
  requestGithubConnectUrl, disconnectGithub, type GithubScanStatus,
  getMyGithubShowcase, getMyGithubStatus, dismissGithubShowcasePrompt, setGithubNudges,
} from "@/app/profile/mediaActions";
import { CvProcessingDialog } from "@/app/profile/CvProcessingDialog";
import { GithubDialog } from "@/app/profile/GithubDialog";
import type { ShowcaseRepo } from "@/lib/github/showcase";
import type { Affiliation } from "@/lib/intake/steps";
import { externalHref } from "@/lib/safeUrl";
import {
  MAX_CORE_SKILLS, MAX_INTENTS,
  CURRENT_FOCUS, VENTURE_STAGES, VENTURE_STAGES_WITH_DETAIL, RECRUITING_STATUSES,
  INTENTS, INTENT_URGENCIES, AVAILABILITY_HOURS,
} from "@/lib/intake/state";

// ════════════════════════════════════════════════════════════════════
// Foundry · My Profile
//
// Everything /intake collects stays editable here — it is all
// self-description that goes stale, and locking it guarantees a stale
// directory within two terms (ethereal-fluttering-blossom.md §4f). The
// three exceptions are handled elsewhere for the same reason each time:
// role/affiliation (AffiliationSection, its own re-check), status
// (trigger-locked), email (a verified change flow with an audit log).
//
// Photo and CV each write through their own RPC the moment they change
// (mediaActions.ts) — they are not part of the "Save changes" submit,
// which only covers the update_profile fields below.
// ════════════════════════════════════════════════════════════════════

type Props = {
  role: Affiliation;
  firstName: string;
  surname: string;
  course: string;
  gradYear: number | null;
  linkedinUrl: string;
  githubUrl: string;
  portfolioUrl: string;
  preferredName: string;
  bioFocus: string;
  bioHobbies: string;
  avatarUrl: string | null;
  cvOriginalFilename: string | null;
  cvUploadedAt: string | null;
  hasCv: boolean;
  githubUsername: string | null;
  githubScanStatus: string | null;
  githubScanFailureReason: string | null;
  /** Kill switch (20260911000003) — false pauses only the LLM/worker-job
   *  side of CV upload and GitHub connect; file storage and OAuth
   *  recording stay unaffected either way. */
  ingestionEnabled: boolean;
  currentFocus: string;
  ventureStage: string;
  ventureName: string;
  ventureUrl: string;
  ventureOneLiner: string;
  recruitingStatus: string;
  intentUrgency: string;
  availabilityHours: string;
  intents: string[];
  academicInterests: string[];
  hobbies: string[];
  skillTaxonomy: SkillOption[];
  sectors: ChipItem[];
  selectedSkillIds: number[];
  selectedCoreSkillIds: number[];
  selectedSectors: number[];
};

const LINKEDIN_RE = /^https?:\/\/([a-z0-9-]+\.)*linkedin\.com\//i;
const GITHUB_RE   = /^https?:\/\/([a-z0-9-]+\.)*github\.com\//i;
const URL_RE      = /^https?:\/\/.+/i;

export default function ProfileForm(props: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [firstName, setFirstName] = useState(props.firstName);
  const [surname, setSurname] = useState(props.surname);
  const [course, setCourse] = useState(props.course);
  const [gradYear, setGradYear] = useState<string>(props.gradYear?.toString() ?? "");
  const [linkedin, setLinkedin] = useState(props.linkedinUrl);
  const [github, setGithub] = useState(props.githubUrl);
  const [portfolio, setPortfolio] = useState(props.portfolioUrl);

  const [preferredName, setPreferredName] = useState(props.preferredName);
  const [bioFocus, setBioFocus] = useState(props.bioFocus);
  const [bioHobbies, setBioHobbies] = useState(props.bioHobbies);

  const [skillIds, setSkillIds] = useState<number[]>(props.selectedSkillIds);
  const [coreSkillIds, setCoreSkillIds] = useState<number[]>(props.selectedCoreSkillIds);
  const [suggestedSkillIds, setSuggestedSkillIds] = useState<number[]>([]);
  const [sectorIds, setSectorIds] = useState<Set<number>>(new Set(props.selectedSectors));
  const [academicInterests, setAcademicInterests] = useState<string[]>(props.academicInterests);
  const [hobbies, setHobbies] = useState<string[]>(props.hobbies);

  const [currentFocus, setCurrentFocus] = useState(props.currentFocus);
  const [ventureStage, setVentureStage] = useState(props.ventureStage);
  const [ventureName, setVentureName] = useState(props.ventureName);
  const [ventureUrl, setVentureUrl] = useState(props.ventureUrl);
  const [ventureOneLiner, setVentureOneLiner] = useState(props.ventureOneLiner);
  const [recruitingStatus, setRecruitingStatus] = useState(props.recruitingStatus);

  const [intents, setIntents] = useState<string[]>(props.intents);
  const [intentUrgency, setIntentUrgency] = useState(props.intentUrgency);
  const [availabilityHours, setAvailabilityHours] = useState(props.availabilityHours);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  // The banner renders at the very top of this page, but Save (and most
  // validation triggers) sit far below it on a page this long — a failed
  // save otherwise reads as "nothing happened" because the reason is
  // off-screen. IntakeFlow already does this on every step change; this is
  // the same fix for the one page that was missing it.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [error]);

  const toggleSector = (id: number) => {
    const next = new Set(sectorIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSectorIds(next);
  };
  const toggleIntent = (v: string) =>
    setIntents((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : prev.length < MAX_INTENTS ? [...prev, v] : prev,
    );
  const toggleCoreSkill = (id: number) =>
    setCoreSkillIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < MAX_CORE_SKILLS ? [...prev, id] : prev,
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaved(false);

    const trimmedFirst = cleanName(firstName);
    const trimmedSurname = cleanName(surname);
    const cleanedCourse = cleanText(course);
    if (!trimmedFirst || !trimmedSurname) {
      setError("First name and surname are required.");
      return;
    }
    if (trimmedFirst.length > MAX_NAME_LENGTH || trimmedSurname.length > MAX_NAME_LENGTH) {
      setError(`First name and surname must be ${MAX_NAME_LENGTH} characters or fewer.`);
      return;
    }
    if (!isValidName(trimmedFirst) || !isValidName(trimmedSurname)) {
      setError("Names can only contain letters, spaces, hyphens, apostrophes and periods.");
      return;
    }
    if (!cleanedCourse) {
      setError("Course is required.");
      return;
    }
    if (cleanedCourse.length > 200) {
      setError("Course must be 200 characters or fewer.");
      return;
    }
    const gradYearNum = parseInt(gradYear, 10);
    if (!gradYearNum) {
      setError("Please pick a valid graduation year.");
      return;
    }
    const gradYearErr = validateGradYear(props.role, gradYearNum);
    if (gradYearErr) {
      setError(gradYearErr);
      return;
    }
    if (props.role !== "student" && !linkedin.trim()) {
      setError("A LinkedIn URL is required for accounts without an Imperial email address.");
      return;
    }
    if (linkedin.trim() && !LINKEDIN_RE.test(linkedin.trim())) {
      setError("Please enter a valid LinkedIn URL.");
      return;
    }
    if (github.trim() && !GITHUB_RE.test(github.trim())) {
      setError("Please enter a valid GitHub URL or leave it blank.");
      return;
    }
    if (portfolio.trim() && !URL_RE.test(portfolio.trim())) {
      setError("Portfolio URL must start with http:// or https://.");
      return;
    }
    if (ventureUrl.trim() && !URL_RE.test(ventureUrl.trim())) {
      setError("Venture website must start with http:// or https://.");
      return;
    }

    setIsLoading(true);
    const { error: rpcError } = await supabase.rpc("update_profile", {
      p_first_name:    trimmedFirst,
      p_surname:       trimmedSurname,
      p_course:        cleanedCourse,
      p_grad_year:     gradYearNum,
      p_linkedin_url:  cleanText(linkedin) || null,
      p_github_url:    cleanText(github) || null,
      p_portfolio_url: cleanText(portfolio) || null,
      p_preferred_name: cleanText(preferredName) || null,
      p_bio_focus:      cleanText(bioFocus) || null,
      p_bio_hobbies:    cleanText(bioHobbies) || null,
      p_current_focus:  currentFocus || null,
      p_venture_stage:  ventureStage || null,
      p_venture_name:   cleanText(ventureName) || null,
      p_venture_url:    cleanText(ventureUrl) || null,
      p_venture_one_liner: cleanText(ventureOneLiner) || null,
      p_recruiting_status: recruitingStatus || null,
      p_intent_urgency:    intentUrgency || null,
      p_availability_hours: availabilityHours || null,
      p_skill_ids:      skillIds,
      p_core_skill_ids: coreSkillIds,
      p_sector_ids:     Array.from(sectorIds),
      p_academic_interests: academicInterests,
      p_hobbies:            hobbies,
      p_intents:            intents,
    });

    if (rpcError) {
      setError(describeSupabaseError(rpcError));
      setIsLoading(false);
      // This RPC runs straight from the browser client, so there is no
      // framework-level redirect on an expired session the way a page load
      // or server action gets — send them back to sign in rather than
      // leaving them to notice the banner. Brief delay so the message above
      // is actually readable before the page navigates away.
      if (isSessionExpiredError(rpcError)) {
        window.setTimeout(() => router.push("/login"), 1500);
      }
      return;
    }

    setSaved(true);
    setIsLoading(false);
    await invalidateDirectoryCache();
    router.refresh();
  };

  const suggestedSkills = suggestedSkillIds
    .filter((id) => !skillIds.includes(id))
    .map((id) => props.skillTaxonomy.find((t) => t.id === id))
    .filter((t): t is SkillOption => !!t);

  const showVentureDetail = VENTURE_STAGES_WITH_DETAIL.has(ventureStage);

  return (
    <div className="space-y-8">
      {error && <div ref={errorRef}><ErrorBanner>{error}</ErrorBanner></div>}
      {saved && !error && <SuccessBanner>Saved.</SuccessBanner>}

      <PhotoSection avatarUrl={props.avatarUrl} />

      <CvSection
        role={props.role}
        originalFilename={props.cvOriginalFilename}
        uploadedAt={props.cvUploadedAt}
        hasCv={props.hasCv}
        onSuggested={(ids) => setSuggestedSkillIds((prev) => [...prev, ...ids])}
        ingestionEnabled={props.ingestionEnabled}
      />

      <GithubSection
        username={props.githubUsername}
        scanStatus={props.githubScanStatus as GithubScanStatus | null}
        scanFailureReason={props.githubScanFailureReason}
        ingestionEnabled={props.ingestionEnabled}
      />

      <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl bg-bg-card border border-border p-8">
        <h2 className="mb-1 text-[1rem] font-medium text-text-primary">Identity</h2>

        <div className="flex gap-3">
          <div className="flex-1">
            <label htmlFor="first-name" className="block text-[0.75rem] text-text-muted mb-1.5">First name</label>
            <input id="first-name" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputCls} maxLength={MAX_NAME_LENGTH} required />
          </div>
          <div className="flex-1">
            <label htmlFor="surname" className="block text-[0.75rem] text-text-muted mb-1.5">Surname</label>
            <input id="surname" type="text" value={surname} onChange={(e) => setSurname(e.target.value)} className={inputCls} maxLength={MAX_NAME_LENGTH} required />
          </div>
        </div>

        <div>
          <label htmlFor="preferred-name" className="block text-[0.75rem] text-text-muted mb-1.5">
            What people call you <span className="text-text-muted/70 ml-1">— optional</span>
          </label>
          <input id="preferred-name" type="text" value={preferredName} onChange={(e) => setPreferredName(e.target.value)} className={inputCls} maxLength={MAX_NAME_LENGTH} />
        </div>

        <div>
          <label htmlFor="course" className="block text-[0.75rem] text-text-muted mb-1.5">
            {props.role === "alum" ? "Course studied" : "Course you're studying"}
          </label>
          <input
            id="course" type="text" value={course} onChange={(e) => setCourse(e.target.value)}
            className={inputCls} maxLength={200}
            placeholder={props.role === "alum" ? "e.g. MEng Computing" : "e.g. BSc Mathematics"}
            required
          />
        </div>

        <div>
          <label htmlFor="grad-year" className="block text-[0.75rem] text-text-muted mb-1.5">
            {props.role === "alum" ? "Graduation year" : "Expected graduation year"}
          </label>
          <select id="grad-year" value={gradYear} onChange={(e) => setGradYear(e.target.value)} className={inputCls} required>
            <option value="">Select a year</option>
            {gradYearOptions(props.role).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="linkedin" className="block text-[0.75rem] text-text-muted mb-1.5">
            LinkedIn URL{" "}
            {props.role === "student" && <span className="text-text-muted/70 ml-1">— optional</span>}
          </label>
          <input id="linkedin" type="url" placeholder="https://linkedin.com/in/your-handle" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} className={inputCls} maxLength={512} required={props.role !== "student"} />
        </div>

        <div>
          <label htmlFor="github" className="block text-[0.75rem] text-text-muted mb-1.5">
            GitHub URL <span className="text-text-muted/70 ml-1">— optional</span>
          </label>
          <input id="github" type="url" placeholder="https://github.com/your-handle" value={github} onChange={(e) => setGithub(e.target.value)} className={inputCls} maxLength={512} />
        </div>

        <div>
          <label htmlFor="portfolio" className="block text-[0.75rem] text-text-muted mb-1.5">
            Portfolio URL <span className="text-text-muted/70 ml-1">— optional</span>
          </label>
          <input id="portfolio" type="url" placeholder="https://yourportfolio.com" value={portfolio} onChange={(e) => setPortfolio(e.target.value)} className={inputCls} maxLength={512} />
        </div>

        <div>
          <label htmlFor="bio-focus" className="block text-[0.75rem] text-text-muted mb-1.5">
            What are you working on, or into? <span className="text-text-muted/70 ml-2">{bioFocus.length}/500</span>
          </label>
          <textarea id="bio-focus" rows={3} value={bioFocus} onChange={(e) => setBioFocus(e.target.value)} className={`${inputCls} resize-none`} maxLength={500} />
        </div>

        <div>
          <label htmlFor="bio-hobbies" className="block text-[0.75rem] text-text-muted mb-1.5">
            And outside of that? <span className="text-text-muted/70 ml-2">{bioHobbies.length}/500</span>
          </label>
          <textarea id="bio-hobbies" rows={2} value={bioHobbies} onChange={(e) => setBioHobbies(e.target.value)} className={`${inputCls} resize-none`} maxLength={500} />
        </div>

        <h2 className="pt-4 text-[1rem] font-medium text-text-primary">Skills</h2>
        <SkillPicker
          taxonomy={props.skillTaxonomy}
          selectedIds={skillIds}
          coreIds={coreSkillIds}
          suggested={suggestedSkills}
          onAdd={(id) => setSkillIds((prev) => [...prev, id])}
          onRemove={(id) => {
            setSkillIds((prev) => prev.filter((x) => x !== id));
            setCoreSkillIds((prev) => prev.filter((x) => x !== id));
          }}
          onToggleCore={toggleCoreSkill}
          maxCore={MAX_CORE_SKILLS}
        />

        <h2 className="pt-4 text-[1rem] font-medium text-text-primary">Interests</h2>
        <ChipGroup label="Sectors" items={props.sectors} selected={sectorIds} onToggle={toggleSector} />
        <Field label="Things you find genuinely interesting" hint="Not necessarily your job.">
          <TagInput
            placeholder="Add an interest…"
            suggestions={["Computer vision", "Medical devices", "Climate", "Robotics", "Fintech", "Policy", "Semiconductors", "Synthetic biology", "Space", "Developer tools"]}
            values={academicInterests}
            max={12}
            onAdd={(v) => setAcademicInterests((prev) => [...prev, v])}
            onRemove={(v) => setAcademicInterests((prev) => prev.filter((x) => x !== v))}
          />
        </Field>
        <Field label="Hobbies">
          <TagInput
            placeholder="Add a hobby…"
            suggestions={["Running", "Climbing", "Chess", "Cooking", "Football", "Photography", "Cycling", "Reading"]}
            values={hobbies}
            max={12}
            onAdd={(v) => setHobbies((prev) => [...prev, v])}
            onRemove={(v) => setHobbies((prev) => prev.filter((x) => x !== v))}
          />
        </Field>

        <h2 className="pt-4 text-[1rem] font-medium text-text-primary">Where you&apos;re at</h2>
        <Field label="What's your situation right now?">
          <ChoiceCards name="Current focus" columns={2} options={CURRENT_FOCUS} value={currentFocus || null} onChange={setCurrentFocus} />
        </Field>
        <Field label="Where's your venture at?">
          <ChoiceCards name="Venture stage" columns={2} options={VENTURE_STAGES} value={ventureStage || null} onChange={setVentureStage} />
        </Field>
        {showVentureDetail && (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="block text-[0.75rem] text-text-muted mb-1.5">Venture name</label>
                <input type="text" maxLength={200} value={ventureName} onChange={(e) => setVentureName(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-[0.75rem] text-text-muted mb-1.5">Website</label>
                <input type="url" maxLength={512} value={ventureUrl} onChange={(e) => setVentureUrl(e.target.value)} className={inputCls} placeholder="https://…" />
              </div>
            </div>
            <div>
              <label className="block text-[0.75rem] text-text-muted mb-1.5">One line on what it does</label>
              <input type="text" maxLength={140} value={ventureOneLiner} onChange={(e) => setVentureOneLiner(e.target.value)} className={inputCls} />
            </div>
            <Field label="Recruiting?">
              <PillChoice name="Recruiting" options={RECRUITING_STATUSES} value={recruitingStatus} onChange={setRecruitingStatus} />
            </Field>
          </>
        )}

        <h2 className="pt-4 text-[1rem] font-medium text-text-primary">What you want</h2>
        <Field label={`Pick up to ${MAX_INTENTS}, in order`}>
          <RankPicker options={INTENTS} values={intents} onToggle={toggleIntent} max={MAX_INTENTS} />
        </Field>
        <Field label="How urgent?">
          <PillChoice name="Urgency" options={INTENT_URGENCIES} value={intentUrgency} onChange={setIntentUrgency} />
        </Field>
        <Field label="Hours a week for something new">
          <PillChoice name="Hours a week" options={AVAILABILITY_HOURS} value={availabilityHours} onChange={setAvailabilityHours} />
        </Field>

        <Button type="submit" loading={isLoading} variant="primary" size="lg" className="w-full mt-3">
          Save changes
        </Button>
      </form>
    </div>
  );
}

// ─── Photo ─────────────────────────────────────────────────────────

function PhotoSection({ avatarUrl }: { avatarUrl: string | null }) {
  const router = useRouter();
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(avatarUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const replaceRef = useRef<HTMLInputElement>(null);

  const upload = async (blob: Blob) => {
    setError("");
    setUploading(true);
    try {
      const ticket = await requestAvatarTicket();
      if (!ticket.ok) { setError(ticket.error); return; }

      const form = new FormData();
      form.append("file", blob, "avatar.jpg");
      const res = await fetch(ticket.data.uploadUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${ticket.data.token}` },
        body: form,
        // Without this, a hung gateway leaves `uploading` stuck true
        // forever with no error — the catch below never fires.
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        setError(detail?.detail ?? "That photo couldn't be uploaded.");
        return;
      }
      const stored = await res.json();
      const confirmed = await confirmAvatarUpload(stored.key);
      if (!confirmed.ok) { setError(confirmed.error); return; }

      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(blob));
      setPendingFile(null);
      router.refresh();
    } catch {
      setError("Couldn't reach the photo service. Try again in a moment.");
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    setError("");
    const result = await removeAvatar();
    if (!result.ok) { setError(result.error); return; }
    setPreview(null);
    router.refresh();
  };

  return (
    <section className="rounded-2xl border border-border bg-bg-card p-6 sm:p-8">
      <h2 className="mb-1 text-[1rem] font-medium text-text-primary">Photo</h2>
      <p className="mb-5 text-[0.825rem] leading-[1.6] text-text-muted">
        What people see first in the directory.
      </p>
      {error && <div className="mb-4"><ErrorBanner>{error}</ErrorBanner></div>}

      {pendingFile ? (
        <AvatarCropper file={pendingFile} onCropped={upload} onCancel={() => setPendingFile(null)} />
      ) : preview ? (
        <div className="flex items-center gap-4 rounded-lg border border-border-strong bg-white/[0.04] p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed blob URL or local object URL, not a static asset */}
          <img src={preview} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover" />
          <span className="flex-1 text-[0.85rem] text-text-primary">{uploading ? "Uploading…" : "Current photo"}</span>
          <button
            type="button"
            onClick={() => replaceRef.current?.click()}
            className="shrink-0 cursor-pointer rounded-lg border border-border-strong bg-white/[0.04] px-3 py-2 text-[0.775rem] text-text-secondary transition-colors duration-150 hover:border-accent hover:text-text-primary"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={remove}
            className="shrink-0 cursor-pointer rounded-lg border border-border-strong bg-white/[0.04] px-3 py-2 text-[0.775rem] text-text-secondary transition-colors duration-150 hover:border-[#ff4d4d]/60 hover:text-[#ff8080]"
          >
            Remove
          </button>
          <input ref={replaceRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Replace photo" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) setPendingFile(f); e.target.value = ""; }} />
        </div>
      ) : (
        <FilePicker accept="image/jpeg,image/png,image/webp" label="Add a photo" hint="JPG, PNG or WebP" file={null} onPick={setPendingFile} onClear={() => {}} />
      )}
    </section>
  );
}

// ─── CV ────────────────────────────────────────────────────────────

/**
 * A few short retries for confirmCvUpload's background extraction to
 * finish, rather than the multi-screen gap the intake flow gets for
 * free — this page has no equivalent "a few steps later" moment.
 * Gives up silently after ~3.6s; the suggestions just won't show for
 * this visit, same as any other best-effort background result.
 */
async function pollForSuggestions(onSuggested: (ids: number[]) => void): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const result = await getMySuggestedCvSkillIds();
    if (result.ok && result.data.length > 0) {
      onSuggested(result.data);
      return;
    }
  }
}

function CvSection({
  role, originalFilename, uploadedAt, hasCv, onSuggested, ingestionEnabled,
}: {
  role: Affiliation;
  originalFilename: string | null;
  uploadedAt: string | null;
  hasCv: boolean;
  onSuggested: (ids: number[]) => void;
  ingestionEnabled: boolean;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [present, setPresent] = useState(hasCv);
  const [filename, setFilename] = useState(originalFilename);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [showProcessingDialog, setShowProcessingDialog] = useState(false);
  // A student's CV is compulsory (screens.tsx's cvRequired mirrors this) —
  // they can replace it but never remove it down to nothing, so "change"
  // and "remove" are two different actions only alumni ever see both of.
  const [changing, setChanging] = useState(false);
  const canRemove = role !== "student";

  const upload = async () => {
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const ticket = await requestCvTicket();
      if (!ticket.ok) { setError(ticket.error); return; }

      const form = new FormData();
      form.append("file", file);
      const res = await fetch(ticket.data.uploadUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${ticket.data.token}` },
        body: form,
        // Without this, a hung gateway leaves `uploading` stuck true
        // forever with no error — the catch below never fires.
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        setError(detail?.detail ?? "That file couldn't be uploaded. Try a PDF or DOCX.");
        return;
      }
      const stored = await res.json();
      const confirmed = await confirmCvUpload(stored.key, file.name, consent);
      if (!confirmed.ok) { setError(confirmed.error); return; }

      setPresent(true);
      setFilename(file.name);
      setFile(null);
      setChanging(false);
      router.refresh();

      // Extraction runs in the background (mediaActions.confirmCvUpload's
      // after() callback) rather than blocking this upload — poll a few
      // times for it to land instead of making the member wait on it.
      // Not awaited: the upload itself is already done.
      if (consent) void pollForSuggestions(onSuggested);

      // confirm_cv_upload only enqueues the CV matchmaker's ingest
      // pipeline (moderation, extraction, skill normalisation,
      // chunk+embed — cv-matchmaker-spec.md) when consent is ticked, same
      // gate as the suggestion prefill above — see privacy policy section
      // 2a. This dialog watches it finish and shows the matched skills
      // (the generated summary itself is stored but never shown to the
      // member — it's recruiter-facing only).
      if (consent) setShowProcessingDialog(true);
    } catch {
      setError("Couldn't reach the file service. Try again in a moment.");
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    setError("");
    const result = await removeCv();
    if (!result.ok) { setError(result.error); return; }
    setPresent(false);
    setFilename(null);
    router.refresh();
  };

  const download = async () => {
    setError("");
    const result = await getMyCvDownloadUrl();
    if (!result.ok) { setError(result.error); return; }
    if (result.data) window.open(result.data, "_blank", "noopener");
  };

  return (
    <section className="rounded-2xl border border-border bg-bg-card p-6 sm:p-8">
      <h2 className="mb-1 text-[1rem] font-medium text-text-primary">CV</h2>
      <p className="mb-5 text-[0.825rem] leading-[1.6] text-text-muted">
        Kept for you and, if you allow it once on upload, read to generate
        a searchable summary of your background and skills. Only you and
        admins handling account reviews can open the file itself.
      </p>
      {error && <div className="mb-4"><ErrorBanner>{error}</ErrorBanner></div>}

      {present && !file && !changing ? (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border-strong bg-white/[0.04] p-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border bg-white/[0.03] font-mono text-[0.65rem] text-text-secondary">
            CV
          </span>
          {/* min-w-[9rem]: three buttons (alumni) previously squeezed this
              column hard enough to truncate the filename to "My_…" and wrap
              "Uploaded …" onto a colliding second line — found by actually
              looking at a rendered screenshot, not from reading the JSX. */}
          <span className="min-w-[9rem] flex-1">
            <span className="block truncate text-[0.85rem] text-text-primary">{filename ?? "Your CV"}</span>
            {uploadedAt && (
              <span className="block truncate text-[0.75rem] text-text-muted">
                Uploaded {new Date(uploadedAt).toLocaleDateString("en-GB", {
                  day: "numeric", month: "short", year: "numeric",
                })}
              </span>
            )}
          </span>
          {/* Grouped so the three buttons wrap onto their own line as a unit
              on a narrow container, rather than each one individually
              fighting the filename column for space. */}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={download} className="shrink-0 cursor-pointer rounded-lg border border-border-strong bg-white/[0.04] px-3 py-2 text-[0.775rem] text-text-secondary transition-colors duration-150 hover:border-accent hover:text-text-primary">
              Download
            </button>
            <button type="button" onClick={() => setChanging(true)} className="shrink-0 cursor-pointer rounded-lg border border-border-strong bg-white/[0.04] px-3 py-2 text-[0.775rem] text-text-secondary transition-colors duration-150 hover:border-accent hover:text-text-primary">
              Change CV
            </button>
            {/* Students' CVs are required (screens.tsx's cvRequired) — removing
                down to nothing isn't offered to them at all, and the RPC itself
                also refuses it, so this is UX clarity, not the enforcement. */}
            {canRemove && (
              <button type="button" onClick={remove} className="shrink-0 cursor-pointer rounded-lg border border-border-strong bg-white/[0.04] px-3 py-2 text-[0.775rem] text-text-secondary transition-colors duration-150 hover:border-[#ff4d4d]/60 hover:text-[#ff8080]">
                Remove CV
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <FilePicker
            accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            label="Drop a PDF or DOCX"
            hint="or click to browse · 8 MB maximum"
            file={file}
            onPick={setFile}
            onClear={() => setFile(null)}
          />
          {changing && (
            <button
              type="button"
              onClick={() => { setChanging(false); setFile(null); setError(""); }}
              className="mt-2 cursor-pointer text-[0.775rem] text-text-muted underline decoration-dotted underline-offset-2 hover:text-text-secondary"
            >
              Cancel — keep my current CV
            </button>
          )}
          {file && (
            <>
              {ingestionEnabled ? (
                <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg border border-border-strong bg-white/[0.03] p-4">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--color-accent)]"
                  />
                  <span className="text-[0.8rem] leading-[1.6] text-text-secondary">
                    Read my CV to suggest skills to add above and generate a
                    searchable summary of my background. The extracted text
                    and summary are stored and used to help match me to
                    relevant opportunities.
                  </span>
                </label>
              ) : (
                <p className="mt-3 rounded-lg border border-border-strong bg-white/[0.03] p-4 text-[0.8rem] leading-[1.6] text-text-muted">
                  CV-based skill matching is temporarily paused — your file will still be saved.
                </p>
              )}
              <Button type="button" onClick={upload} loading={uploading} variant="primary" size="md" className="mt-3">
                Upload CV
              </Button>
            </>
          )}
        </>
      )}

      {showProcessingDialog && (
        <CvProcessingDialog onClose={() => setShowProcessingDialog(false)} />
      )}
    </section>
  );
}

function GithubSection({
  username, scanStatus, scanFailureReason, ingestionEnabled,
}: {
  username: string | null;
  scanStatus: GithubScanStatus | null;
  scanFailureReason: string | null;
  ingestionEnabled: boolean;
}) {
  const searchParams = useSearchParams();
  const [connected, setConnected] = useState(!!username);
  const [status, setStatus] = useState(scanStatus);
  const [error, setError] = useState(
    searchParams.get("github") === "error" ? "We couldn't connect your GitHub account. Please try again." : "",
  );
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  // Opened by the OAuth return (phase: scanning), or by the member
  // choosing to change their picks (phase: picking).
  const [dialog, setDialog] = useState<null | "scan" | "pick">(
    searchParams.get("github") === "connected" ? "scan" : null,
  );

  const [picks, setPicks] = useState<ShowcaseRepo[] | null>(null);
  const [themes, setThemes] = useState<string[]>([]);
  const [needsReview, setNeedsReview] = useState(false);
  const [nudgesEnabled, setNudgesEnabled] = useState(true);
  const [dismissing, setDismissing] = useState(false);

  // The picks and the review flag both change as a side effect of the
  // dialog and of background scans, so they're loaded here rather than
  // threaded through the server component — one small RPC on a page the
  // member opened deliberately.
  const refreshShowcase = useCallback(async () => {
    const [showcase, statusResult] = await Promise.all([
      getMyGithubShowcase(),
      getMyGithubStatus(),
    ]);
    if (showcase.ok && showcase.data) {
      setPicks(showcase.data.showcaseRepos);
      setThemes(showcase.data.themes);
    }
    if (statusResult.ok && statusResult.data) {
      setNeedsReview(statusResult.data.needsShowcaseReview);
      setStatus(statusResult.data.scanStatus);
    }
  }, []);

  useEffect(() => {
    // refreshShowcase awaits two server actions before it touches any
    // state, so nothing is actually set synchronously here — the rule
    // traces into the callback without seeing the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (connected) void refreshShowcase();
  }, [connected, refreshShowcase]);

  const connect = async () => {
    setError("");
    setConnecting(true);
    try {
      const result = await requestGithubConnectUrl("profile");
      if (!result.ok) { setError(result.error); return; }
      window.location.href = result.data;
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    setError("");
    setDisconnecting(true);
    try {
      const result = await disconnectGithub();
      if (!result.ok) { setError(result.error); return; }
      setConnected(false);
      setStatus(null);
      setPicks(null);
      setNeedsReview(false);
      setConfirmingDisconnect(false);
    } finally {
      setDisconnecting(false);
    }
  };

  const dismissPrompt = async () => {
    setDismissing(true);
    try {
      const result = await dismissGithubShowcasePrompt();
      if (result.ok) setNeedsReview(false);
    } finally {
      setDismissing(false);
    }
  };

  const toggleNudges = async (enabled: boolean) => {
    setNudgesEnabled(enabled);
    const result = await setGithubNudges(enabled);
    if (!result.ok) setNudgesEnabled(!enabled); // revert on failure
  };

  const statusLabel =
    status === "ready" ? "Repositories scanned"
      : status === "failed" ? (scanFailureReason ?? "Scan failed")
        : "Scanning your repositories…";

  return (
    <section className="rounded-2xl border border-border bg-bg-card p-6 sm:p-8">
      <h2 className="mb-1 text-[1rem] font-medium text-text-primary">GitHub</h2>
      <p className="mb-5 text-[0.825rem] leading-[1.6] text-text-muted">
        Optional. Connect your GitHub account to have your public
        repositories count as an extra skill signal alongside your CV —
        real GitHub sign-in and authorisation, nothing to generate or
        paste in yourself.
      </p>
      {error && <div className="mb-4"><ErrorBanner>{error}</ErrorBanner></div>}

      {connected ? (
        <div className="space-y-4">
          <div className="flex items-center gap-4 rounded-lg border border-border-strong bg-white/[0.04] p-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border bg-white/[0.03] font-mono text-[0.65rem] text-text-secondary">
              GH
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.85rem] text-text-primary">@{username}</span>
              <span className="block text-[0.75rem] text-text-muted">{statusLabel}</span>
            </span>
            <button
              type="button"
              onClick={() => setConfirmingDisconnect(true)}
              disabled={disconnecting}
              className="shrink-0 cursor-pointer rounded-lg border border-border-strong bg-white/[0.04] px-3 py-2 text-[0.775rem] text-text-secondary transition-colors duration-150 hover:border-[#ff4d4d]/60 hover:text-[#ff8080] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Disconnect
            </button>
          </div>

          {/* Disconnecting deletes the picks and the hand-written blurbs
              along with the connection (disconnect_github drops the row).
              That is the right privacy default, but it is not something a
              member should discover afterwards. */}
          {confirmingDisconnect && (
            <div className="rounded-lg border border-[#ff4d4d]/40 bg-[#ff4d4d]/[0.06] p-4">
              <p className="mb-3 text-[0.8rem] text-text-secondary">
                Disconnecting removes your GitHub-derived skills, your spotlit projects and the
                descriptions you wrote for them. You can reconnect later, but you&apos;ll need to
                choose your projects again.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="dangerGhost" size="sm" loading={disconnecting} onClick={disconnect}>
                  Disconnect GitHub
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingDisconnect(false)}>
                  Keep it connected
                </Button>
              </div>
            </div>
          )}

          {needsReview && (
            <div className="rounded-lg border border-accent/50 bg-accent/[0.06] p-4">
              <p className="mb-3 text-[0.8rem] text-text-secondary">
                There&apos;s something new on your GitHub that you haven&apos;t looked at yet. Want to
                update which projects recruiters see?
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => setDialog("pick")}>
                  Review projects
                </Button>
                <Button type="button" variant="ghost" size="sm" loading={dismissing} onClick={dismissPrompt}>
                  Not now
                </Button>
              </div>
            </div>
          )}

          {status === "ready" && (
            <div className="rounded-lg border border-border-strong bg-white/[0.02] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[0.85rem] text-text-primary">Spotlit projects</h3>
                <Button type="button" variant="ghost" size="sm" onClick={() => setDialog("pick")}>
                  {picks && picks.length > 0 ? "Change projects" : "Choose projects"}
                </Button>
              </div>
              {picks && picks.length > 0 ? (
                <ul className="space-y-2">
                  {picks.map((repo) => (
                    <li key={repo.name} className="rounded-lg border border-border bg-white/[0.02] p-3">
                      <a
                        href={externalHref(repo.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[0.825rem] text-text-primary underline-offset-2 hover:underline"
                      >
                        {repo.name}
                      </a>
                      {(repo.blurb ?? repo.description) && (
                        <p className="mt-1 text-[0.775rem] text-text-secondary">
                          {repo.blurb ?? repo.description}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[0.8rem] text-text-muted">
                  You haven&apos;t chosen any yet. Until you do, we&apos;ll show the projects our scan
                  rated highest.
                </p>
              )}

              {/* The written summary leads with one dominant thread and gives
                  at most a brief mention to a second, so it stays skimmable —
                  these tags are where the rest of what the scan found still
                  shows up, rather than getting cut from the prose entirely. */}
              {themes.length > 0 && (
                <div className="mt-4">
                  <p className="mb-1.5 text-[0.7rem] text-text-muted">What your code says about you</p>
                  <div className="flex flex-wrap gap-1.5">
                    {themes.map((theme) => (
                      <span
                        key={theme}
                        className="rounded-full border border-border-strong bg-white/[0.03] px-2.5 py-1 text-[0.7rem] text-text-secondary"
                      >
                        {theme}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <label className="mt-4 flex cursor-pointer items-start gap-2 text-[0.75rem] text-text-muted">
                <input
                  type="checkbox"
                  checked={nudgesEnabled}
                  onChange={(event) => void toggleNudges(event.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-accent)]"
                />
                Email me when I&apos;ve pushed something worth spotlighting (at most once a month)
              </label>
            </div>
          )}
        </div>
      ) : ingestionEnabled ? (
        <Button type="button" onClick={connect} loading={connecting} variant="primary" size="md">
          Connect GitHub
        </Button>
      ) : (
        <p className="text-[0.8rem] text-text-muted">
          GitHub connections are temporarily paused — check back soon.
        </p>
      )}

      {dialog && (
        <GithubDialog
          startAtPicker={dialog === "pick"}
          onClose={() => { setDialog(null); void refreshShowcase(); }}
          onSaved={() => { setNeedsReview(false); void refreshShowcase(); }}
        />
      )}
    </section>
  );
}
