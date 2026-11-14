"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ChipGroup, type ChipItem } from "@/components/forms/ChipGroup";
import { ErrorBanner, SuccessBanner } from "@/components/forms/Banners";
import { Field as FormField } from "@/components/forms/Field";
import {
  Field, ChoiceCards, PillChoice, TagInput, FilePicker, RankPicker, SkillPicker, type SkillOption,
} from "@/components/intake/controls";
import { AvatarCropper } from "@/components/media/AvatarCropper";
import { cleanName, cleanText, isValidName, MAX_NAME_LENGTH } from "@/lib/text";
import { gradYearOptions, validateGradYear } from "@/lib/gradYears";
import { describeSupabaseError, isSessionExpiredError } from "@/lib/supabaseErrors";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { Textarea } from "@/components/ui/Textarea";
import { Disc } from "@/design-system/icons/Disc";
import { Icon } from "@/design-system/icons/Icon";
import { SettingsSection } from "@/app/settings/SettingsSection";
import { track } from "@/lib/analytics/track";
import { invalidateDirectoryCache } from "@/app/profile/actions";
import {
  requestAvatarTicket, confirmAvatarUpload, removeAvatar,
  requestCvTicket, confirmCvUpload, removeCv, getMyCvDownloadUrl,
  getMySuggestedCvSkillIds, getMyCvStatus, type CvIngestStatus,
  disconnectGithub, type GithubScanStatus,
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
import { settle } from "@/lib/settle";
import { watchProgress } from "@/lib/realtime/progress";

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
  editVersion: number;
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

  // Not rendered anywhere — only ever read/written from handleSubmit — so a
  // ref, not state. A ref also means the effect below can resync it from a
  // fresh prop without forcing an extra render.
  //
  // The resync matters because this prop genuinely changes under us: role
  // is one of the columns optimistic_edits.sql's trigger bumps edit_version
  // on, and AffiliationSection saves role through its own RPC + router.refresh()
  // on this same page. Without the effect, changing affiliation first and
  // then "Save changes" here would submit a stale p_expected_version and
  // fail the optimistic-lock check for no reason visible to the member.
  const editVersionRef = useRef(props.editVersion);
  useEffect(() => {
    editVersionRef.current = props.editVersion;
  }, [props.editVersion]);
  const submitting = useRef(false);
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- editable form field, seeded once from props and only ever mutated by this form's own handleSubmit; no other writer touches it while mounted
  const [firstName, setFirstName] = useState(props.firstName);
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- editable form field, seeded once from props and only ever mutated by this form's own handlers; no other writer touches it while mounted
  const [surname, setSurname] = useState(props.surname);
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- editable form field, seeded once from props and only ever mutated by this form's own handlers; no other writer touches it while mounted
  const [course, setCourse] = useState(props.course);
  const [gradYear, setGradYear] = useState<string>(() => props.gradYear?.toString() ?? "");
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- editable form field, seeded once from props and only ever mutated by this form's own handlers; no other writer touches it while mounted
  const [linkedin, setLinkedin] = useState(props.linkedinUrl);
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- editable form field, seeded once from props and only ever mutated by this form's own handlers; no other writer touches it while mounted
  const [github, setGithub] = useState(props.githubUrl);
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- editable form field, seeded once from props and only ever mutated by this form's own handlers; no other writer touches it while mounted
  const [portfolio, setPortfolio] = useState(props.portfolioUrl);

  // react-doctor-disable-next-line react-doctor/no-derived-useState -- editable form field, seeded once from props and only ever mutated by this form's own handlers; no other writer touches it while mounted
  const [preferredName, setPreferredName] = useState(props.preferredName);
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- editable form field, seeded once from props and only ever mutated by this form's own handlers; no other writer touches it while mounted
  const [bioFocus, setBioFocus] = useState(props.bioFocus);
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- editable form field, seeded once from props and only ever mutated by this form's own handlers; no other writer touches it while mounted
  const [bioHobbies, setBioHobbies] = useState(props.bioHobbies);

  // react-doctor-disable-next-line react-doctor/no-derived-useState -- editable form field, seeded once from props and only ever mutated by this form's own handlers; no other writer touches it while mounted
  const [skillIds, setSkillIds] = useState<number[]>(props.selectedSkillIds);
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- editable form field, seeded once from props and only ever mutated by this form's own handlers; no other writer touches it while mounted
  const [coreSkillIds, setCoreSkillIds] = useState<number[]>(props.selectedCoreSkillIds);
  const [suggestedSkillIds, setSuggestedSkillIds] = useState<number[]>([]);
  const [sectorIds, setSectorIds] = useState<Set<number>>(() => new Set(props.selectedSectors));
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- editable form field, seeded once from props and only ever mutated by this form's own handlers; no other writer touches it while mounted
  const [academicInterests, setAcademicInterests] = useState<string[]>(props.academicInterests);
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- editable form field, seeded once from props and only ever mutated by this form's own handlers; no other writer touches it while mounted
  const [hobbies, setHobbies] = useState<string[]>(props.hobbies);

  // react-doctor-disable-next-line react-doctor/no-derived-useState -- editable form field, seeded once from props and only ever mutated by this form's own handlers; no other writer touches it while mounted
  const [currentFocus, setCurrentFocus] = useState(props.currentFocus);
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- editable form field, seeded once from props and only ever mutated by this form's own handlers; no other writer touches it while mounted
  const [ventureStage, setVentureStage] = useState(props.ventureStage);
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- editable form field, seeded once from props and only ever mutated by this form's own handlers; no other writer touches it while mounted
  const [ventureName, setVentureName] = useState(props.ventureName);
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- editable form field, seeded once from props and only ever mutated by this form's own handlers; no other writer touches it while mounted
  const [ventureUrl, setVentureUrl] = useState(props.ventureUrl);
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- editable form field, seeded once from props and only ever mutated by this form's own handlers; no other writer touches it while mounted
  const [ventureOneLiner, setVentureOneLiner] = useState(props.ventureOneLiner);
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- editable form field, seeded once from props and only ever mutated by this form's own handlers; no other writer touches it while mounted
  const [recruitingStatus, setRecruitingStatus] = useState(props.recruitingStatus);

  // react-doctor-disable-next-line react-doctor/no-derived-useState -- editable form field, seeded once from props and only ever mutated by this form's own handlers; no other writer touches it while mounted
  const [intents, setIntents] = useState<string[]>(props.intents);
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- editable form field, seeded once from props and only ever mutated by this form's own handlers; no other writer touches it while mounted
  const [intentUrgency, setIntentUrgency] = useState(props.intentUrgency);
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- editable form field, seeded once from props and only ever mutated by this form's own handlers; no other writer touches it while mounted
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
    if (submitting.current) return;
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

    submitting.current = true;
    setIsLoading(true);
    try {
      const { data: nextVersion, error: rpcError } = await supabase.rpc("update_profile", {
        p_expected_version: editVersionRef.current,
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

      editVersionRef.current = nextVersion!;
      setSaved(true);
      await invalidateDirectoryCache();
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Try again in a moment.");
    } finally {
      submitting.current = false;
      setIsLoading(false);
    }
  };

  const skillIdSet = new Set(skillIds);
  const taxonomyById = new Map(props.skillTaxonomy.map((t) => [t.id, t]));
  const suggestedSkills = suggestedSkillIds
    .filter((id) => !skillIdSet.has(id))
    .map((id) => taxonomyById.get(id))
    .filter((t): t is SkillOption => !!t);

  const showVentureDetail = VENTURE_STAGES_WITH_DETAIL.has(ventureStage);

  return (
    <div>
      <SaveResult error={error} saved={saved} errorRef={errorRef} />

      <PhotoSection avatarUrl={props.avatarUrl} name={`${firstName} ${surname}`.trim()} meta={[course.trim(), gradYear].filter(Boolean).join(" · ")} />

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

      <form onSubmit={handleSubmit}>
        <IdentityFields
          role={props.role}
          firstName={firstName} setFirstName={setFirstName}
          surname={surname} setSurname={setSurname}
          preferredName={preferredName} setPreferredName={setPreferredName}
          course={course} setCourse={setCourse}
          gradYear={gradYear} setGradYear={setGradYear}
          linkedin={linkedin} setLinkedin={setLinkedin}
          github={github} setGithub={setGithub}
          portfolio={portfolio} setPortfolio={setPortfolio}
          bioFocus={bioFocus} setBioFocus={setBioFocus}
          bioHobbies={bioHobbies} setBioHobbies={setBioHobbies}
        />

        <SkillsAndInterests
          skillTaxonomy={props.skillTaxonomy}
          skillIds={skillIds} setSkillIds={setSkillIds}
          coreSkillIds={coreSkillIds} setCoreSkillIds={setCoreSkillIds}
          suggestedSkills={suggestedSkills}
          toggleCoreSkill={toggleCoreSkill}
          sectors={props.sectors}
          sectorIds={sectorIds} toggleSector={toggleSector}
          academicInterests={academicInterests} setAcademicInterests={setAcademicInterests}
          hobbies={hobbies} setHobbies={setHobbies}
        />

        <WhereYoureAt
          currentFocus={currentFocus} setCurrentFocus={setCurrentFocus}
          ventureStage={ventureStage} setVentureStage={setVentureStage}
          showVentureDetail={showVentureDetail}
          ventureName={ventureName} setVentureName={setVentureName}
          ventureUrl={ventureUrl} setVentureUrl={setVentureUrl}
          ventureOneLiner={ventureOneLiner} setVentureOneLiner={setVentureOneLiner}
          recruitingStatus={recruitingStatus} setRecruitingStatus={setRecruitingStatus}
        />

        <WhatYouWant
          intents={intents} toggleIntent={toggleIntent}
          intentUrgency={intentUrgency} setIntentUrgency={setIntentUrgency}
          availabilityHours={availabilityHours} setAvailabilityHours={setAvailabilityHours}
        />

        <SaveRow loading={isLoading} />
      </form>
    </div>
  );
}

// The result of the last save, above the first row and on the controls' line.
function SaveResult({
  error, saved, errorRef,
}: {
  error: string;
  saved: boolean;
  errorRef: React.RefObject<HTMLDivElement | null>;
}) {
  if (!error && !saved) return null;
  return (
    <div className="grid pt-8 xl:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] xl:gap-x-12">
      <div className="grid max-w-[34rem] gap-3 xl:col-start-2">
        {error && <div ref={errorRef}><ErrorBanner>{error}</ErrorBanner></div>}
        {saved && !error && <SuccessBanner>Saved.</SuccessBanner>}
      </div>
    </div>
  );
}

// The one primary action of the page, on the controls' line.
function SaveRow({ loading }: { loading: boolean }) {
  return (
    <div className="grid gap-x-12 border-t border-border-subtle py-9 xl:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
      <div className="xl:col-start-2">
        <Button type="submit" loading={loading} variant="primary" size="lg">
          Save changes
        </Button>
      </div>
    </div>
  );
}

// ─── Identity / skills / status field groups ──────────────────────

function IdentityFields({
  role, firstName, setFirstName, surname, setSurname, preferredName, setPreferredName,
  course, setCourse, gradYear, setGradYear, linkedin, setLinkedin, github, setGithub,
  portfolio, setPortfolio, bioFocus, setBioFocus, bioHobbies, setBioHobbies,
}: {
  role: Affiliation;
  firstName: string; setFirstName: (v: string) => void;
  surname: string; setSurname: (v: string) => void;
  preferredName: string; setPreferredName: (v: string) => void;
  course: string; setCourse: (v: string) => void;
  gradYear: string; setGradYear: (v: string) => void;
  linkedin: string; setLinkedin: (v: string) => void;
  github: string; setGithub: (v: string) => void;
  portfolio: string; setPortfolio: (v: string) => void;
  bioFocus: string; setBioFocus: (v: string) => void;
  bioHobbies: string; setBioHobbies: (v: string) => void;
}) {
  return (
    <SettingsSection title="Identity">
      <div className="grid gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="First name">
            <Input id="first-name" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={MAX_NAME_LENGTH} required />
          </FormField>
          <FormField label="Surname">
            <Input id="surname" type="text" value={surname} onChange={(e) => setSurname(e.target.value)} maxLength={MAX_NAME_LENGTH} required />
          </FormField>
        </div>

        <FormField label="What people call you" hint="— optional">
          <Input id="preferred-name" type="text" value={preferredName} onChange={(e) => setPreferredName(e.target.value)} maxLength={MAX_NAME_LENGTH} />
        </FormField>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label={role === "alum" ? "Course studied" : "Course you're studying"}>
            <Input
              id="course" type="text" value={course} onChange={(e) => setCourse(e.target.value)}
              maxLength={200}
              placeholder={role === "alum" ? "e.g. MEng Computing" : "e.g. BSc Mathematics"}
              required
            />
          </FormField>
          <FormField label={role === "alum" ? "Graduation year" : "Expected graduation year"}>
            <Select id="grad-year" value={gradYear} onChange={(e) => setGradYear(e.target.value)} required>
              <option value="">Select a year</option>
              {gradYearOptions(role).map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
          </FormField>
        </div>

        <FormField label="LinkedIn URL" hint={role === "student" ? "— optional" : undefined}>
          <Input id="linkedin" type="url" placeholder="https://linkedin.com/in/your-handle" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} maxLength={512} required={role !== "student"} />
        </FormField>

        <FormField label="GitHub URL" hint="— optional">
          <Input id="github" type="url" placeholder="https://github.com/your-handle" value={github} onChange={(e) => setGithub(e.target.value)} maxLength={512} />
        </FormField>

        <FormField label="Portfolio URL" hint="— optional">
          <Input id="portfolio" type="url" placeholder="https://yourportfolio.com" value={portfolio} onChange={(e) => setPortfolio(e.target.value)} maxLength={512} />
        </FormField>

        <FormField label="What are you working on, or into?" hint={`${bioFocus.length}/500`}>
          <Textarea id="bio-focus" rows={3} value={bioFocus} onChange={(e) => setBioFocus(e.target.value)} className="resize-none" maxLength={500} />
        </FormField>

        <FormField label="And outside of that?" hint={`${bioHobbies.length}/500`}>
          <Textarea id="bio-hobbies" rows={2} value={bioHobbies} onChange={(e) => setBioHobbies(e.target.value)} className="resize-none" maxLength={500} />
        </FormField>
      </div>
    </SettingsSection>
  );
}

function SkillsAndInterests({
  skillTaxonomy, skillIds, setSkillIds, coreSkillIds, setCoreSkillIds, suggestedSkills, toggleCoreSkill,
  sectors, sectorIds, toggleSector, academicInterests, setAcademicInterests, hobbies, setHobbies,
}: {
  skillTaxonomy: SkillOption[];
  skillIds: number[]; setSkillIds: React.Dispatch<React.SetStateAction<number[]>>;
  coreSkillIds: number[]; setCoreSkillIds: React.Dispatch<React.SetStateAction<number[]>>;
  suggestedSkills: SkillOption[];
  toggleCoreSkill: (id: number) => void;
  sectors: ChipItem[];
  sectorIds: Set<number>; toggleSector: (id: number) => void;
  academicInterests: string[]; setAcademicInterests: React.Dispatch<React.SetStateAction<string[]>>;
  hobbies: string[]; setHobbies: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  return (
    <>
      <SettingsSection title="Skills">
        <SkillPicker
          taxonomy={skillTaxonomy}
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
      </SettingsSection>

      <SettingsSection title="Interests">
        <div className="grid gap-6">
          <ChipGroup label="Sectors" items={sectors} selected={sectorIds} onToggle={toggleSector} />
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
        </div>
      </SettingsSection>
    </>
  );
}

function WhereYoureAt({
  currentFocus, setCurrentFocus, ventureStage, setVentureStage, showVentureDetail,
  ventureName, setVentureName, ventureUrl, setVentureUrl, ventureOneLiner, setVentureOneLiner,
  recruitingStatus, setRecruitingStatus,
}: {
  currentFocus: string; setCurrentFocus: (v: string) => void;
  ventureStage: string; setVentureStage: (v: string) => void;
  showVentureDetail: boolean;
  ventureName: string; setVentureName: (v: string) => void;
  ventureUrl: string; setVentureUrl: (v: string) => void;
  ventureOneLiner: string; setVentureOneLiner: (v: string) => void;
  recruitingStatus: string; setRecruitingStatus: (v: string) => void;
}) {
  return (
    <SettingsSection title="Where you're at">
      <div className="grid gap-6">
        <Field label="What's your situation right now?">
          <ChoiceCards name="Current focus" columns={2} options={CURRENT_FOCUS} value={currentFocus || null} onChange={setCurrentFocus} />
        </Field>
        <Field label="Where's your venture at?">
          <ChoiceCards name="Venture stage" columns={2} options={VENTURE_STAGES} value={ventureStage || null} onChange={setVentureStage} />
        </Field>
        {showVentureDetail && (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField label="Venture name">
                <Input id="venture-name" type="text" maxLength={200} value={ventureName} onChange={(e) => setVentureName(e.target.value)} />
              </FormField>
              <FormField label="Website">
                <Input id="venture-url" type="url" maxLength={512} value={ventureUrl} onChange={(e) => setVentureUrl(e.target.value)} placeholder="https://…" />
              </FormField>
            </div>
            <FormField label="One line on what it does">
              <Input id="venture-one-liner" type="text" maxLength={140} value={ventureOneLiner} onChange={(e) => setVentureOneLiner(e.target.value)} />
            </FormField>
            <Field label="Recruiting?">
              <PillChoice name="Recruiting" options={RECRUITING_STATUSES} value={recruitingStatus} onChange={setRecruitingStatus} />
            </Field>
          </>
        )}
      </div>
    </SettingsSection>
  );
}

function WhatYouWant({
  intents, toggleIntent, intentUrgency, setIntentUrgency, availabilityHours, setAvailabilityHours,
}: {
  intents: string[]; toggleIntent: (v: string) => void;
  intentUrgency: string; setIntentUrgency: (v: string) => void;
  availabilityHours: string; setAvailabilityHours: (v: string) => void;
}) {
  return (
    <SettingsSection title="What you want">
      <div className="grid gap-6">
        <Field label={`Pick up to ${MAX_INTENTS}, in order`}>
          <RankPicker options={INTENTS} values={intents} onToggle={toggleIntent} max={MAX_INTENTS} />
        </Field>
        <Field label="How urgent?">
          <PillChoice name="Urgency" options={INTENT_URGENCIES} value={intentUrgency} onChange={setIntentUrgency} />
        </Field>
        <Field label="Hours a week for something new">
          <PillChoice name="Hours a week" options={AVAILABILITY_HOURS} value={availabilityHours} onChange={setAvailabilityHours} />
        </Field>
      </div>
    </SettingsSection>
  );
}

// ─── Photo ─────────────────────────────────────────────────────────

// The photo, and the card you are putting together: the avatar (or the initials you appear with until there is a photo) beside the name and
// course as they are typed in the form below. Only values the form already holds, drawn live.
function PhotoSection({ avatarUrl, name, meta }: { avatarUrl: string | null; name: string; meta: string }) {
  const router = useRouter();
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- seeded once from props and only ever mutated by this component's own upload/remove action handlers; no other writer touches it while mounted
  const [preview, setPreview] = useState<string | null>(avatarUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const replaceRef = useRef<HTMLInputElement>(null);

  // Revokes whichever blob: URL is current on unmount (e.g. navigating away
  // with a freshly-uploaded preview still in state) — the explicit revokes in
  // upload() and remove() below only cover replacing or clearing it while
  // this component stays mounted.
  const previewRef = useRef(preview);
  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);
  useEffect(() => () => {
    if (previewRef.current?.startsWith("blob:")) URL.revokeObjectURL(previewRef.current);
  }, []);

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
      // react-doctor-disable-next-line react-doctor/no-create-object-url-without-revoke -- revoke is covered on replacement (above), on remove(), and on unmount via previewRef's cleanup effect
      setPreview(URL.createObjectURL(blob));
      setPendingFile(null);
      router.refresh();
    } catch {
      setError("Couldn't reach the photo service. Try again in a moment.");
    } finally {
      setUploading(false);
    }
  };

  const [removing, setRemoving] = useState(false);
  const remove = async () => {
    if (removing) return;
    setError("");
    setRemoving(true);
    const result = await settle(removeAvatar());
    setRemoving(false);
    if (!result.ok) { setError(result.error); return; }
    if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    setPreview(null);
    router.refresh();
  };

  return (
    <SettingsSection title="Photo" description="What people see first in the directory.">
      <div className="grid gap-4">
        {error && <ErrorBanner>{error}</ErrorBanner>}

        {pendingFile ? (
          <AvatarCropper file={pendingFile} onCropped={upload} onCancel={() => setPendingFile(null)} />
        ) : (
          <>
            <Panel className="flex flex-wrap items-center gap-x-5 gap-y-4 p-5">
              <Avatar src={preview} name={name} size="lg" />
              <div className="min-w-[8rem] flex-1">
                {name && <p className="truncate font-display text-lead text-text-primary">{name}</p>}
                {meta && <p className="truncate text-small text-text-secondary">{meta}</p>}
                {preview && <p className="text-small text-text-muted">{uploading ? "Uploading…" : "Current photo"}</p>}
              </div>
              {preview && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => replaceRef.current?.click()}>
                    Replace
                  </Button>
                  <Button type="button" variant="dangerGhost" size="sm" onClick={remove} loading={removing}>
                    {removing ? "Removing…" : "Remove"}
                  </Button>
                  <input ref={replaceRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Replace photo" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) setPendingFile(f); e.target.value = ""; }} />
                </div>
              )}
            </Panel>
            {!preview && (
              <FilePicker accept="image/jpeg,image/png,image/webp" label="Add a photo" hint="JPG, PNG or WebP" file={null} onPick={setPendingFile} onClear={() => {}} />
            )}
          </>
        )}
      </div>
    </SettingsSection>
  );
}

