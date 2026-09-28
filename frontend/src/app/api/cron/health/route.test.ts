import { afterEach, describe, it, expect, vi } from "vitest";
import type { NextRequest } from "next/server";

// G3/G4: the heartbeat is only worth anything if a stranger can't fake it,
// and the reports are only affordable if the snapshot's throttle is obeyed.

const sentry = vi.hoisted(() => ({
  withMonitor: vi.fn((_slug: string, cb: () => unknown) => cb()),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn(async () => true),
}));
vi.mock("@sentry/nextjs", () => sentry);

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ rpc }) }));

async function load() {
  vi.resetModules();
  return import("./route");
}

function req(auth?: string): NextRequest {
  return new Request("http://localhost/api/cron/health", {
    headers: auth ? { authorization: auth } : {},
  }) as unknown as NextRequest;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("health cron", () => {
  it("403s on a wrong token and never checks in", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    const { POST } = await load();
    expect((await POST(req("Bearer wrong"))).status).toBe(403);
    expect(sentry.withMonitor).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("500s when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const { GET } = await load();
    expect((await GET(req("Bearer x"))).status).toBe(500);
  });

  it("checks in and reports only the failing checks the snapshot says to report", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    rpc.mockResolvedValue({
      data: [
        { check: "email_backlog", ok: true, report: false, detail: "empty", failing_since: null },
        { check: "config_missing", ok: false, report: true, detail: ["health_url"], failing_since: "t" },
        { check: "worker_backlog", ok: false, report: false, detail: "01:00:00", failing_since: "t" },
      ],
      error: null,
    });
    const { POST } = await load();
    const res = await POST(req("Bearer topsecret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, failing: ["config_missing", "worker_backlog"] });
    expect(sentry.withMonitor).toHaveBeenCalledWith("app-health", expect.any(Function), expect.objectContaining({
      schedule: { type: "crontab", value: "*/10 * * * *" },
    }));
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentry.captureMessage).toHaveBeenCalledWith("health: config_missing", expect.objectContaining({
      fingerprint: ["app-health", "config_missing"],
    }));
    expect(sentry.flush).toHaveBeenCalled();
  });

  it("a failed snapshot fails the check-in and returns 500", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST301" } });
    const { POST } = await load();
    const res = await POST(req("Bearer topsecret"));
    expect(res.status).toBe(500);
    expect(sentry.captureException).toHaveBeenCalled();
  });
});
