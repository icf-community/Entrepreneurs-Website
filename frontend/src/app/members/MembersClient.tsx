"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SearchableMultiSelect from "@/components/forms/SearchableMultiSelect";
import { useUrlFilters, useSearchDraft, type UrlFilters } from "@/lib/filters/useUrlFilters";
import { SearchInput, FilterPanel, ChipGroup, RangeFilter } from "@/components/filters/FilterBar";
import { Pager } from "@/components/ui/Pager";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/design-system/icons/Icon";
import { MemberDialog } from "@/components/members/MemberDialog";
import { MemberCard } from "@/components/members/MemberCard";
import { createAiDraftHandoff } from "@/lib/ai/entryPoint";
import { useToast } from "@/components/ui/Toast";
// Type-only, so the server-only module is erased rather than imported.
// bioPreview and hobbiesPreview are truncated by list_directory_cards to
// what the card renders; the full text and the profile links are fetched
// when the dialog opens — they are most of the payload and almost none of
// the page.
import type {
  DirectoryMember,
  Facets,
  MemberFilters,
} from "@/lib/data/directory";
import { Updating } from "@/components/ui/Updating";

// ════════════════════════════════════════════════════════════════════
// Filtering and paging happen on the server; this component's job is to
// keep the URL in step with the controls.
//
// That is not a stylistic choice. The directory used to load every member
// and filter in memory, which meant PostgREST's 1000-row cap silently hid
// everyone past the thousandth, and every navigation shipped the whole
// membership. Neither is fixable while the filter logic lives here.
//
// The upside is that a filtered view is now a shareable URL, and the back
// button steps through filter history.
// ════════════════════════════════════════════════════════════════════
export default function MembersClient({
  members, facets, filters, matching, pageSize, aiEnabled,
}: {
  members: DirectoryMember[];
  facets: Facets;
  filters: MemberFilters;
  matching: number;
  pageSize: number;
  aiEnabled: boolean;
}) {
  // Server-side navigation: the directory is too large to ship whole, so a
  // filter is an argument to a Postgres query rather than a local operation.
  // `filters` (the prop) is the server's own parse of these same params —
  // the values rendered here and the values the query ran with are one
  // thing, not two that can disagree.
  const url = useUrlFilters({ navigate: "server", resetKey: "page" });
  const [queryDraft, setQueryDraft] = useSearchDraft(url);

  const [openMember, setOpenMember] = useState<DirectoryMember | null>(null);
  const [searchingWithAi, setSearchingWithAi] = useState(false);
  const toast = useToast();
  const router = useRouter();

  // S8 gap 20. The link to /foundry-ai carries only an opaque handoff id,
  // never the filter values (AI-plan.md "no criteria in URLs").
  const searchWithAi = async () => {
    setSearchingWithAi(true);
    const res = await createAiDraftHandoff("network", {
      role: filters.roles, course: filters.courses, sector: filters.sectors,
      skill: filters.skills, gradMin: filters.gradMin, gradMax: filters.gradMax, q: queryDraft,
    });
    setSearchingWithAi(false);
    if (res.ok) router.push(`/foundry-ai?mode=network&draft=${res.data.id}`);
    else toast(res.error, "error");
  };

  const activeFilterCount =
    filters.roles.length + filters.courses.length + filters.sectors.length +
    filters.skills.length + (filters.gradMin ? 1 : 0) + (filters.gradMax ? 1 : 0);

  const gradYearBounds =
    facets.grad_min != null && facets.grad_max != null
      ? { min: facets.grad_min, max: facets.grad_max }
      : null;


  return (
    <>
      {/* Search first, with the AI hand-off beside it; the filters are one press below. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* A basis wider than half a phone sends the AI button to its own line there, so the placeholder is never clipped. */}
        <div className="min-w-0 flex-[1_1_20rem]">
          <SearchInput
            label="Search members"
            placeholder="Search by name, course, skill, sector, or what they're working on"
            value={queryDraft}
            onChange={setQueryDraft}
            className=""
          />
        </div>
        {aiEnabled && (
          <Button
            variant="ghost"
            size="sm"
            loading={searchingWithAi}
            onClick={searchWithAi}
            leading={<Icon name="foundry-ai" size={18} />}
          >
            Search with AI
          </Button>
        )}
      </div>

      <MemberFilterPanel
        facets={facets}
        filters={filters}
        matching={matching}
        gradYearBounds={gradYearBounds}
        activeFilterCount={activeFilterCount}
        url={url}
      />

      <MemberResultsGrid members={members} facets={facets} pending={url.pending} onOpenMember={setOpenMember} />

      <Pager
        url={url}
        page={filters.page}
        total={matching}
        pageSize={pageSize}
        label="Directory pages"
      />

      {openMember && (
        <MemberDialog member={openMember} onClose={() => setOpenMember(null)} />
      )}
    </>
  );
}