// ─── CV ────────────────────────────────────────────────────────────

/**
 * Waits for confirmCvUpload's background extraction to land the
 * suggestion chips, rather than the multi-screen gap the intake flow gets
 * for free — this page has no equivalent "a few steps later" moment.
 * Re-reads only when the suggestions column changes (lib/realtime/progress),
 * so waiting longer costs nothing. Gives up silently after 30 s; the
 * suggestions just won't show for this visit, same as any other
 * best-effort background result. confirm_cv_upload clears the previous
 * CV's suggestions, so the first read can't show stale chips.
 */
const SUGGESTION_WAIT_MS = 30_000;
function watchForSuggestions(onSuggested: (ids: number[]) => void): () => void {
  const stop = watchProgress({
    kind: "cv_suggestions",
    fetch: async () => {
      const result = await getMySuggestedCvSkillIds();
      return result.ok ? result.data : [];
    },
    onResult: (ids) => {
      if (ids.length === 0) return "continue";
      onSuggested(ids);
      return "stop";
    },
    onError: () => {},
    baseMs: 1200,
  });
  const deadline = setTimeout(stop, SUGGESTION_WAIT_MS);
  return () => {
    clearTimeout(deadline);
    stop();
  };
}

const CV_INGEST_PROCESSING: CvIngestStatus[] = ["pending", "extracting", "embedding"];

