// Who a job is for (AI-plan §7.2), as members read it.
export type Audience = "students" | "graduates" | "both";

export function audienceLabel(audience: Audience | null): string | null {
  switch (audience) {
    case "students": return "For students";
    case "graduates": return "For graduates";
    case "both": return "For students and graduates";
    default: return null;
  }
}
