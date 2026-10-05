import { describe, it, expect, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock("@/lib/cache", () => ({ cached: (_k: string, load: () => unknown) => load() }));

import { profileIntakeData, opportunityTaxonomy } from "./taxonomy";
import { adminReportsPage } from "./posts";
import { adminConnectionReportsPage, adminFlaggedSenders } from "./adminConnections";
import type { Db } from "./query";

// D3: reads where "nothing" would be believed and acted on. A 4xx (a code
// bug such as a missing grant; an outage already throws) used to degrade to
// [] everywhere. For these it now throws to the segment's error page.

/** Every query answers permission denied, the shape of a missing grant. */
function deniedDb(): Db {
  const denied = { data: null, error: { code: "42501", message: "permission denied", details: "", hint: "" }, status: 403, statusText: "Forbidden" };
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "in", "range", "limit"]) builder[m] = () => builder;
  builder.then = (resolve: (v: unknown) => unknown) => resolve(denied);
  return { from: () => builder, rpc: () => builder } as unknown as Db;
}

describe("reads that prefill a form whose save replaces the rows", () => {
  it("profile intake data throws instead of looking empty", async () => {
    await expect(profileIntakeData(deniedDb(), "u1")).rejects.toThrow(/profile_skills|profile_sectors|profile_interests|profile_intents/);
  });
  it("an opportunity's tags throw instead of looking untagged", async () => {
    await expect(opportunityTaxonomy(deniedDb(), "o1")).rejects.toThrow(/opportunity_/);
  });
});

describe("moderation queues", () => {
  it("post reports throw instead of 'nothing reported'", async () => {
    await expect(adminReportsPage(deniedDb(), { status: "open", page: 1 })).rejects.toThrow();
  });
  it("connection reports throw", async () => {
    await expect(adminConnectionReportsPage(deniedDb(), { status: "open", page: 1 })).rejects.toThrow();
  });
  it("flagged senders throw", async () => {
    await expect(adminFlaggedSenders(deniedDb())).rejects.toThrow();
  });
});
