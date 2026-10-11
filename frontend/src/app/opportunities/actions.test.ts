import { afterEach, describe, it, expect, vi } from "vitest";

// S0: two taps from two tabs both find no bookmark and both insert. The
// loser hits the unique constraint; the bookmark it asked for exists, so
// that is a success, not an error toast.

vi.mock("@/lib/listings/user", () => ({ submitListing: vi.fn(), updateOwnListing: vi.fn() }));
vi.mock("@/lib/auth/currentUser", () => ({ currentUser: async () => ({ user: { id: "u1" } }) }));

function setup(insertError: unknown) {
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: null, error: null }),
    insert: async () => ({ error: insertError }),
  };
  vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => q }) }));
}

async function load() {
  vi.resetModules();
  return import("./actions");
}

afterEach(() => vi.doUnmock("@/lib/supabase/server"));

describe("toggleOpportunityBookmark", () => {
  it("treats a concurrent insert of the same bookmark as success", async () => {
    setup({ code: "23505", message: "duplicate key value violates unique constraint" });
    const { toggleOpportunityBookmark } = await load();
    expect(await toggleOpportunityBookmark("o1")).toEqual({ ok: true, bookmarked: true });
  });

  it("still reports any other insert failure", async () => {
    setup({ code: "42501", message: "permission denied" });
    const { toggleOpportunityBookmark } = await load();
    expect(await toggleOpportunityBookmark("o1")).toMatchObject({ ok: false });
  });
});
