"use client";

import { useId, useRef, useState } from "react";
import { inputCls } from "@/components/forms/styles";
import { ChipGroup, type ChipItem } from "@/components/forms/ChipGroup";
import { ErrorBanner } from "@/components/forms/Banners";
import { AvatarCropper } from "@/components/media/AvatarCropper";
import { MemberDialog, memberSubtitle } from "@/components/members/MemberDialog";
import type { DirectoryMember } from "@/lib/data/directory";
import {
  MAX_CORE_SKILLS,
  MAX_INTENTS,
  MIN_SKILLS,
  CURRENT_FOCUS,
  VENTURE_STAGES,
  VENTURE_STAGES_WITH_DETAIL,
  RECRUITING_STATUSES,
  INTENTS,
  INTENT_URGENCIES,
  AVAILABILITY_HOURS,
  addressAs,
  type IntakeState,
} from "@/lib/intake/state";
import { Field, ChoiceCards, PillChoice, TagInput, FilePicker, RankPicker, SkillPicker, type SkillOption } from "./controls";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { RepoPicker } from "@/components/github/RepoPicker";
import type { AvailableRepo, ShowcaseRepo } from "@/lib/github/showcase";
import type { Affiliation } from "@/lib/intake/steps";
import { MAX_NAME_LENGTH } from "@/lib/text";

export type Patch = (p: Partial<IntakeState>) => void;

export type ScreenProps = {
  s: IntakeState;
  patch: Patch;
  firstName: string;
  skillTaxonomy: SkillOption[];
  sectors: ChipItem[];
  avatarUploading: boolean;
  avatarError: string;
  onCropAvatar: (blob: Blob) => Promise<void>;
  existingCv: ExistingCv | null;
  role: Affiliation;
  existingLinkedin: string | null;
  suggestionsLoading: boolean;
  /** profiles.github_url, collected at /onboarding before verification.
   *  Used to NAME the handle already on file so connecting reads as
   *  confirming the same account, not a second thing being asked for. */
  existingGithubUrl: string | null;
  github: GithubScreenState;
};

/** Everything the GitHub screen needs, owned by IntakeFlow so screens.tsx
 *  stays pure UI — same split as the avatar/CV upload handlers. */
export type GithubScreenState = {
  connected: boolean;
  scanning: boolean;
  connecting: boolean;
  error: string;
  showcase: {
    availableRepos: AvailableRepo[];
    showcaseRepos: ShowcaseRepo[] | null;
    suggestedRepos: AvailableRepo[];
    seenRepos: string[];
  } | null;
  saving: boolean;
  saved: boolean;
  onConnect: () => void;
  onSave: (picks: { name: string; blurb: string }[]) => void;
};

/** A previously-confirmed CV: its blob key (so a Back→Continue doesn't
 *  re-upload) and a signed URL for display. */
export type ExistingCv = { blobKey: string; filename: string; downloadUrl: string | null };

/** Shared lead paragraph under a screen heading. */
function Lead({ children }: { children: React.ReactNode }) {
  return <p className="mb-7 text-[0.95rem] leading-[1.65] text-text-secondary">{children}</p>;
}

// ─── 01 · Face & bio ─────────────────────────────────────────────────

