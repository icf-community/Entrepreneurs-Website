import type { DraftFilters } from "./entryPoint";
import type { AiMode } from "./types";

// Turns a handed-off set of directory filters into a plain-language draft
// for the Composer — visible, editable, unsent. The member always presses
// Send; this only saves them re-typing what they already picked.
export function renderDraftText(mode: AiMode, filters: DraftFilters): string {
  if (mode === "opportunities") {
    const q = filters.q?.trim();
    return q ? `Jobs matching: ${q}` : "";
  }
  const parts: string[] = [];
  const q = filters.q?.trim();
  if (q) parts.push(q);
  if (filters.skill?.length) parts.push(`skills: ${filters.skill.join(", ")}`);
  if (filters.sector?.length) parts.push(`sector: ${filters.sector.join(", ")}`);
  if (filters.course?.length) parts.push(`course: ${filters.course.join(", ")}`);
  if (filters.role?.length) parts.push(`role: ${filters.role.join(", ")}`);
  if (filters.gradMin || filters.gradMax) {
    parts.push(`graduating ${filters.gradMin || "any"}–${filters.gradMax || "any"}`);
  }
  return parts.join("; ");
}
