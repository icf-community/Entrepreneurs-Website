import type { DirectoryMember } from "@/lib/data/directory";

export function memberSubtitle(m: DirectoryMember) {
  if (m.role === "alum") return `Alum · ${m.gradYear ?? "—"}`;
  return m.gradYear ? `Student · class of ${m.gradYear}` : "Imperial student";
}