/**
 * Drives the inline "Processing your CV…" badge, independent of
 * CvProcessingDialog's own polling — that dialog now only opens on
 * request (a member clicking "View details"), not automatically on
 * upload, so it can't be the thing tracking whether processing is still
 * in flight. Stops on unmount via the cancelled flag, same guard the
 * dialog's own poll effect uses.
 */
// B20: re-reads on the CV row's change signal (lib/realtime/progress), falling
// back to lib/poll.ts. The old loop had no try/catch, so a thrown status
// request left the badge on "Processing your CV…" for good.
function pollIngestStatus(
  setStatus: (status: CvIngestStatus | null) => void,
  onFailed: () => void,
): () => void {
  return watchProgress({
    kind: "cv",
    fetch: async () => {
      const result = await getMyCvStatus();
      if (!result.ok || !result.data) throw new Error("status unavailable");
      return result.data.status;
    },
    onResult: (status) => {
      setStatus(status);
      return CV_INGEST_PROCESSING.includes(status) ? "continue" : "stop";
    },
    onError: onFailed,
    baseMs: 2000,
  });
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
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- seeded once from props and only ever mutated by this component's own upload/remove action handlers; no other writer touches it while mounted
  const [present, setPresent] = useState(hasCv);
  const [filename, setFilename] = useState(originalFilename);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [showProcessingDialog, setShowProcessingDialog] = useState(false);
  // Drives the inline badge below — set once a fresh upload starts
  // pollIngestStatus, null again once nothing has been tracked this visit
  // (an existing CV from a prior visit isn't polled; this only ever
  // reflects processing started in THIS session, same scope the dialog
  // used to have).
  const [ingestStatus, setIngestStatus] = useState<CvIngestStatus | null>(null);
  const [ingestCheckFailed, setIngestCheckFailed] = useState(false);
  const stopIngestPollRef = useRef<(() => void) | null>(null);
  const stopSuggestionsRef = useRef<(() => void) | null>(null);
  useEffect(() => () => {
    stopIngestPollRef.current?.();
    stopSuggestionsRef.current?.();
  }, []);
  const trackIngest = () => {
    stopIngestPollRef.current?.();
    setIngestCheckFailed(false);
    stopIngestPollRef.current = pollIngestStatus(setIngestStatus, () => setIngestCheckFailed(true));
  };
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
      track("cv_uploaded", { consent });

      setPresent(true);
      setFilename(file.name);
      setFile(null);
      setChanging(false);
      router.refresh();

      // Extraction runs in the background (mediaActions.confirmCvUpload's
      // after() callback) rather than blocking this upload — wait for it to
      // land instead of making the member wait on it.
      if (consent) {
        stopSuggestionsRef.current?.();
        stopSuggestionsRef.current = watchForSuggestions(onSuggested);
      }

      // confirm_cv_upload only enqueues the CV matchmaker's ingest
      // pipeline (moderation, extraction, skill normalisation,
      // chunk+embed — cv-matchmaker-spec.md) when consent is ticked, same
      // gate as the suggestion prefill above — see privacy policy section
      // 2a. Tracked here as an inline badge, not a forced dialog — this
      // used to auto-open CvProcessingDialog as a blocking modal the
      // moment upload confirmed, which made the rest of the page
      // (Connect GitHub included) unclickable until a member noticed the
      // dialog's close button. The badge below is the non-blocking
      // equivalent; CvProcessingDialog is still there, just opened on
      // request via "View details" once there's something to show.
      if (consent) trackIngest();
    } catch {
      setError("Couldn't reach the file service. Try again in a moment.");
    } finally {
      setUploading(false);
    }
  };

  // B6: one action at a time, each with a visible pending state.
  const [cvBusy, setCvBusy] = useState<null | "download" | "remove">(null);

  const remove = async () => {
    if (cvBusy) return;
    setError("");
    setCvBusy("remove");
    const result = await settle(removeCv());
    setCvBusy(null);
    if (!result.ok) { setError(result.error); return; }
    setPresent(false);
    setFilename(null);
    router.refresh();
  };

  const download = async () => {
    if (cvBusy) return;
    setError("");
    setCvBusy("download");
    const result = await settle(getMyCvDownloadUrl());
    setCvBusy(null);
    if (!result.ok) { setError(result.error); return; }
    if (result.data) window.open(result.data, "_blank", "noopener");
  };

  return (
    <SettingsSection
      title="CV"
      description="Kept for you and, if you allow it once on upload, read to generate a searchable summary of your background and skills. Only you and admins handling account reviews can open the file itself."
    >
      <div className="grid gap-4">
        {error && <ErrorBanner>{error}</ErrorBanner>}

        {present && !file && !changing ? (
          <CvPresentCard
            filename={filename}
            uploadedAt={uploadedAt}
            ingestStatus={ingestStatus}
            ingestCheckFailed={ingestCheckFailed}
            cvBusy={cvBusy}
            canRemove={canRemove}
            onDownload={download}
            onChange={() => setChanging(true)}
            onRemove={remove}
            onViewDetails={() => setShowProcessingDialog(true)}
          />
        ) : (
          <CvUploadForm
            file={file}
            setFile={setFile}
            changing={changing}
            onCancelChanging={() => { setChanging(false); setFile(null); setError(""); }}
            ingestionEnabled={ingestionEnabled}
            consent={consent}
            setConsent={setConsent}
            uploading={uploading}
            onUpload={upload}
          />
        )}
      </div>

      {showProcessingDialog && (
        <CvProcessingDialog onClose={() => setShowProcessingDialog(false)} />
      )}
    </SettingsSection>
  );
}

