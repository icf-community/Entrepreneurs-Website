import { afterEach, describe, it, expect, vi } from "vitest";
import type { NextRequest } from "next/server";

// The drain route's request-auth surface is the security boundary for the
// service-role email queue. These assert the guard before any DB/Resend work
// (none of these cases reach createServiceClient).
async function load() {
  vi.resetModules();
  return import("./route");
}

function req(auth?: string): NextRequest {
  const headers: Record<string, string> = auth ? { authorization: auth } : {};
  return new Request("http://localhost/api/cron/drain-email", { headers }) as unknown as NextRequest;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("drain-email auth surface", () => {
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
    const res = await POST(req("Bearer wrong"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Forbidden");
  });

  it("403s when the Authorization header is absent", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    const { GET } = await load();
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  it("500s when authed but RESEND_API_KEY is missing (never touches the DB)", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    vi.stubEnv("RESEND_API_KEY", "");
    const { POST } = await load();
    const res = await POST(req("Bearer topsecret"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/RESEND_API_KEY/);
  });
});

// D3: what each Resend outcome does to the queue row. The cron re-runs every
// few minutes, so the row update IS the retry policy: a mistake here either
// loses mail (buried when it should retry) or burns attempts on a rate limit.
describe("drain-email send outcomes", () => {
  type Update = { id: string; patch: Record<string, unknown> };

  async function drainOne(outcome: { data?: { id: string } | null; error?: { statusCode?: number; message: string } | null } | Error) {
    vi.stubEnv("CRON_SECRET", "topsecret");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_FROM", "Foundry <noreply@mail.example>");
    vi.resetModules();

    const updates: Update[] = [];
    const sends: { idempotencyKey?: string }[] = [];
    const row = {
      id: "row-1", to_address: "m@example.com", subject: "s", text_body: "t", html_body: "<p>t</p>",
      reply_to: null, attempts: 2, max_attempts: 8,
    };
    vi.doMock("@/lib/supabase/service", () => ({
      createServiceClient: () => ({
        rpc: async () => ({ data: [row], error: null }),
        from: () => ({
          update: (patch: Record<string, unknown>) => ({
            eq: async (_c: string, id: string) => { updates.push({ id, patch }); return { error: null }; },
          }),
        }),
      }),
    }));
    vi.doMock("resend", () => ({
      Resend: class {
        emails = {
          send: async (_msg: unknown, opts: { idempotencyKey?: string }) => {
            sends.push(opts);
            if (outcome instanceof Error) throw outcome;
            return { data: outcome.data ?? null, error: outcome.error ?? null };
          },
        };
      },
    }));
    const { POST } = await import("./route");
    const res = await POST(req("Bearer topsecret"));
    vi.doUnmock("@/lib/supabase/service");
    vi.doUnmock("resend");
    return { res, updates, sends };
  }

  it("marks a sent row sent, and pins Resend's idempotency key to the row id", async () => {
    const { res, updates, sends } = await drainOne({ data: { id: "msg-1" } });
    expect(res.status).toBe(200);
    expect(sends[0].idempotencyKey).toBe("row-1");
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toMatchObject({ provider_message_id: "msg-1", last_error: null });
    expect(updates[0].patch.sent_at).toEqual(expect.any(String));
  });

  it("a 429 waits without burning an attempt", async () => {
    const { updates } = await drainOne({ error: { statusCode: 429, message: "slow down" } });
    expect(updates[0].patch).not.toHaveProperty("attempts");
    expect(updates[0].patch).not.toHaveProperty("sent_at");
    expect(Date.parse(updates[0].patch.next_attempt_at as string)).toBeGreaterThan(Date.now() + 29 * 60_000);
  });

  it("a 5xx retries with backoff and counts the attempt", async () => {
    const { updates } = await drainOne({ error: { statusCode: 503, message: "unavailable" } });
    expect(updates[0].patch.attempts).toBe(3);
    expect(updates[0].patch).not.toHaveProperty("sent_at");
    expect(Date.parse(updates[0].patch.next_attempt_at as string)).toBeGreaterThan(Date.now());
  });

  it("a network error is transient, not a lost message", async () => {
    const { updates } = await drainOne(new Error("ECONNRESET"));
    expect(updates[0].patch.attempts).toBe(3);
    expect(String(updates[0].patch.last_error)).toMatch(/network/);
  });

  it("a 4xx is buried at max attempts so it stops retrying but stays visible", async () => {
    const { updates } = await drainOne({ error: { statusCode: 422, message: "invalid to" } });
    expect(updates[0].patch.attempts).toBe(8);
    expect(updates[0].patch).not.toHaveProperty("sent_at");
    expect(String(updates[0].patch.last_error)).toMatch(/422/);
  });
});
