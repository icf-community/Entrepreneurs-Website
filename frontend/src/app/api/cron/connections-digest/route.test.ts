import { afterEach, describe, it, expect, vi } from "vitest";
import type { NextRequest } from "next/server";

// Exactly-once lives in the two RPCs (20260917000016); what this route
// owns is the auth surface and the hand-off between them. Pinned here:
// complete gets the claim id and a rendered email per recipient, nothing
// else — no address, no note — and a failed complete is reported as a
// failure rather than as mail that went out.
async function load() {
  vi.resetModules();
  return import("./route");
}

function req(auth?: string): NextRequest {
  const headers: Record<string, string> = auth ? { authorization: auth } : {};
  return new Request("http://localhost/api/cron/connections-digest", {
    headers,
  }) as unknown as NextRequest;
}

type Call = { fn: string; args: Record<string, unknown> };

function mockSupabase(opts: {
  claim: { data: unknown; error: unknown };
  complete?: { data: unknown; error: unknown };
}): Call[] {
  const calls: Call[] = [];
  vi.doMock("@/lib/supabase/service", () => ({
    createServiceClient: () => ({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return fn === "claim_connection_digests" ? opts.claim : opts.complete;
      },
    }),
  }));
  return calls;
}

const claimed = [
  { claim_id: "c-1", member_id: "m-1", first_name: "Priya", pending_count: 1, sender_names: ["Tom Hill"] },
  { claim_id: "c-1", member_id: "m-2", first_name: null, pending_count: 3, sender_names: ["A B", "C D", "E F"] },
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.doUnmock("@/lib/supabase/service");
});

describe("connections-digest auth surface", () => {
  it("500s when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const { POST } = await load();
    const res = await POST(req("Bearer anything"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/CRON_SECRET/);
  });

  it("403s on a wrong bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    const { POST } = await load();
    expect((await POST(req("Bearer wrong"))).status).toBe(403);
  });

  it("403s when the Authorization header is absent", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    const { GET } = await load();
    expect((await GET(req())).status).toBe(403);
  });
});

describe("connections-digest claim → complete", () => {
  it("hands complete the claim id and one rendered email per recipient", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    const calls = mockSupabase({
      claim: { data: claimed, error: null },
      complete: { data: 2, error: null },
    });
    const { POST } = await load();
    const res = await POST(req("Bearer topsecret"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ digested: 2 });
    expect(calls.map((c) => c.fn)).toEqual(["claim_connection_digests", "complete_connection_digests"]);
    expect(calls[0]!.args).toEqual({ p_limit: 50 });

    const { p_claim_id, p_emails } = calls[1]!.args as {
      p_claim_id: string;
      p_emails: Array<Record<string, string>>;
    };
    expect(p_claim_id).toBe("c-1");
    expect(p_emails.map((e) => e.member_id)).toEqual(["m-1", "m-2"]);
    expect(p_emails[0]!.subject).toMatch(/Tom Hill wants to connect/);
    expect(p_emails[1]!.subject).toMatch(/3 connection requests/);
    // The address is read from auth.users inside the RPC — never sent from here.
    for (const e of p_emails) {
      expect(Object.keys(e).sort()).toEqual(["html", "member_id", "subject", "text"]);
    }
  });

  it("reports the count complete actually queued, not the count claimed", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    mockSupabase({ claim: { data: claimed, error: null }, complete: { data: 1, error: null } });
    const { POST } = await load();
    expect(await (await POST(req("Bearer topsecret"))).json()).toEqual({ digested: 1 });
  });

  it("500s on a failed complete instead of claiming the mail went out", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    mockSupabase({
      claim: { data: claimed, error: null },
      complete: { data: null, error: { message: "boom" } },
    });
    const { POST } = await load();
    const res = await POST(req("Bearer topsecret"));
    expect(res.status).toBe(500);
    expect((await res.json()).digested).toBeUndefined();
  });

  it("500s on a failed claim and never calls complete", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    const calls = mockSupabase({ claim: { data: null, error: { message: "boom" } } });
    const { POST } = await load();
    expect((await POST(req("Bearer topsecret"))).status).toBe(500);
    expect(calls.map((c) => c.fn)).toEqual(["claim_connection_digests"]);
  });

  it("does nothing when nobody is claimed", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    const calls = mockSupabase({ claim: { data: [], error: null } });
    const { POST } = await load();
    expect(await (await POST(req("Bearer topsecret"))).json()).toEqual({ digested: 0 });
    expect(calls).toHaveLength(1);
  });
});