// What each stage of a CV's background ingest says, and in which tone. An unknown stage reads as a failure, as it always did.
const PROCESSING_VIEW: { label: string; tone: BadgeTone } = { label: "Processing your CV…", tone: "info" };
const FAILED_VIEW: { label: string; tone: BadgeTone } = { label: "Couldn't be processed", tone: "danger" };
const CHECK_FAILED_VIEW: { label: string; tone: BadgeTone } = { label: "Couldn't check progress", tone: "danger" };
const INGEST_VIEW: Partial<Record<CvIngestStatus, { label: string; tone: BadgeTone }>> = {
  pending: PROCESSING_VIEW,
  extracting: PROCESSING_VIEW,
  embedding: PROCESSING_VIEW,
  ready: { label: "Processed", tone: "success" },
  flagged: { label: "Needs a quick check", tone: "lit" },
};

// Status text + spinner for a CV's background ingest — pulled out of
// CvPresentCard purely to keep that component's own branching readable.
function CvIngestBadge({
  ingestStatus, ingestCheckFailed, onViewDetails,
}: {
  ingestStatus: CvIngestStatus;
  ingestCheckFailed: boolean;
  onViewDetails: () => void;
}) {
  const processing = CV_INGEST_PROCESSING.includes(ingestStatus);
  const view = ingestCheckFailed ? CHECK_FAILED_VIEW : (INGEST_VIEW[ingestStatus] ?? FAILED_VIEW);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge tone={view.tone}>
        {!ingestCheckFailed && processing && <Spinner size="sm" />}
        {view.label}
      </Badge>
      <Button type="button" variant="quiet" size="sm" onClick={onViewDetails}>
        View details
      </Button>
    </div>
  );
}

