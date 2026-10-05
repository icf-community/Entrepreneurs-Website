import { afterEach, describe, it, expect, vi } from "vitest";
import type { NextRequest } from "next/server";

// D3: the weekly nudge had no tests. Its contract: bearer auth before any
// DB work; enqueue THEN mark (so a failed enqueue re-nudges next week rather
// than silently dropping the member); a failed mark still answers 200,
// because the mail is already in the outbox.

function req(auth?: string): NextRequest {
  const headers: Record<string, string> = auth ? { authorization: auth } : {};
  return new Request("http://localhost/api/cron/github-showcase-nudge", { headers }) as unknown as NextRequest;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/supabase/service");
  vi.doUnmock("@/lib/email");
  vi.restoreAllMocks();
});

async function run(opts: { auth?: string; due?: unknown[]; dueError?: boolean; markError?: boolean; enqueueThrows?: boolean }) {
  vi.stubEnv("CRON_SECRET", "topsecret");
  vi.resetModules();
  const calls: string[] = [];
  const rpc = vi.fn(async (name: string) => {
    calls.push(`rpc:${name}`);
    if (name === "due_github_showcase_nudges") {
      return opts.dueError ? { data: null, error: { message: "boom" } } : { data: opts.due ?? [], error: null };
    }
    return { data: null, error: opts.markError ? { message: "mark failed" } : null };
  });
  vi.doMock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ rpc }) }));
  vi.doMock("@/lib/email", () => ({
    renderShowcaseNudgeEmail: () => ({ subject: "s", text: "t", html: "h" }),
    enqueueEmailsBulk: async (emails: unknown[]) => {
      calls.push(`enqueue:${emails.length}`);
      if (opts.enqueueThrows) throw new Error("outbox down");
    },
  }));
  const { POST } = await import("./route");
  const res = await POST(req(opts.auth ?? "Bearer topsecret")).catch((e: Error) => e);
  return { res, calls, rpc };
}

const due = [
  { member_id: "m1", email: "a@x.com", first_name: "A", new_repos: ["r1"] },
  { member_id: "m2", email: "b@x.com", first_name: "B", new_repos: ["r2"] },
];

describe("github-showcase-nudge", () => {
  it("403s on a wrong bearer token and never touches the DB", async () => {
    const { res, rpc } = await run({ auth: "Bearer wrong" });
    expect((res as Response).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("enqueues, then marks", async () => {
    const { res, calls } = await run({ due });
    expect((res as Response).status).toBe(200);
    expect(calls).toEqual(["rpc:due_github_showcase_nudges", "enqueue:2", "rpc:mark_github_showcase_nudged"]);
  });

  it("does not mark anyone when the enqueue fails", async () => {
    const { calls } = await run({ due, enqueueThrows: true });
    expect(calls).not.toContain("rpc:mark_github_showcase_nudged");
  });

  it("still answers 200 when marking fails, since the mail is already queued", async () => {
    const { res } = await run({ due, markError: true });
    expect((res as Response).status).toBe(200);
  });

  it("500s when the due lookup fails", async () => {
    const { res, calls } = await run({ dueError: true });
    expect((res as Response).status).toBe(500);
    expect(calls).not.toContain("enqueue:2");
  });
});