export function FaceScreen({ s, patch, firstName, avatarUploading, avatarError, onCropAvatar }: ScreenProps) {
  const nameId = useId();
  const focusId = useId();
  const hobbiesId = useId();
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-7">
      <Lead>
        A face and a couple of lines — genuinely optional, but a directory of
        grey circles doesn&apos;t get anyone a reply. Skip anything here and
        come back later from My Profile.
      </Lead>

      <Field label="What should we call you?" htmlFor={nameId}>
        <input
          id={nameId}
          type="text"
          value={s.preferredName}
          onChange={(e) => patch({ preferredName: e.target.value })}
          maxLength={MAX_NAME_LENGTH}
          placeholder={firstName}
          className={inputCls}
        />
      </Field>

      <Field label="Your photo" hint="Optional. You'll be able to pick exactly which part of it shows.">
        {pendingFile ? (
          <AvatarCropper
            file={pendingFile}
            onCropped={async (blob) => {
              await onCropAvatar(blob);
              setPendingFile(null);
            }}
            onCancel={() => setPendingFile(null)}
          />
        ) : s.photoPreview ? (
          <div className="flex items-center gap-4 rounded-lg border border-border-strong bg-white/[0.04] p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- object URL, not a remote asset */}
            <img src={s.photoPreview} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover" />
            <span className="min-w-0 flex-1 text-[0.85rem] text-text-primary">Great! You can change your profile picture in your settings at any time.</span>
            <button
              type="button"
              onClick={() => replaceRef.current?.click()}
              className="shrink-0 cursor-pointer rounded-lg border border-border-strong bg-white/[0.04] px-3 py-2 text-[0.775rem] text-text-secondary transition-colors duration-150 hover:border-accent hover:text-text-primary"
            >
              Replace
            </button>
            <input
              ref={replaceRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setPendingFile(f);
                e.target.value = "";
              }}
            />
          </div>
        ) : (
          <FilePicker
            accept="image/jpeg,image/png,image/webp"
            label="Add a photo"
            hint="JPG, PNG or WebP"
            file={null}
            onPick={setPendingFile}
            onClear={() => {}}
          />
        )}
        {avatarUploading && <p className="mt-2 text-[0.775rem] text-text-muted">Uploading…</p>}
        {avatarError && <p className="mt-2 text-[0.775rem] text-[#ff8080]">{avatarError}</p>}
      </Field>

      <Field
        label="What are you working on, or into?"
        htmlFor={focusId}
        hint="A project, a research direction, a thing you won't shut up about. Two sentences is plenty."
      >
        <textarea
          id={focusId}
          rows={3}
          maxLength={500}
          value={s.bioFocus}
          onChange={(e) => patch({ bioFocus: e.target.value })}
          placeholder="Building a computer-vision tool for surgical training. Interested in medical devices, regulation, and anything that gets research out of the lab."
          className={`${inputCls} resize-y`}
        />
      </Field>

      <Field
        label="And outside of that?"
        htmlFor={hobbiesId}
        hint="Hobbies, in your own words. This is the half of a profile that actually gets people to a coffee."
      >
        <textarea
          id={hobbiesId}
          rows={2}
          maxLength={500}
          value={s.bioHobbies}
          onChange={(e) => patch({ bioHobbies: e.target.value })}
          placeholder="Long-distance running, cooking for too many people, and losing at chess."
          className={`${inputCls} resize-y`}
        />
      </Field>
    </div>
  );
}

// ─── · You're in ─────────────────────────────────────────────────────

function initialsOf(m: DirectoryMember): string {
  return `${m.firstName[0] ?? ""}${m.surname[0] ?? ""}`.toUpperCase();
}

/** Sectors first (a real filtering signal), falling back to the bio, then
 *  to a plain fallback for a member who hasn't filled in either yet. */
function becauseLine(m: DirectoryMember): string {
  if (m.sectors.length > 0) return m.sectors.slice(0, 2).join(" · ");
  if (m.bioPreview) return m.bioPreview.length > 70 ? `${m.bioPreview.slice(0, 70)}…` : m.bioPreview;
  return "Recently joined";
}

function MatchCard({ member: m, onOpen }: { member: DirectoryMember; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="block w-full cursor-pointer overflow-hidden rounded-lg border border-border bg-white/[0.03] text-left transition-colors duration-150 hover:border-accent"
      >
        {m.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed blob URL, not a static asset
          <img src={m.avatarUrl} alt="" className="h-28 w-full object-cover" />
        ) : (
          <div className="flex h-28 w-full items-center justify-center bg-white/[0.06] font-display text-[1.5rem] text-text-secondary">
            {initialsOf(m)}
          </div>
        )}
        <div className="p-4">
          <span className="block text-[0.875rem] font-medium text-text-primary">
            {m.firstName} {m.surname}
          </span>
          <span className="mt-0.5 block text-[0.775rem] leading-[1.5] text-text-muted">
            {memberSubtitle(m)}
          </span>
          <span className="mt-3 block border-t border-border-subtle pt-3 text-[0.775rem] leading-[1.5] text-text-secondary">
            {becauseLine(m)}
          </span>
        </div>
      </button>
    </li>
  );
}