// The "you already have a CV" panel — filename, upload/ingest status and
// the download/change/remove actions. Split out of CvSection so that
// function's own control flow stays short enough for the complexity rule.
function CvPresentCard({
  filename, uploadedAt, ingestStatus, ingestCheckFailed, cvBusy, canRemove,
  onDownload, onChange, onRemove, onViewDetails,
}: {
  filename: string | null;
  uploadedAt: string | null;
  ingestStatus: CvIngestStatus | null;
  ingestCheckFailed: boolean;
  cvBusy: null | "download" | "remove";
  canRemove: boolean;
  onDownload: () => void;
  onChange: () => void;
  onRemove: () => void;
  onViewDetails: () => void;
}) {
  return (
    <Panel className="grid gap-5 p-5">
      <div className="flex items-start gap-4">
        <Disc size="lg"><Icon name="file" size={24} /></Disc>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body text-text-primary">{filename ?? "Your CV"}</p>
          {uploadedAt && (
            // suppressHydrationWarning: toLocaleDateString resolves the
            // viewer's timezone, which can legitimately differ from the
            // server's and shift which calendar day this renders as —
            // a cosmetic mismatch, not a real one, so it isn't worth
            // deferring the date to a post-mount effect to avoid.
            <p className="truncate text-small text-text-muted" suppressHydrationWarning>
              Uploaded {new Date(uploadedAt).toLocaleDateString("en-GB", {
                day: "numeric", month: "short", year: "numeric",
              })}
            </p>
          )}
          {/* Only ever set by a fresh upload this visit (see
              pollIngestStatus above) — an existing CV from before this
              page load shows no badge, matching what the dialog it
              replaced also never did on a plain page load. */}
          {ingestStatus && (
            <CvIngestBadge ingestStatus={ingestStatus} ingestCheckFailed={ingestCheckFailed} onViewDetails={onViewDetails} />
          )}
        </div>
      </div>
      {/* Grouped so the buttons wrap onto their own line as a unit on a
          narrow container, rather than each one fighting the filename for space. */}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDownload} disabled={cvBusy !== null} loading={cvBusy === "download"} leading={<Icon name="download" size={18} />}>
          {cvBusy === "download" ? "Opening…" : "Download"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onChange} leading={<Icon name="refresh" size={18} />}>
          Change CV
        </Button>
        {/* Students' CVs are required (screens.tsx's cvRequired) — removing
            down to nothing isn't offered to them at all, and the RPC itself
            also refuses it, so this is UX clarity, not the enforcement. */}
        {canRemove && (
          <Button type="button" variant="dangerGhost" size="sm" onClick={onRemove} disabled={cvBusy !== null} loading={cvBusy === "remove"} leading={<Icon name="trash" size={18} />}>
            {cvBusy === "remove" ? "Removing…" : "Remove CV"}
          </Button>
        )}
      </div>
    </Panel>
  );
}

