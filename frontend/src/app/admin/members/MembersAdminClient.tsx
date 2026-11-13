"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import SearchableMultiSelect from "@/components/forms/SearchableMultiSelect";
import { useUrlFilters, useSearchDraft, type UrlFilters } from "@/lib/filters/useUrlFilters";
import { SearchInput, FilterPanel, ChipGroup, RangeFilter } from "@/components/filters/FilterBar";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose } from "@/components/ui/Dialog";
import { closeDialog, dialogCloser } from "@/components/ui/dialogCloser";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Pager } from "@/components/ui/Pager";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/Popover";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { Textarea } from "@/components/ui/Textarea";
import { adminDeleteUser, adminSetCommittee } from "./actions";
import { ErrorBanner } from "@/components/forms/Banners";
import { Field } from "@/components/forms/Field";
import { Icon } from "@/design-system/icons/Icon";
import { OrbitGlyph } from "@/design-system/OrbitGlyph";
import type { UserStatus } from "@/lib/database.overrides";
// Type-only, so the server-only module is erased rather than imported.
import type { AdminMember, AdminMemberFilters } from "@/lib/data/admin";
import type { Facets } from "@/lib/data/directory";
import { Updating } from "@/components/ui/Updating";

type Status = UserStatus;


const STATUS_LABEL: Record<Status, string> = {
  pending_onboarding: "Onboarding",
  pending_review:     "Awaiting review",
  approved:           "Approved",
  rejected:           "Rejected",
};

// A status is a tone, and the tone is meaning: a review waiting is lit, a
// rejection is danger, an approval is settled. The word is always there too.
const STATUS_TONE: Record<Status, BadgeTone> = {
  pending_onboarding: "neutral",
  pending_review:     "lit",
  approved:           "success",
  rejected:           "danger",
};

const FILTER_KEYS = ["role", "status", "course", "sector", "skill", "gradMin", "gradMax"];

export default function MembersAdminClient({
  members, facets, filters, matching, pageSize,
}: {
  /** One page of members, already filtered and sorted by Postgres. */
  members: AdminMember[];
  facets: Facets;
  filters: AdminMemberFilters;
  /** Members matching the current filters, across every page. */
  matching: number;
  pageSize: number;
}) {
  // Server navigation, unlike the other list pages: this client only ever
  // holds one page, so a filter is an argument to the query rather than
  // something it can apply itself. Changing any filter resets to page 1 —
  // page 4 of the old result set means nothing in the new one.
  const url = useUrlFilters({ navigate: "server", resetKey: "page" });
  const [query, setQuery] = useSearchDraft(url);
  const [selected, setSelected] = useState<AdminMember | null>(null);
  const [committeeTarget, setCommitteeTarget] = useState<AdminMember | null>(null);
  // Stable, so a dialog's close listener is attached once rather than on every render of this page.
  const closeDelete = useCallback(() => setSelected(null), []);
  const closeCommittee = useCallback(() => setCommitteeTarget(null), []);

  const selectedRoles    = new Set(filters.roles);
  const selectedStatuses = new Set(filters.statuses);
  const selectedCourses  = new Set(filters.courses);
  const selectedSectors  = new Set(filters.sectors);
  const selectedSkills   = new Set(filters.skills);

  const gradYearBounds =
    facets.grad_min != null && facets.grad_max != null
      ? { min: facets.grad_min, max: facets.grad_max }
      : null;

  const activeFilterCount =
    selectedRoles.size + selectedStatuses.size + selectedCourses.size +
    selectedSectors.size + selectedSkills.size +
    (filters.gradMin ? 1 : 0) + (filters.gradMax ? 1 : 0);

  return (
    <>
      <SearchInput
        label="Search members"
        placeholder="Search by name, email, or what they're working on"
        value={query}
        onChange={setQuery}
      />

      <MemberFilterControls
        url={url}
        filters={filters}
        facets={facets}
        matching={matching}
        activeFilterCount={activeFilterCount}
        selectedRoles={selectedRoles}
        selectedStatuses={selectedStatuses}
        selectedCourses={selectedCourses}
        selectedSectors={selectedSectors}
        selectedSkills={selectedSkills}
        gradYearBounds={gradYearBounds}
      />

      <MembersTable
        members={members}
        facets={facets}
        pending={url.pending}
        onEditCommittee={setCommitteeTarget}
        onDelete={setSelected}
      />

      <Pager
        url={url}
        page={filters.page}
        total={matching}
        pageSize={pageSize}
        label="Member pages"
      />

      {selected && (
        <DeleteUserDialog member={selected} onClose={closeDelete} />
      )}

      {committeeTarget && (
        <CommitteeDialog member={committeeTarget} onClose={closeCommittee} />
      )}
    </>
  );
}

