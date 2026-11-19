"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Panel } from "@/components/ui/Panel";
import { SearchField } from "@/components/ui/SearchField";
import { Icon } from "@/design-system/icons/Icon";
import {
  SHOWCASE_BLURB_MAX,
  SHOWCASE_MAX_PICKS,
  type AvailableRepo,
  type ShowcaseRepo,
} from "@/lib/github/showcase";

// ════════════════════════════════════════════════════════════════════
// Foundry · Repo picker
//
// ONE component used by both the profile dialog and the intake flow's
// GitHub screen, so the two can never drift into telling members
// different things about the same feature.
//
// The premise: an LLM is reliable at judging whether a repo contains real
// engineering, and has no way at all to know which projects a member is
// proud of. So it suggests (the "Suggested" chip) and the member decides.
// Nothing here is pre-filtered — every public non-fork repo is pickable,
// including ones the exclusion classifier demoted, because silently
// hiding someone's own repo with no explanation is worse than letting
// them make a choice we'd have made differently.
// ════════════════════════════════════════════════════════════════════

type Pick = { name: string; blurb: string };

function relativePush(pushedAt: string | null): string | null {
  if (!pushedAt) return null;
  const then = new Date(pushedAt).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function RepoPicker({
  availableRepos,
  showcaseRepos,
  suggestedRepos,
  seenRepos,
  saving,
  onSave,
  onSkip,
  skipLabel,
  saveLabel = "Save projects",
}: {
  availableRepos: AvailableRepo[];
  showcaseRepos: ShowcaseRepo[] | null;
  suggestedRepos: AvailableRepo[];
  seenRepos: string[];
  saving: boolean;
  onSave: (picks: Pick[]) => void;
  /** Omit to hide the secondary action entirely. */
  onSkip?: () => void;
  skipLabel?: string;
  saveLabel?: string;
}) {
  // Existing picks seed the selection, in their saved order — reopening
  // the picker must show what you already chose, not a blank slate.
  const [picks, setPicks] = useState<Pick[]>(
    () => (showcaseRepos ?? []).map((repo) => ({ name: repo.name, blurb: repo.blurb ?? "" })),
  );
  const [filter, setFilter] = useState("");

  const suggestedNames = useMemo(
    () => new Set(suggestedRepos.map((repo) => repo.name)),
    [suggestedRepos],
  );
  const seenSet = useMemo(() => new Set(seenRepos), [seenRepos]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return availableRepos;
    return availableRepos.filter(
      (repo) =>
        repo.name.toLowerCase().includes(needle) ||
        (repo.description ?? "").toLowerCase().includes(needle) ||
        (repo.language ?? "").toLowerCase().includes(needle),
    );
  }, [availableRepos, filter]);

  const pickedNames = useMemo(() => new Set(picks.map((pick) => pick.name)), [picks]);
  const atLimit = picks.length >= SHOWCASE_MAX_PICKS;

  function toggle(repo: AvailableRepo) {
    setPicks((current) => {
      if (current.some((pick) => pick.name === repo.name)) {
        return current.filter((pick) => pick.name !== repo.name);
      }
      if (current.length >= SHOWCASE_MAX_PICKS) return current;
      // Prefilled with the repo's own GitHub description: most members
      // will keep it, and an empty box is a task where a good-enough
      // default was already available.
      return [...current, { name: repo.name, blurb: repo.description ?? "" }];
    });
  }

  function remove(name: string) {
    setPicks((current) => current.filter((pick) => pick.name !== name));
  }

  function setBlurb(name: string, blurb: string) {
    setPicks((current) =>
      current.map((pick) => (pick.name === name ? { ...pick, blurb } : pick)),
    );
  }

  if (availableRepos.length === 0) {
    return (
      <div className="grid justify-items-start gap-4">
        <p className="text-body text-text-secondary">
          Your GitHub is connected — we just didn&apos;t find any public repositories on it yet. Push
          something public and we&apos;ll pick it up automatically.
        </p>
        {onSkip && (
          <Button type="button" variant="ghost" size="sm" onClick={onSkip}>
            {skipLabel ?? "Close"}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <p className="text-body text-text-secondary">
          Choose up to {SHOWCASE_MAX_PICKS} projects to spotlight to recruiters. Add a line about each
          one in your own words.
        </p>
        <p className="text-small text-text-muted">
          Change these any time from your profile — when you push something new we&apos;ll let you
          know, at most once a month.
        </p>
      </div>

      <SearchField
        label="Filter repositories"
        value={filter}
        onChange={setFilter}
        placeholder={`Filter ${availableRepos.length} repositories…`}
      />

      {/* Picked projects and their blurbs live in their own block, separate
          from the scrollable browse list below. They used to expand inline
          under each row, which meant checking one box changed the height of
          the list every other row sits in — the exact thing that turns a
          fast run down a checklist into a misclick, since the row you meant
          to hit next has already moved by the time the click lands. */}
      {picks.length > 0 && (
        <Panel tone="inset" size="sm" className="grid gap-3 p-4">
          <p className="text-small text-text-muted">
            {picks.length} of {SHOWCASE_MAX_PICKS} chosen — in the order recruiters will see them
          </p>
          <ul className="grid gap-4">
            {picks.map((pick) => (
              <li key={pick.name}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-body text-text-primary">{pick.name}</span>
                  <Button type="button" variant="quiet" size="sm" onClick={() => remove(pick.name)} className="shrink-0">
                    Remove
                  </Button>
                </div>
                <Input
                  id={`blurb-${pick.name}`}
                  type="text"
                  value={pick.blurb}
                  maxLength={SHOWCASE_BLURB_MAX}
                  onChange={(event) => setBlurb(pick.name, event.target.value)}
                  placeholder="What it does, and what you built"
                  aria-label={`One line about ${pick.name}`}
                  className="mt-1"
                />
                <p className="mt-1 text-right text-caption text-text-muted data">
                  {pick.blurb.length}/{SHOWCASE_BLURB_MAX}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <p className="text-small text-text-muted" aria-live="polite">
        {picks.length} of {SHOWCASE_MAX_PICKS} chosen
        {atLimit && " — deselect one below to swap it out"}
      </p>

      <ul className="grid max-h-[45vh] gap-2 overflow-y-auto overscroll-contain pr-1">
        {visible.map((repo) => {
          const picked = pickedNames.has(repo.name);
          const pushed = relativePush(repo.pushed_at);
          const facts: ReactNode[] = [];
          if (repo.language) facts.push(repo.language);
          if (repo.stargazers_count > 0) {
            facts.push(
              <span key="stars" className="inline-flex items-center gap-1">
                <Icon name="star-filled" size={14} />
                {repo.stargazers_count}
                <span className="sr-only"> stars</span>
              </span>,
            );
          }
          if (pushed) facts.push(pushed);
          return (
            <li key={repo.name}>
              <Checkbox
                card
                checked={picked}
                onChange={() => toggle(repo)}
                // Disabling the unpicked ones at the limit, rather than
                // silently ignoring the click, is what makes the cap
                // legible instead of feeling broken.
                disabled={!picked && atLimit}
                label={
                  <span className="grid gap-1 py-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-body text-text-primary">{repo.name}</span>
                      {suggestedNames.has(repo.name) && <Badge tone="lit">Suggested</Badge>}
                      {!seenSet.has(repo.name) && <Badge>New</Badge>}
                    </span>
                    {repo.description && (
                      <span className="block text-body text-text-secondary">{repo.description}</span>
                    )}
                    <span className="block text-small text-text-muted">
                      {facts.map((fact, i) => (
                        <Fragment key={i}>
                          {i > 0 && " · "}
                          {fact}
                        </Fragment>
                      ))}
                    </span>
                  </span>
                }
              />
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="py-3 text-body text-text-muted">
            No repositories match “{filter}”.
          </li>
        )}
      </ul>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" loading={saving} onClick={() => onSave(picks)}>
          {saveLabel}
        </Button>
        {onSkip && (
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onSkip}>
            {skipLabel ?? "Not now"}
          </Button>
        )}
      </div>
    </div>
  );
}