// ─── Filter controls ──────────────────────────────────────────────────
function MemberFilterPanel({
  facets, filters, matching, gradYearBounds, activeFilterCount, url,
}: {
  facets: Facets;
  filters: MemberFilters;
  matching: number;
  gradYearBounds: { min: number; max: number } | null;
  activeFilterCount: number;
  url: UrlFilters;
}) {
  return (
    <FilterPanel
      activeCount={activeFilterCount}
      onClear={() => url.clear("role", "course", "sector", "skill", "gradMin", "gradMax")}
      resultCount={
        <>
          {matching === facets.total ? `${facets.total}` : `${matching} of ${facets.total}`}
          <span className="sr-only"> members match</span>
        </>
      }
    >
      {facets.unavailable && (
        <p role="status" className="text-body text-text-muted">
          Couldn&apos;t load the course, sector and skill filters. Reload to try again.
        </p>
      )}
      <ChipGroup
        label="Role"
        options={[
          { value: "student", label: "Students" },
          { value: "alum",    label: "Alumni" },
        ]}
        selected={new Set(filters.roles)}
        onToggle={(v) => url.toggle("role", v)}
      />

      {facets.courses.length > 0 && (
        <SearchableMultiSelect
          label="Course"
          options={facets.courses}
          selected={new Set(filters.courses)}
          onChange={(next) => url.apply({ course: [...next] })}
          placeholder="Filter by course — search or pick"
          emptyText="No course matches that search."
        />
      )}

      {facets.sectors.length > 0 && (
        <ChipGroup
          label="Sectors"
          options={facets.sectors.map((s) => ({ value: s, label: s }))}
          selected={new Set(filters.sectors)}
          onToggle={(v) => url.toggle("sector", v)}
        />
      )}

      {facets.skills.length > 0 && (
        <ChipGroup
          label="Skills"
          options={facets.skills.map((s) => ({ value: s, label: s }))}
          selected={new Set(filters.skills)}
          onToggle={(v) => url.toggle("skill", v)}
        />
      )}

      {gradYearBounds && (
        <RangeFilter
          label="Graduation year"
          hint={` — range ${gradYearBounds.min}–${gradYearBounds.max}`}
          type="number"
          bounds={gradYearBounds}
          from={filters.gradMin}
          to={filters.gradMax}
          fromLabel="Graduation year from"
          toLabel="Graduation year to"
          fromPlaceholder={`From ${gradYearBounds.min}`}
          toPlaceholder={`To ${gradYearBounds.max}`}
          // Every keystroke here is a database query, so wait for the field
          // to be finished with rather than filtering on a half-typed year.
          commitOn="blur"
          onFromChange={(v) => url.apply({ gradMin: v })}
          onToChange={(v) => url.apply({ gradMax: v })}
        />
      )}
    </FilterPanel>
  );
}

// ─── Results grid ───────────────────────────────────────────────────
function MemberResultsGrid({
  members, facets, pending, onOpenMember,
}: {
  members: DirectoryMember[];
  facets: Facets;
  pending: boolean;
  onOpenMember: (m: DirectoryMember) => void;
}) {
  return (
    // A pending navigation dims the current page rather than replacing it
    // with a skeleton: the results are still valid, just about to change,
    // and swapping them for placeholders on every keystroke would flash.
    <div className={`relative ${pending ? "opacity-60 transition-opacity duration-150" : ""}`} aria-busy={pending || undefined}>
      {pending && <Updating />}
      {members.length === 0 ? (
        <EmptyState icon={facets.total === 0 ? "members" : "search"}>
          {facets.total === 0 ? "No members yet." : "No members match your search or filters."}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((m) => <MemberCard key={m.id} member={m} onClick={() => onOpenMember(m)} />)}
        </div>
      )}
    </div>
  );
}
