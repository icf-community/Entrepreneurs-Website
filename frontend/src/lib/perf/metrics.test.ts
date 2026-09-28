import { afterEach, describe, it, expect, vi } from "vitest";
import { classify, routeTemplate, perfEnabled, withPerf } from "./metrics";

// E1c: local-only read/write measurement. These pin the two promises made
// to the owner: it is off unless PERF_METRICS=1 (and never on in a Vercel
// production deploy), and its labels carry no IDs.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("perfEnabled", () => {
  it("is off by default", () => {
    vi.stubEnv("PERF_METRICS", "");
    expect(perfEnabled()).toBe(false);
  });

  it("is on only with PERF_METRICS=1", () => {
    vi.stubEnv("PERF_METRICS", "1");
    vi.stubEnv("VERCEL_ENV", "");
    expect(perfEnabled()).toBe(true);
  });

  it("stays off in a Vercel deploy even if the flag is set", () => {
    vi.stubEnv("PERF_METRICS", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(perfEnabled()).toBe(false);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(perfEnabled()).toBe(false);
  });
});

describe("classify", () => {
  const base = "http://127.0.0.1:54321";
  it("labels reads, writes and auth by name only", () => {
    expect(classify("GET", `${base}/rest/v1/profiles?select=status&id=eq.0f8b7c1e-2a3d-4e5f-8a9b-0c1d2e3f4a5b`))
      .toEqual({ kind: "read", source: "profiles" });
    expect(classify("POST", `${base}/rest/v1/rpc/list_approved_events`)).toEqual({ kind: "read", source: "rpc/list_approved_events" });
    expect(classify("POST", `${base}/rest/v1/rpc/send_connection_request`)).toEqual({ kind: "write", source: "rpc/send_connection_request" });
    expect(classify("PATCH", `${base}/rest/v1/profiles?id=eq.123`)).toEqual({ kind: "write", source: "profiles" });
    expect(classify("GET", `${base}/auth/v1/user`)).toEqual({ kind: "auth", source: "auth/user" });
  });
});

describe("routeTemplate", () => {
  it("replaces ids with :id so labels never carry one", () => {
    expect(routeTemplate("/opportunities/0f8b7c1e-2a3d-4e5f-8a9b-0c1d2e3f4a5b/edit")).toBe("/opportunities/:id/edit");
    expect(routeTemplate("/members?q=ann")).toBe("/members");
    expect(routeTemplate("/events/12345")).toBe("/events/:id");
    expect(routeTemplate(null)).toBe("unknown");
  });
});

describe("withPerf", () => {
  it("returns the original fetch untouched when disabled", () => {
    vi.stubEnv("PERF_METRICS", "");
    const f = vi.fn() as unknown as typeof fetch;
    expect(withPerf(f, "/members")).toBe(f);
  });
});
