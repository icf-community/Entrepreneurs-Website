import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Sentry from "@sentry/nextjs";
import type { PostgrestError, PostgrestSingleResponse } from "@supabase/supabase-js";
import { rows, maybeRow } from "./query";
import { MAX_ROWS } from "@/lib/supabase/rowCap";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

const boom = { message: "boom", details: "", hint: "", code: "XX000" } as PostgrestError;
const many = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));

describe("rows", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(Sentry.captureMessage).mockClear();
    vi.mocked(Sentry.captureException).mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns the rows on success", async () => {
    const out = await rows("q", async () => ({ data: [{ a: 1 }], error: null }));
    expect(out).toEqual([{ a: 1 }]);
  });

  it("treats a null payload as an empty list, not a crash", async () => {
    expect(await rows("q", async () => ({ data: null, error: null }))).toEqual([]);
  });

  it("degrades to [] on error and names the query in the log", async () => {
    const out = await rows("list_approved_events", async () => ({ data: null, error: boom }));
    expect(out).toEqual([]);
    expect(console.error).toHaveBeenCalledWith("Failed to load list_approved_events:", boom);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      boom,
      { tags: { surface: "data-read", source: "list_approved_events" } },
    );
  });

  // The reason this wrapper exists at all. reportIfCapped used to be a line
  // each call site had to remember, and six of them had forgotten it.
  it("reports the row cap without the caller asking", async () => {
    await rows("list_approved_events", async () => ({ data: many(MAX_ROWS), error: null }));
    expect(Sentry.captureMessage).toHaveBeenCalledOnce();
    expect(vi.mocked(Sentry.captureMessage).mock.calls[0]![0]).toMatch(/1000-row cap/);
  });

  it("stays quiet below the cap", async () => {
    await rows("q", async () => ({ data: many(MAX_ROWS - 1), error: null }));
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
});

describe("maybeRow", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(Sentry.captureException).mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns the row on success", async () => {
    expect(await maybeRow("q", async () => ({ data: { a: 1 }, error: null }))).toEqual({ a: 1 });
  });

  it("returns null on error, having logged it", async () => {
    expect(await maybeRow("profiles", async () => ({ data: null, error: boom }))).toBeNull();
    expect(console.error).toHaveBeenCalledWith("Failed to load profiles:", boom);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      boom,
      { tags: { surface: "data-read", source: "profiles" } },
    );
  });

  // This one is really a typecheck, and it is here because the tests above
  // could not catch what broke: they pass plain object literals, which
  // infer fine. A real .single() resolves to PostgrestSingleResponse, a
  // union of a success and a failure branch — and the first version of
  // maybeRow named its payload as `data: T | null`, so T had both branches
  // to choose from, settled on `never`, and every field access on the
  // result became an error. tsc fails on `row.first_name` below if the
  // signature ever goes back to inferring from the payload.
  it("infers the row type through a real PostgrestSingleResponse", async () => {
    const response: PostgrestSingleResponse<{ first_name: string }> = {
      data: { first_name: "Ada" },
      error: null,
      success: true,
      count: null,
      status: 200,
      statusText: "OK",
    };
    const row = await maybeRow("profiles", async () => response);
    expect(row?.first_name).toBe("Ada");
  });
});

// S2: an unreachable Supabase must reach the error page, not render as an
// empty list or a 404. A 4xx (a code bug in one section) still degrades.
describe("infrastructure failures throw instead of degrading", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(Sentry.captureException).mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["network failure", 0],
    ["statement timeout", 500],
    ["pool-acquire timeout", 504],
    ["gateway unavailable", 503],
    ["rate limited", 429],
  ])("rows() throws ServiceUnavailableError on %s (status %i)", async (_, status) => {
    await expect(rows("list_directory", async () => ({ data: null, error: boom, status })))
      .rejects.toMatchObject({ name: "ServiceUnavailableError" });
  });

  it("maybeRow() throws on an unreachable database, so a detail page cannot 404", async () => {
    await expect(maybeRow("get_event", async () => ({ data: null, error: boom, status: 0 })))
      .rejects.toMatchObject({ name: "ServiceUnavailableError" });
  });

  it.each([400, 401, 403, 404, 406])("a %i still degrades quietly and is reported", async (status) => {
    expect(await rows("q", async () => ({ data: null, error: boom, status }))).toEqual([]);
    expect(await maybeRow("q", async () => ({ data: null, error: boom, status }))).toBeNull();
    expect(Sentry.captureException).toHaveBeenCalledTimes(2);
  });

  it("a status on a SUCCESSFUL response is never treated as a failure", async () => {
    expect(await rows("q", async () => ({ data: [{ a: 1 }], error: null, status: 200 }))).toEqual([{ a: 1 }]);
  });
});
