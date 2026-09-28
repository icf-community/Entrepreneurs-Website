import { describe, it, expect } from "vitest";
import { toPendingMember, toAdminMember } from "./admin";

const pendingRow = {
  id: "u1",
  first_name: "Ada",
  surname: "Lovelace",
  role: "alum" as const,
  course: "Computing",
  grad_year: 2024,
  bio: "Builds things.",
  working_on: "A compiler.",
  linkedin_url: "https://linkedin.com/in/ada",
  github_url: null,
  portfolio_url: null,
  created_at: "2026-01-01T00:00:00Z",
  skill_names: ["Rust"],
  sector_names: null,
  total_count: 3,
};

describe("toPendingMember", () => {
  it("renames to camelCase and defaults the tag arrays", () => {
    const m = toPendingMember(pendingRow);
    expect(m.firstName).toBe("Ada");
    expect(m.gradYear).toBe(2024);
    expect(m.workingOn).toBe("A compiler.");
    expect(m.skills).toEqual(["Rust"]);
    expect(m.sectors).toEqual([]);
  });

  // admin_list_pending_profiles returns the signup email, and nothing on
  // the review card renders it. A field put on these props is a field
  // serialised into the RSC payload sent to the browser, so mapping it
  // would ship every pending applicant's email to the page. This test is
  // here to fail if someone adds it back without a renderer.
  it("does not carry the signup email onto the review card", () => {
    expect(toPendingMember(pendingRow)).not.toHaveProperty("email");
  });

  it("does not put total_count on the member", () => {
    expect(toPendingMember(pendingRow)).not.toHaveProperty("total_count");
  });
});

const adminRow = {
  id: "u2",
  first_name: "Grace",
  surname: "Hopper",
  role: "student" as const,
  status: "pending_review" as const,
  course: null,
  grad_year: null,
  email: "grace@ic.ac.uk",
  is_committee: false,
  committee_role: null,
  created_at: "2026-02-01T00:00:00Z",
  skill_names: null,
  sector_names: ["Fintech"],
  total_count: 9,
};

describe("toAdminMember", () => {
  it("renames to camelCase and defaults the tag arrays", () => {
    const m = toAdminMember(adminRow);
    expect(m.firstName).toBe("Grace");
    expect(m.status).toBe("pending_review");
    expect(m.course).toBeNull();
    expect(m.gradYear).toBeNull();
    expect(m.skills).toEqual([]);
    expect(m.sectors).toEqual(["Fintech"]);
    expect(m.isCommittee).toBe(false);
    expect(m.committeeRole).toBeNull();
  });

  // Unlike the review card, this one does render the email — the admin
  // table has a column for it. The pair of tests is the record of which
  // surface is allowed to see it.
  it("keeps the signup email, which the admin table renders", () => {
    expect(toAdminMember(adminRow).email).toBe("grace@ic.ac.uk");
  });
});

// B4: the dashboard said "Queues clear" whenever a count query failed,
// because a failed count read as 0.
describe("pendingCounts", () => {
  const okCount = { count: 2, error: null };
  const failed = { count: null, error: { message: "permission denied", code: "42501" }, status: 403 };

  function db(profiles: unknown, edits: { data: unknown; error: unknown }) {
    const chain = (res: unknown) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => Promise.resolve(res);
      return q;
    };
    return {
      from: (t: string) => chain(t === "profiles" ? profiles : okCount),
      rpc: async () => edits,
    } as never;
  }

  it("adds the queues up when every count loads", async () => {
    const { pendingCounts } = await import("./admin");
    const c = await pendingCounts(db(okCount, { data: [{}, {}], error: null }));
    expect(c.total).toBe(10);
  });

  it("throws rather than reporting 0 when a count fails", async () => {
    const { pendingCounts } = await import("./admin");
    await expect(pendingCounts(db(failed, { data: [], error: null }))).rejects.toThrow();
  });

  it("throws rather than reporting 0 when the edits queue fails", async () => {
    const { pendingCounts } = await import("./admin");
    await expect(
      pendingCounts(db(okCount, { data: null, error: { message: "boom", code: "XX000" } })),
    ).rejects.toThrow();
  });
});