export function YoureInScreen({ s, firstName, matches }: ScreenProps & { matches: DirectoryMember[] }) {
  const name = addressAs(s.preferredName, firstName);
  const [openMember, setOpenMember] = useState<DirectoryMember | null>(null);

  return (
    <div className="text-center">
      <span
        aria-hidden
        className="mx-auto mb-6 block h-3 w-3 rotate-45 rounded-[1px] bg-signal"
      />
      <p className="mb-2 text-[0.75rem] font-medium uppercase tracking-[0.14em] text-signal">
        Welcome
      </p>
      <h2 className="mb-4 font-display text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[1.1] tracking-tight text-text-primary">
        Good to have you, {name}.
      </h2>
      <p className="mx-auto mb-9 max-w-[46ch] text-[0.95rem] leading-[1.65] text-text-secondary">
        A few more optional questions, and you&apos;re genuinely findable —
        not just a name in a list.
      </p>

      {matches.length > 0 ? (
        <ul className="grid gap-3 text-left sm:grid-cols-3">
          {matches.map((m) => (
            <MatchCard key={m.id} member={m} onOpen={() => setOpenMember(m)} />
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border border-border bg-white/[0.03] p-6 text-left">
          <p className="text-[0.875rem] leading-[1.65] text-text-secondary">
            No one to show yet — you are early, and the directory is still
            filling up. Adding your skills and interests on the next screens
            is what makes you findable when the next person joins.
          </p>
        </div>
      )}

      {openMember && <MemberDialog member={openMember} onClose={() => setOpenMember(null)} />}
    </div>
  );
}

// ─── 02 · CV ─────────────────────────────────────────────────────────

export function CvScreen({ s, patch, existingCv, role, existingLinkedin }: ScreenProps) {
  const linkedinId = useId();
  const consentId = useId();
  const alreadyUploaded = !s.cvFile && s.cvUploadedKey && s.cvOriginalFilename;
  const cvRequired = role === "student";
  const linkedinPrefilled = role !== "student" && !!existingLinkedin;

  return (
    <div className="space-y-7">
      <Lead>
        {cvRequired
          ? "We use your CV to match you with recruiters for relevant opportunities — it's required to finish setting up your profile."
          : "We use your CV to suggest you to recruiters for relevant opportunities, based on your skills and experience — the more members with a CV on file, the better those matches get for everyone."}
      </Lead>

      <Field label={cvRequired ? "Your CV" : "Your CV, if you have one"} hint="PDF or DOCX · 8 MB maximum.">
        {alreadyUploaded ? (
          <div className="flex items-center gap-4 rounded-lg border border-border-strong bg-white/[0.04] p-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border bg-white/[0.03] font-mono text-[0.65rem] text-text-secondary">
              {(s.cvOriginalFilename?.split(".").pop() ?? "file").slice(0, 4).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.85rem] text-text-primary">{s.cvOriginalFilename}</span>
              <span className="block text-[0.75rem] text-text-muted">Already uploaded</span>
            </span>
            {existingCv?.downloadUrl && (
              <a
                href={existingCv.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-lg border border-border-strong bg-white/[0.04] px-3 py-2 text-[0.775rem] text-text-secondary no-underline transition-colors duration-150 hover:border-accent hover:text-text-primary"
              >
                View
              </a>
            )}
            <button
              type="button"
              onClick={() => patch({ cvUploadedKey: null, cvOriginalFilename: null, suggestedSkillIds: [] })}
              className="shrink-0 cursor-pointer rounded-lg border border-border-strong bg-white/[0.04] px-3 py-2 text-[0.775rem] text-text-secondary transition-colors duration-150 hover:border-accent hover:text-text-primary"
            >
              Replace
            </button>
          </div>
        ) : (
          <FilePicker
            accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            label="Drop a PDF or DOCX"
            hint="or click to browse · 8 MB maximum"
            file={s.cvFile}
            onPick={(f) => patch({ cvFile: f, cvUploadedKey: null })}
            onClear={() => patch({ cvFile: null, cvUploadedKey: null })}
          />
        )}
      </Field>

      {s.cvFile && (
        <label htmlFor={consentId} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border-strong bg-white/[0.03] p-4">
          <input
            id={consentId}
            type="checkbox"
            checked={s.cvConsent}
            onChange={(e) => patch({ cvConsent: e.target.checked })}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--color-accent)]"
          />
          <span className="text-[0.8rem] leading-[1.6] text-text-secondary">
            Read the skills section of my CV once, to suggest skills to add on
            the next screen. We never add anything without you confirming it,
            and the text itself is never stored — only the matched skills. You
            can leave this unticked and add skills yourself instead.
          </span>
        </label>
      )}

      <Field
        label={linkedinPrefilled ? "Confirm your LinkedIn" : "Your LinkedIn profile"}
        htmlFor={linkedinId}
        hint={
          linkedinPrefilled
            ? "This is what you gave us when you joined — update it if it's changed."
            : "Recruiters and mentors use this to find you."
        }
      >
        <input
          id={linkedinId}
          type="url"
          value={s.linkedin}
          onChange={(e) => patch({ linkedin: e.target.value })}
          placeholder="https://linkedin.com/in/…"
          className={inputCls}
        />
      </Field>
    </div>
  );
}

// ─── 03 · GitHub ─────────────────────────────────────────────────────
//
// Optional for every affiliation — validate("github") always passes and
// this never enters compulsoryDone. Its own screen rather than a block on
// the CV screen because connecting navigates out to github.com and back,
// and cvFile is deliberately excluded from the localStorage draft.
//
// "Prefilling" here can't mean prefilling OAuth — the account is whatever
// the member authorises. It means naming the handle we already have from
// /onboarding, so this reads as confirming a known account rather than
// being asked for GitHub a second time.

function githubHandle(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/github\.com\/([A-Za-z0-9-]+)/);
  return match ? match[1] : null;
}

export function GithubScreen({ existingGithubUrl, github }: ScreenProps) {
  const knownHandle = githubHandle(existingGithubUrl);

  if (github.connected && github.saved) {
    return (
      <div className="space-y-4">
        <Lead>Saved — these are the projects recruiters will see first.</Lead>
        <p className="text-[0.85rem] text-text-muted">
          You can change them any time from your profile.
        </p>
      </div>
    );
  }

  if (github.connected && github.scanning) {
    return (
      <div className="space-y-4">
        <Lead>Reading your public repositories…</Lead>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" />
        <p className="text-[0.8rem] text-text-muted">
          This usually takes a few seconds. You can keep going and choose your projects later from
          your profile.
        </p>
      </div>
    );
  }

  if (github.connected && github.showcase) {
    return (
      <div className="space-y-6">
        <Lead>Pick the projects you&apos;d actually want a recruiter to look at.</Lead>
        {github.error && <ErrorBanner>{github.error}</ErrorBanner>}
        <RepoPicker
          availableRepos={github.showcase.availableRepos}
          showcaseRepos={github.showcase.showcaseRepos}
          suggestedRepos={github.showcase.suggestedRepos}
          seenRepos={github.showcase.seenRepos}
          saving={github.saving}
          onSave={github.onSave}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Lead>
        Optional. If you write code, connecting GitHub lets recruiters see what you&apos;ve actually
        built — not just what your CV says. You&apos;ll pick which projects to spotlight, and nothing
        private is ever read.
      </Lead>

      {knownHandle && (
        <p className="text-[0.85rem] text-text-secondary">
          We&apos;ve got <span className="text-text-primary">@{knownHandle}</span> from when you
          signed up — connect it to spotlight your projects.
        </p>
      )}

      {github.error && <ErrorBanner>{github.error}</ErrorBanner>}

      <Button
        type="button"
        variant="primary"
        size="md"
        loading={github.connecting}
        onClick={github.onConnect}
      >
        Connect GitHub
      </Button>

      <p className="text-[0.8rem] text-text-muted">
        You&apos;ll see GitHub&apos;s own authorisation screen — there&apos;s nothing to generate or
        paste in yourself. We only read public repository information.
      </p>
    </div>
  );
}

// ─── 04 · Skills ─────────────────────────────────────────────────────

export function SkillsScreen({ s, patch, skillTaxonomy, suggestionsLoading }: ScreenProps) {
  const suggested = s.suggestedSkillIds
    .filter((id) => !s.skillIds.includes(id))
    .map((id) => skillTaxonomy.find((t) => t.id === id))
    .filter((t): t is SkillOption => !!t);

  const add = (id: number) => patch({ skillIds: [...s.skillIds, id] });
  const remove = (id: number) =>
    patch({ skillIds: s.skillIds.filter((x) => x !== id), coreSkillIds: s.coreSkillIds.filter((x) => x !== id) });
  const toggleCore = (id: number) =>
    patch({
      coreSkillIds: s.coreSkillIds.includes(id)
        ? s.coreSkillIds.filter((x) => x !== id)
        : s.coreSkillIds.length < MAX_CORE_SKILLS
          ? [...s.coreSkillIds, id]
          : s.coreSkillIds,
    });

  return (
    <div className="space-y-7">
      <Field
        label="Your skills"
        hint={`At least ${MIN_SKILLS} to continue from this screen — or skip the whole thing for now and come back later. Star up to ${MAX_CORE_SKILLS} as core.`}
      >
        {suggestionsLoading && suggested.length === 0 && (
          <div className="mb-4 rounded-lg border border-dashed border-signal/50 bg-signal-muted/40 p-3">
            <p className="mb-2 text-[0.7rem] font-medium uppercase tracking-[0.14em] text-signal">
              Reading your CV for skill matches…
            </p>
            <div className="flex flex-wrap gap-2" aria-hidden>
              <span className="h-7 w-24 animate-pulse rounded-lg bg-white/[0.08]" />
              <span className="h-7 w-32 animate-pulse rounded-lg bg-white/[0.08]" />
              <span className="h-7 w-20 animate-pulse rounded-lg bg-white/[0.08]" />
            </div>
          </div>
        )}
        <SkillPicker
          taxonomy={skillTaxonomy}
          selectedIds={s.skillIds}
          coreIds={s.coreSkillIds}
          suggested={suggested}
          onAdd={add}
          onRemove={remove}
          onToggleCore={toggleCore}
          maxCore={MAX_CORE_SKILLS}
        />
      </Field>
    </div>
  );
}

// ─── 05 · Interests ──────────────────────────────────────────────────

export function InterestsScreen({ s, patch, sectors }: ScreenProps) {
  const toggleSector = (id: number) =>
    patch({
      sectorIds: s.sectorIds.includes(id)
        ? s.sectorIds.filter((x) => x !== id)
        : [...s.sectorIds, id],
    });

  return (
    <div className="space-y-7">
      <ChipGroup
        label="Sectors you'd build in"
        items={sectors}
        selected={new Set(s.sectorIds)}
        onToggle={toggleSector}
      />

      <Field
        label="Things you find genuinely interesting"
        hint="Not necessarily your job. Anything you'd read about on a Sunday."
      >
        <TagInput
          placeholder="Add an interest…"
          suggestions={[
            "Computer vision", "Medical devices", "Climate", "Robotics", "Fintech",
            "Policy", "Semiconductors", "Synthetic biology", "Space", "Developer tools",
          ]}
          values={s.academicInterests}
          max={12}
          onAdd={(v) => patch({ academicInterests: [...s.academicInterests, v] })}
          onRemove={(v) => patch({ academicInterests: s.academicInterests.filter((x) => x !== v) })}
        />
      </Field>

      <Field label="Hobbies" hint="The half of the profile that turns a match into a coffee.">
        <TagInput
          placeholder="Add a hobby…"
          suggestions={["Running", "Climbing", "Chess", "Cooking", "Football", "Photography", "Cycling", "Reading"]}
          values={s.hobbies}
          max={12}
          onAdd={(v) => patch({ hobbies: [...s.hobbies, v] })}
          onRemove={(v) => patch({ hobbies: s.hobbies.filter((x) => x !== v) })}
        />
      </Field>
    </div>
  );
}

// ─── 06 · Where you're at ────────────────────────────────────────────

export function WhereScreen({ s, patch }: ScreenProps) {
  const nameId = useId();
  const urlId = useId();
  const showDetail = VENTURE_STAGES_WITH_DETAIL.has(s.ventureStage);

  return (
    <div className="space-y-7">
      <Lead>You can always change this later from My Profile.</Lead>

      <Field label="What's your situation right now?">
        <ChoiceCards
          name="Current focus"
          columns={2}
          options={CURRENT_FOCUS}
          value={s.currentFocus || null}
          onChange={(v) => patch({ currentFocus: v })}
        />
      </Field>

      <Field label="Where's your venture at?">
        <ChoiceCards
          name="Venture stage"
          columns={2}
          options={VENTURE_STAGES}
          value={s.ventureStage || null}
          onChange={(v) => patch({ ventureStage: v })}
        />
      </Field>

      {showDetail && (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Venture name" htmlFor={nameId}>
              <input
                id={nameId}
                type="text"
                maxLength={200}
                value={s.ventureName}
                onChange={(e) => patch({ ventureName: e.target.value })}
                placeholder="Whatever you call it"
                className={inputCls}
              />
            </Field>
            <Field label="Website" htmlFor={urlId}>
              <input
                id={urlId}
                type="url"
                maxLength={512}
                value={s.ventureUrl}
                onChange={(e) => patch({ ventureUrl: e.target.value })}
                placeholder="https://…"
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="One line on what it does">
            <input
              type="text"
              maxLength={140}
              value={s.ventureOneLiner}
              onChange={(e) => patch({ ventureOneLiner: e.target.value })}
              placeholder="Computer vision that scores surgical technique from theatre footage."
              className={inputCls}
            />
          </Field>

          <Field label="Recruiting?">
            <PillChoice
              name="Recruiting"
              options={RECRUITING_STATUSES}
              value={s.recruitingStatus}
              onChange={(v) => patch({ recruitingStatus: v })}
            />
          </Field>
        </>
      )}
    </div>
  );
}

// ─── 07 · What you want ──────────────────────────────────────────────

export function WantScreen({ s, patch }: ScreenProps) {
  const toggle = (v: string) =>
    patch({
      intents: s.intents.includes(v)
        ? s.intents.filter((x) => x !== v)
        : s.intents.length < MAX_INTENTS
          ? [...s.intents, v]
          : s.intents,
    });

  return (
    <div className="space-y-7">
      <Lead>
        Pick up to {MAX_INTENTS}, in order. This is what the directory sorts
        on when someone goes looking for a person like you.
      </Lead>

      <Field label={`Pick up to ${MAX_INTENTS}, in order`}>
        <RankPicker options={INTENTS} values={s.intents} onToggle={toggle} max={MAX_INTENTS} />
      </Field>

      <Field label="How urgent?">
        <PillChoice
          name="Urgency"
          options={INTENT_URGENCIES}
          value={s.intentUrgency}
          onChange={(v) => patch({ intentUrgency: v })}
        />
      </Field>

      <Field label="Hours a week for something new">
        <PillChoice
          name="Hours a week"
          options={AVAILABILITY_HOURS}
          value={s.availabilityHours}
          onChange={(v) => patch({ availabilityHours: v })}
        />
      </Field>
    </div>
  );
}
