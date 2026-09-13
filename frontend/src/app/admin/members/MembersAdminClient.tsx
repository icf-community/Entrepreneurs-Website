"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import SearchableMultiSelect from "@/components/forms/SearchableMultiSelect";
import { useUrlFilters, useSearchDraft } from "@/lib/filters/useUrlFilters";
import { SearchInput, FilterPanel, ChipGroup, RangeFilter } from "@/components/filters/FilterBar";
import { Pager } from "@/components/ui/Pager";
import { adminDeleteUser, adminSetCommittee } from "./actions";
import { ErrorBanner } from "@/components/forms/Banners";
import type { UserStatus } from "@/lib/database.overrides";
// Type-only, so the server-only module is erased rather than imported.
import type { AdminMember, AdminMemberFilters } from "@/lib/data/admin";
import type { Facets } from "@/lib/data/directory";

type Status = UserStatus;


const STATUS_LABEL: Record<Status, string> = {
  pending_onboarding: "Onboarding",
  pending_review:     "Awaiting review",
  approved:           "Approved",
  rejected:           "Rejected",
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

      {/* A pending navigation dims the table rather than replacing it with a
          skeleton: these rows are still valid, just about to change. */}
      <div className={url.pending ? "opacity-60 transition-opacity duration-150" : undefined}>
        {members.length === 0 ? (
          <div className="rounded-lg border border-border bg-bg-card px-6 py-14 text-center text-[0.85rem] text-text-muted">
            {facets.total === 0 ? "No members yet." : "No members match your search or filters."}
          </div>
        ) : (
          <div className="rounded-2xl bg-bg-card border border-border overflow-hidden">
            {/* The table's natural content width (7 columns plus two
                action buttons) can exceed the page's max-w container on
                real viewports — this scrolls the table alone rather than
                letting the outer overflow-hidden (there for the rounded
                corners) silently clip the rightmost column off-screen. */}
            <div className="overflow-x-auto">
            <table className="w-full text-[0.825rem]">
              <thead>
                <tr className="border-b border-border-subtle text-[0.7rem] text-text-muted uppercase tracking-wider">
                  <th className="text-left px-4 py-3 font-normal">Name</th>
                  <th className="text-left px-4 py-3 font-normal">Email</th>
                  <th className="text-left px-4 py-3 font-normal">Role</th>
                  <th className="text-left px-4 py-3 font-normal">Status</th>
                  <th className="text-left px-4 py-3 font-normal">Course</th>
                  <th className="text-left px-4 py-3 font-normal">Year</th>
                  <th className="text-left px-4 py-3 font-normal">Committee</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-b border-border-subtle last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-text-primary">{m.firstName} {m.surname}</td>
                    <td className="px-4 py-3 text-text-secondary">{m.email ?? "—"}</td>
                    <td className="px-4 py-3 text-text-muted">{m.role}</td>
                    <td className="px-4 py-3 text-text-muted">{STATUS_LABEL[m.status]}</td>
                    <td className="px-4 py-3 text-text-muted truncate max-w-[200px]">{m.course ?? "—"}</td>
                    <td className="px-4 py-3 text-text-muted">{m.gradYear ?? "—"}</td>
                    <td className="px-4 py-3">
                      {m.isCommittee ? (
                        <span className="inline-block rounded-lg border border-signal/40 bg-signal-muted px-2 py-1 text-[0.7rem] font-medium text-signal align-bottom">
                          {m.committeeRole}
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setCommitteeTarget(m)}
                          className="px-3 py-1.5 rounded-lg bg-transparent border border-border-strong text-text-secondary text-[0.75rem] cursor-pointer transition-colors hover:border-accent hover:text-text-primary"
                        >
                          {m.isCommittee ? "Edit committee" : "Add to committee"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelected(m)}
                          className="px-3 py-1.5 rounded-lg bg-transparent border border-[#ff4d4d]/30 text-[#ff6b6b] text-[0.75rem] cursor-pointer transition-colors hover:bg-[#ff4d4d]/10"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>

      <Pager
        url={url}
        page={filters.page}
        total={matching}
        pageSize={pageSize}
        label="Member pages"
      />

      {selected && (
        <DeleteUserModal member={selected} onClose={() => setSelected(null)} />
      )}

      {committeeTarget && (
        <CommitteeModal member={committeeTarget} onClose={() => setCommitteeTarget(null)} />
      )}
    </>
  );
}

function CommitteeModal({ member, onClose }: { member: AdminMember; onClose: () => void }) {
  const router = useRouter();
  const [role, setRole] = useState(member.committeeRole ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const save = () => {
    setError("");
    if (!role.trim()) { setError("A committee role is required — e.g. \"President\"."); return; }
    startTransition(async () => {
      const res = await adminSetCommittee(member.id, true, role);
      if (!res.ok) { setError(res.error); return; }
      onClose();
      router.refresh();
    });
  };

  const remove = () => {
    setError("");
    startTransition(async () => {
      const res = await adminSetCommittee(member.id, false, "");
      if (!res.ok) { setError(res.error); return; }
      onClose();
      router.refresh();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="w-full max-w-[480px] rounded-2xl bg-bg-card border border-border-strong p-6">
        <p className="label-wide text-signal mb-3">Committee</p>
        <h2 className="font-display text-[1.25rem] text-text-primary mb-2">
          {member.isCommittee ? "Edit" : "Add"} {member.firstName} {member.surname}
        </h2>
        <p className="text-[0.825rem] text-text-secondary leading-relaxed mb-5">
          Shows a gold banner with this role on their photo everywhere it appears, and moves
          them from the member directory to the Meet the Committee page.
        </p>

        {error && <div className="mb-4"><ErrorBanner>{error}</ErrorBanner></div>}

        <label htmlFor="committee-role" className="block text-[0.75rem] text-text-muted mb-1.5">
          Role
        </label>
        <input
          id="committee-role"
          type="text"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="e.g. President"
          maxLength={60}
          className="w-full px-3 py-2 bg-white/[0.03] border border-border rounded-lg text-[0.85rem] text-text-primary placeholder:text-text-muted focus:border-accent/50 mb-5"
        />

        <div className="flex items-center justify-between gap-3">
          <div>
            {member.isCommittee && (
              <button
                type="button"
                onClick={remove}
                disabled={pending}
                className="px-4 py-2 rounded-lg bg-transparent border border-[#ff4d4d]/30 text-[#ff6b6b] text-[0.85rem] cursor-pointer transition-colors hover:bg-[#ff4d4d]/10 disabled:opacity-50"
              >
                Remove from committee
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="px-4 py-2 rounded-lg bg-white/[0.05] border border-border-strong text-text-primary text-[0.85rem] cursor-pointer transition-colors hover:bg-white/[0.10] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={pending || !role.trim()}
              className="px-4 py-2 rounded-lg bg-signal-muted border border-signal/40 text-signal text-[0.85rem] font-medium cursor-pointer transition-colors hover:bg-signal/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


function DeleteUserModal({ member, onClose }: { member: AdminMember; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const handleConfirm = () => {
    setError("");
    const r = reason.trim();
    if (!r) { setError("A reason is required — it will be included in the email."); return; }
    startTransition(async () => {
      const res = await adminDeleteUser(member.id, r);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="w-full max-w-[520px] rounded-2xl bg-bg-card border border-[#ff4d4d]/30 p-6">
        <p className="label-wide text-[#ff8080] mb-3">Danger zone</p>
        <h2 className="font-display text-[1.25rem] text-text-primary mb-2">
          Delete {member.firstName} {member.surname}?
        </h2>
        <p className="text-[0.825rem] text-text-secondary leading-relaxed mb-5">
          This permanently removes their profile, posted opportunities, events, VC/grant submissions, and any admin actions they took. They will be emailed the reason below. <span className="text-[#ff6b6b]">This cannot be undone.</span>
        </p>

        {error && <div className="mb-4"><ErrorBanner>{error}</ErrorBanner></div>}

        <label htmlFor="reason" className="block text-[0.75rem] text-text-muted mb-1.5">
          Reason (sent to user)
        </label>
        <textarea
          id="reason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Inappropriate listings violating community guidelines."
          className="w-full px-3 py-2 bg-white/[0.03] border border-border rounded-lg text-[0.85rem] text-text-primary placeholder:text-text-muted focus:border-[#ff4d4d]/50 resize-none mb-5"
        />

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="px-4 py-2 rounded-lg bg-white/[0.05] border border-border-strong text-text-primary text-[0.85rem] cursor-pointer transition-colors hover:bg-white/[0.10] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={pending || !reason.trim()}
            className="px-4 py-2 rounded-lg bg-[#ff4d4d]/15 border border-[#ff4d4d]/30 text-[#ff6b6b] text-[0.85rem] font-medium cursor-pointer transition-colors hover:bg-[#ff4d4d]/25 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pending ? "Deleting…" : "Permanently delete + email"}
          </button>
        </div>
      </div>
    </div>
  );
}