// The "pick/replace a file" branch — split out of CvSection for the same
// reason as CvPresentCard above.
function CvUploadForm({
  file, setFile, changing, onCancelChanging, ingestionEnabled, consent, setConsent, uploading, onUpload,
}: {
  file: File | null;
  setFile: (f: File | null) => void;
  changing: boolean;
  onCancelChanging: () => void;
  ingestionEnabled: boolean;
  consent: boolean;
  setConsent: (v: boolean) => void;
  uploading: boolean;
  onUpload: () => void;
}) {
  return (
    <div className="grid gap-4">
      <FilePicker
        accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        label="Drop a PDF or DOCX"
        hint="or click to browse · 8 MB maximum"
        file={file}
        onPick={setFile}
        onClear={() => setFile(null)}
      />
      {changing && (
        <div>
          <Button type="button" variant="quiet" size="sm" onClick={onCancelChanging}>
            Cancel — keep my current CV
          </Button>
        </div>
      )}
      {file && (
        <>
          {ingestionEnabled ? (
            <Checkbox
              card
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              label="Read my CV to suggest skills to add above and generate a searchable summary of my background. The extracted text and summary are stored and used to help match me to relevant opportunities. Before the text is analysed by our AI provider (OpenAI), we remove my name, contact details and links."
            />
          ) : (
            <Notice tone="info">CV-based skill matching is temporarily paused — your file will still be saved.</Notice>
          )}
          <div>
            <Button type="button" onClick={onUpload} loading={uploading} variant="primary" size="md">
              Upload CV
            </Button>
          </div>
        </>
      )}
    </div>
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
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- seeded once from props and only ever mutated by this component's own connect/disconnect action handlers; no other writer touches it while mounted
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

  // A plain navigation to a Route Handler, not a Server Action call —
  // see auth/github-connect/start/route.ts's header comment for why:
  // a Server Action here raced Next's own RSC reconciliation and
  // flashed error.tsx before the real redirect completed. Failure
  // comes back as ?github=error on this same page (read below), the
  // same convention the OAuth callback already uses for its own
  // failure paths.
  const connect = () => {
    setConnecting(true);
    // A hard navigation on purpose — router.push() would soft-navigate
    // within the SPA instead of making the real GET request this Route
    // Handler needs to run its guards and set-then-redirect.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/auth/github-connect/start?returnTo=profile";
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
    setError("");
    const result = await settle(dismissGithubShowcasePrompt());
    setDismissing(false);
    // B6: a failed dismiss used to do nothing at all.
    if (result.ok) setNeedsReview(false);
    else setError(result.error);
  };

  const [savingNudges, setSavingNudges] = useState(false);
  const toggleNudges = async (enabled: boolean) => {
    if (savingNudges) return;
    setNudgesEnabled(enabled);
    setSavingNudges(true);
    setError("");
    const result = await settle(setGithubNudges(enabled));
    setSavingNudges(false);
    if (!result.ok) {
      setNudgesEnabled(!enabled); // revert on failure
      setError("Couldn't save your email preference. Please try again.");
    }
  };

  const statusLabel =
    status === "ready" ? "Repositories scanned"
      : status === "failed" ? (scanFailureReason ?? "Scan failed")
        : "Scanning your repositories…";

  return (
    <SettingsSection
      title="GitHub"
      description="Optional. Connect your GitHub account to have your public repositories count as an extra skill signal alongside your CV — real GitHub sign-in and authorisation, nothing to generate or paste in yourself."
    >
      <div className="grid gap-4">
        {error && <ErrorBanner>{error}</ErrorBanner>}

        {connected ? (
          <GithubConnectedPanel
            ingestionEnabled={ingestionEnabled}
            username={username}
            statusLabel={statusLabel}
            disconnecting={disconnecting}
            confirmingDisconnect={confirmingDisconnect}
            onConfirmDisconnect={() => setConfirmingDisconnect(true)}
            onCancelDisconnect={() => setConfirmingDisconnect(false)}
            onDisconnect={disconnect}
            needsReview={needsReview}
            dismissing={dismissing}
            onReview={() => setDialog("pick")}
            onDismiss={dismissPrompt}
            status={status}
            picks={picks}
            themes={themes}
            nudgesEnabled={nudgesEnabled}
            savingNudges={savingNudges}
            onChangeProjects={() => setDialog("pick")}
            onToggleNudges={toggleNudges}
          />
        ) : ingestionEnabled ? (
          <div>
            <Button type="button" onClick={connect} loading={connecting} variant="ghost" size="md" leading={<Icon name="github" size={18} />}>
              Connect GitHub
            </Button>
          </div>
        ) : (
          <Notice tone="info">GitHub connections are temporarily paused — check back soon.</Notice>
        )}
      </div>

      {dialog && (
        <GithubDialog
          startAtPicker={dialog === "pick"}
          onClose={() => { setDialog(null); void refreshShowcase(); }}
          onSaved={() => { setNeedsReview(false); void refreshShowcase(); }}
        />
      )}
    </SettingsSection>
  );
}

// The entire "already connected" view — split out of GithubSection to keep
// that function's own control flow short enough for the complexity rule.
function GithubConnectedPanel({
  ingestionEnabled, username, statusLabel, disconnecting, confirmingDisconnect,
  onConfirmDisconnect, onCancelDisconnect, onDisconnect, needsReview, dismissing,
  onReview, onDismiss, status, picks, themes, nudgesEnabled, savingNudges,
  onChangeProjects, onToggleNudges,
}: {
  ingestionEnabled: boolean;
  username: string | null;
  statusLabel: string;
  disconnecting: boolean;
  confirmingDisconnect: boolean;
  onConfirmDisconnect: () => void;
  onCancelDisconnect: () => void;
  onDisconnect: () => void;
  needsReview: boolean;
  dismissing: boolean;
  onReview: () => void;
  onDismiss: () => void;
  status: GithubScanStatus | null;
  picks: ShowcaseRepo[] | null;
  themes: string[];
  nudgesEnabled: boolean;
  savingNudges: boolean;
  onChangeProjects: () => void;
  onToggleNudges: (enabled: boolean) => void;
}) {
  return (
    <div className="grid gap-4">
      {!ingestionEnabled && (
        <Notice tone="info">
          GitHub rescans are paused right now — your existing projects and picks are unaffected,
          and you can still choose from what&apos;s already been found, but nothing new will show
          up until this is back on.
        </Notice>
      )}
      <Panel className="flex flex-wrap items-center gap-4 p-5">
        <Disc size="lg"><Icon name="github" size={24} /></Disc>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body text-text-primary">@{username}</p>
          <p className="text-small text-text-muted">{statusLabel}</p>
        </div>
        <Button type="button" variant="dangerGhost" size="sm" onClick={onConfirmDisconnect} disabled={disconnecting}>
          Disconnect
        </Button>
      </Panel>

      {/* Disconnecting deletes the picks and the hand-written blurbs
          along with the connection (disconnect_github drops the row).
          That is the right privacy default, but it is not something a
          member should discover afterwards. */}
      {confirmingDisconnect && (
        <Notice
          tone="danger"
          icon="warning"
          action={
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="dangerGhost" size="sm" loading={disconnecting} onClick={onDisconnect}>
                Disconnect GitHub
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onCancelDisconnect}>
                Keep it connected
              </Button>
            </div>
          }
        >
          Disconnecting removes your GitHub-derived skills, your spotlit projects and the
          descriptions you wrote for them. You can reconnect later, but you&apos;ll need to
          choose your projects again.
        </Notice>
      )}

      {needsReview && (
        <Notice
          tone="lit"
          icon="spark"
          action={
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={onReview}>
                Review projects
              </Button>
              <Button type="button" variant="ghost" size="sm" loading={dismissing} onClick={onDismiss}>
                Not now
              </Button>
            </div>
          }
        >
          There&apos;s something new on your GitHub that you haven&apos;t looked at yet. Want to
          update which projects recruiters see?
        </Notice>
      )}

      {status === "ready" && (
        <GithubSpotlitProjects
          picks={picks}
          themes={themes}
          nudgesEnabled={nudgesEnabled}
          savingNudges={savingNudges}
          onChangeProjects={onChangeProjects}
          onToggleNudges={onToggleNudges}
        />
      )}
    </div>
  );
}