function MemberFilterControls({
  url, filters, facets, matching, activeFilterCount,
  selectedRoles, selectedStatuses, selectedCourses, selectedSectors, selectedSkills, gradYearBounds,
}: {
  url: UrlFilters;
  filters: AdminMemberFilters;
  facets: Facets;
  matching: number;
  activeFilterCount: number;
  selectedRoles: Set<string>;
  selectedStatuses: Set<string>;
  selectedCourses: Set<string>;
  selectedSectors: Set<string>;
  selectedSkills: Set<string>;
  gradYearBounds: { min: number; max: number } | null;
}) {
  return (
    <FilterPanel
      activeCount={activeFilterCount}
      onClear={() => url.clear(...FILTER_KEYS)}
      resultCount={
        <>
          {matching === facets.total ? `${facets.total}` : `${matching} of ${facets.total}`}
          <span className="sr-only"> members shown</span>
        </>
      }
    >
      <ChipGroup
        label="Role"
        options={[
          { value: "student", label: "Students" },
          { value: "alum",    label: "Alumni" },
        ]}
        selected={selectedRoles}
        onToggle={(v) => url.toggle("role", v)}
      />

      <ChipGroup
        label="Status"
        options={[
          { value: "pending_onboarding", label: "Onboarding" },
          { value: "pending_review",     label: "Awaiting review" },
          { value: "approved",           label: "Approved" },
          { value: "rejected",           label: "Rejected" },
        ]}
        selected={selectedStatuses}
        onToggle={(v) => url.toggle("status", v)}
      />

      {facets.courses.length > 0 && (
        <SearchableMultiSelect
          label="Course"
          options={facets.courses}
          selected={selectedCourses}
          onChange={(next) => url.apply({ course: [...next] })}
          placeholder="Filter by course — search or pick"
          emptyText="No course matches that search."
        />
      )}

      {facets.sectors.length > 0 && (
        <ChipGroup
          label="Interests"
          options={facets.sectors.map((s) => ({ value: s, label: s }))}
          selected={selectedSectors}
          onToggle={(v) => url.toggle("sector", v)}
        />
      )}

      {facets.skills.length > 0 && (
        <ChipGroup
          label="Skills"
          options={facets.skills.map((s) => ({ value: s, label: s }))}
          selected={selectedSkills}
          onToggle={(v) => url.toggle("skill", v)}
        />
      )}

      {gradYearBounds && (
        <RangeFilter
          label="Graduation year"
          hint={` — range ${gradYearBounds.min}–${gradYearBounds.max}`}
          type="number"
          bounds={gradYearBounds}
          commitOn="blur"
          from={filters.gradMin}
          to={filters.gradMax}
          fromLabel="Graduation year from"
          toLabel="Graduation year to"
          fromPlaceholder={`From ${gradYearBounds.min}`}
          toPlaceholder={`To ${gradYearBounds.max}`}
          onFromChange={(v) => url.apply({ gradMin: v })}
          onToChange={(v) => url.apply({ gradMax: v })}
        />
      )}
    </FilterPanel>
  );
}

