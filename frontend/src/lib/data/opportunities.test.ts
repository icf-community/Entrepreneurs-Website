import { describe, it, expect } from "vitest";
import { toOpportunity } from "./opportunities";

// These mappers were unreachable from a test until they moved out of the
// page files. Their whole job is the snake→camel rename plus the null
// fallbacks, and the fallbacks are the part with somewhere to hide: a
// missing `?? ""` renders "null" into the DOM.

const row = {
  id: "o1",
  position_name: "Founding Engineer",
  company: "Acme",
  pay: "£60k",
  location_type: "hybrid" as const,
  location_text: "London",
  description: "Build things.",
  start_month: 9,
  start_year: 2026,
  application_deadline: "2026-08-01",
  contact_email: "jobs@acme.com",
  apply_method: "link" as const,
  apply_url: "https://acme.com/jobs",
  created_at: "2026-07-15T09:00:00Z",
  posted_by: "u1",
  poster_first_name: "Ada",
  poster_surname: "Lovelace",
  poster_linkedin_url: "https://linkedin.com/in/ada",
  poster_avatar_path: null,
  skill_names: ["TypeScript"],
  sector_names: ["Fintech"],
  eligible_audience: "both",
};

describe("toOpportunity", () => {
  it("renames every field to camelCase", () => {
    expect(toOpportunity(row)).toEqual({
      id: "o1",
      positionName: "Founding Engineer",
      company: "Acme",
      pay: "£60k",
      locationType: "hybrid",
      locationText: "London",
      description: "Build things.",
      startMonth: 9,
      startYear: 2026,
      applicationDeadline: "2026-08-01",
      contactEmail: "jobs@acme.com",
      applyMethod: "link",
      applyUrl: "https://acme.com/jobs",
      createdAt: "2026-07-15T09:00:00Z",
      postedBy: { id: "u1", firstName: "Ada", surname: "Lovelace", linkedinUrl: "https://linkedin.com/in/ada", avatarPath: null },
      skills: ["TypeScript"],
      sectors: ["Fintech"],
      audience: "both",
    });
  });

  it("falls back to empty strings for a missing poster name", () => {
    const out = toOpportunity({ ...row, poster_first_name: null, poster_surname: null });
    expect(out.postedBy.firstName).toBe("");
    expect(out.postedBy.surname).toBe("");
  });

  it("falls back to empty arrays for null skill/sector aggregates", () => {
    const out = toOpportunity({ ...row, skill_names: null, sector_names: null });
    expect(out.skills).toEqual([]);
    expect(out.sectors).toEqual([]);
  });

  it("keeps a masked contact_email as null rather than inventing one", () => {
    // The RPC nulls this when visibility is off and the caller isn't the
    // poster or an admin. The mapper must not paper over it.
    expect(toOpportunity({ ...row, contact_email: null }).contactEmail).toBeNull();
  });
});