// The "spotlit projects" card inside GithubConnectedPanel — also pulled out
// on its own so neither function carries all of this branching at once.
function GithubSpotlitProjects({
  picks, themes, nudgesEnabled, savingNudges, onChangeProjects, onToggleNudges,
}: {
  picks: ShowcaseRepo[] | null;
  themes: string[];
  nudgesEnabled: boolean;
  savingNudges: boolean;
  onChangeProjects: () => void;
  onToggleNudges: (enabled: boolean) => void;
}) {
  return (
    <Panel className="grid gap-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-lead text-text-primary">Spotlit projects</h3>
        <Button type="button" variant="ghost" size="sm" onClick={onChangeProjects}>
          {picks && picks.length > 0 ? "Change projects" : "Choose projects"}
        </Button>
      </div>
      {picks && picks.length > 0 ? (
        <ul className="grid divide-y divide-border-subtle">
          {picks.map((repo) => (
            <li key={repo.name} className="py-3 first:pt-0 last:pb-0">
              <a
                href={externalHref(repo.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-body text-text-primary underline underline-offset-2"
              >
                {repo.name}
              </a>
              {(repo.blurb ?? repo.description) && (
                <p className="mt-1 text-small text-text-secondary">
                  {repo.blurb ?? repo.description}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-text-muted">
          You haven&apos;t chosen any yet. Until you do, we&apos;ll show the projects our scan
          rated highest.
        </p>
      )}

      {/* The written summary leads with one dominant thread and gives
          at most a brief mention to a second, so it stays skimmable —
          these tags are where the rest of what the scan found still
          shows up, rather than getting cut from the prose entirely. */}
      {themes.length > 0 && (
        <div>
          <p className="mb-2 text-small text-text-muted">What your code says about you</p>
          <div className="flex flex-wrap gap-2">
            {themes.map((theme) => (
              <Badge key={theme}>{theme}</Badge>
            ))}
          </div>
        </div>
      )}

      <Checkbox
        checked={nudgesEnabled}
        disabled={savingNudges}
        aria-busy={savingNudges}
        onChange={(event) => void onToggleNudges(event.target.checked)}
        label="Email me when I've pushed something worth spotlighting (at most once a month)"
      />
    </Panel>
  );
}