function MembersTable({
  members, facets, pending, onEditCommittee, onDelete,
}: {
  members: AdminMember[];
  facets: Facets;
  pending: boolean;
  onEditCommittee: (m: AdminMember) => void;
  onDelete: (m: AdminMember) => void;
}) {
  return (
    // A pending navigation dims the table rather than replacing it with a
    // skeleton: these rows are still valid, just about to change.
    <div className={`relative ${pending ? "opacity-60 transition-opacity duration-150" : ""}`} aria-busy={pending || undefined}>
      {pending && <Updating />}
      {members.length === 0 ? (
        <EmptyState icon={facets.total === 0 ? "members" : "search"}>
          {facets.total === 0 ? "No members yet." : "No members match your search or filters."}
        </EmptyState>
      ) : (
        // The Table keeps its own focusable scroll region, so the seven columns
        // never clip off-screen, and below 640 px of its width every row becomes
        // a card with the same DOM (each cell prints its own column name).
        <Table label="Member directory" density="compact">
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Email</TH>
              <TH>Role</TH>
              <TH>Status</TH>
              <TH>Course</TH>
              <TH>Year</TH>
              <TH>Committee</TH>
              <TH><span className="sr-only">Actions</span></TH>
            </TR>
          </THead>
          <TBody>
            {members.map((m) => (
              <MemberRow key={m.id} m={m} onEditCommittee={onEditCommittee} onDelete={onDelete} />
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

function MemberRow({
  m, onEditCommittee, onDelete,
}: {
  m: AdminMember;
  onEditCommittee: (m: AdminMember) => void;
  onDelete: (m: AdminMember) => void;
}) {
  const name = `${m.firstName} ${m.surname}`;
  return (
    <TR>
      <TD label="Name" primary nowrap>{m.firstName} {m.surname}</TD>
      <TD label="Email">{m.email ?? <span className="text-text-muted">—</span>}</TD>
      <TD label="Role">{m.role}</TD>
      <TD label="Status">
        <Badge tone={STATUS_TONE[m.status]} dot>{STATUS_LABEL[m.status]}</Badge>
      </TD>
      <TD label="Course">
        {m.course ? <span className="block max-w-[14rem] truncate" title={m.course}>{m.course}</span> : <span className="text-text-muted">—</span>}
      </TD>
      <TD label="Year" className="data">{m.gradYear ?? <span className="text-text-muted">—</span>}</TD>
      <TD label="Committee">
        {m.isCommittee ? <Badge tone="lit">{m.committeeRole}</Badge> : <span className="text-text-muted">—</span>}
      </TD>
      {/* The two things you can do to a member sit behind one ring: fifty rows
          of two buttons buried the table, and Delete is the one to reach for
          on purpose (it is drawn in the danger tone, apart from the other). */}
      <TD actions className="justify-end">
        <Menu label={`Actions for ${name}`} iconOnly placement="bottom-end" className="size-[36px]">
          <MenuItem icon="committee" onSelect={() => onEditCommittee(m)}>
            {m.isCommittee ? "Edit committee" : "Add to committee"}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon="trash" tone="danger" onSelect={() => onDelete(m)}>
            Delete
          </MenuItem>
        </Menu>
      </TD>
    </TR>
  );
}

function CommitteeDialog({ member, onClose }: { member: AdminMember; onClose: () => void }) {
  const router = useRouter();
  const [role, setRole] = useState(member.committeeRole ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const title = `${member.isCommittee ? "Edit" : "Add"} ${member.firstName} ${member.surname}`;
  // The task is the field, so focus goes there when the dialog opens. This effect runs after the Dialog's own (a parent's effect
  // follows its children's), so the dialog is already open and the browser has noted the menu button as where focus returns to.
  const roleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { roleRef.current?.focus(); }, []);

  // `close` is the dialog's own, taken from the click before the await: the browser has to be the one that closes it,
  // or the focus it restores (to the row's menu) is dropped on <body>.
  const save = (close: () => void) => {
    setError("");
    if (!role.trim()) { setError("A committee role is required — e.g. \"President\"."); return; }
    startTransition(async () => {
      const res = await adminSetCommittee(member.id, true, role);
      if (!res.ok) { setError(res.error); return; }
      close();
      router.refresh();
    });
  };

  const remove = (close: () => void) => {
    setError("");
    startTransition(async () => {
      const res = await adminSetCommittee(member.id, false, "");
      if (!res.ok) { setError(res.error); return; }
      close();
      router.refresh();
    });
  };

  return (
    <Dialog label={title} onClose={onClose} className="w-full max-w-[28rem] p-6 sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 text-caption font-medium text-text-muted">
            <Icon name="committee" size={16} className="text-lit" />
            Committee
          </p>
          <h2 className="mt-2 font-display text-title text-text-primary">
            {member.isCommittee ? "Edit" : "Add"} {member.firstName} {member.surname}
          </h2>
        </div>
        <DialogClose className="-mr-2 -mt-2" disabled={pending} />
      </div>
      <p className="mt-3 text-body text-text-secondary">
        Shows a gold banner with this role on their photo everywhere it appears, and moves
        them from the member directory to the Meet the Committee page.
      </p>

      {error && <div className="mt-4"><ErrorBanner>{error}</ErrorBanner></div>}

      <div className="mt-5">
        <Field label="Role">
          <Input
            ref={roleRef}
            id="committee-role"
            type="text"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. President"
            maxLength={60}
          />
        </Field>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          {member.isCommittee && (
            <Button type="button" variant="dangerGhost" size="md" disabled={pending} onClick={(e) => remove(dialogCloser(e))}>
              Remove from committee
            </Button>
          )}
        </div>
        <div className="flex gap-3">
          <Button type="button" variant="quiet" size="md" disabled={pending} onClick={(e) => closeDialog(e)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="md"
            disabled={pending || !role.trim()}
            onClick={(e) => save(dialogCloser(e))}
            leading={pending ? <OrbitGlyph spin="fast" /> : undefined}
          >
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}


function DeleteUserDialog({ member, onClose }: { member: AdminMember; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { reasonRef.current?.focus(); }, []);

  // See CommitteeDialog: the dialog's own close, taken before the await.
  const handleConfirm = (close: () => void) => {
    setError("");
    const r = reason.trim();
    if (!r) { setError("A reason is required — it will be included in the email."); return; }
    startTransition(async () => {
      const res = await adminDeleteUser(member.id, r);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      close();
      router.refresh();
    });
  };

  return (
    <Dialog
      label={`Delete ${member.firstName} ${member.surname}?`}
      tone="danger"
      onClose={onClose}
      className="w-full max-w-[30rem] p-6 sm:p-7"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 text-caption font-medium text-danger">
            <Icon name="warning" size={16} />
            Danger zone
          </p>
          <h2 className="mt-2 font-display text-title text-text-primary">
            Delete {member.firstName} {member.surname}?
          </h2>
        </div>
        <DialogClose className="-mr-2 -mt-2" disabled={pending} />
      </div>
      <p className="mt-3 text-body text-text-secondary">
        This permanently removes their profile, posted opportunities, events, VC/grant submissions, and any admin actions they took. They will be emailed the reason below. <span className="text-danger">This cannot be undone.</span>
      </p>

      {error && <div className="mt-4"><ErrorBanner>{error}</ErrorBanner></div>}

      <div className="mt-5">
        <Field label="Reason (sent to user)">
          <Textarea
            ref={reasonRef}
            id="reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Inappropriate listings violating community guidelines."
            className="resize-none"
          />
        </Field>
      </div>

      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button type="button" variant="quiet" size="md" disabled={pending} onClick={(e) => closeDialog(e)}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          size="md"
          disabled={pending || !reason.trim()}
          onClick={(e) => handleConfirm(dialogCloser(e))}
          leading={pending ? <OrbitGlyph spin="fast" /> : <Icon name="trash" size={18} />}
        >
          {pending ? "Deleting…" : "Permanently delete + email"}
        </Button>
      </div>
    </Dialog>
  );
}
