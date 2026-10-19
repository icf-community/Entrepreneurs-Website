import { afterEach, describe, it, expect, vi } from "vitest";

// S4 gap 14: input attacks. submitTurn/editSpec must refuse an oversized
// or malformed body before ever calling the RPC — the rpc mock below
// throws if reached, so a pass here proves the shape check runs first.

function setup() {
  vi.doMock("@/lib/auth/actionAuth", () => ({
    getActionAuth: async () => ({
      supabase: { rpc: () => { throw new Error("must not reach the RPC"); } },
      user: { id: "u1" },
      isAdmin: false,
      status: "approved",
      unreachable: false,
    }),
  }));
  vi.doMock("@/lib/ratelimit", () => ({ check: async () => "ok" }));
}

async function load() {
  vi.resetModules();
  setup();
  return import("./actions");
}

afterEach(() => {
  vi.doUnmock("@/lib/auth/actionAuth");
  vi.doUnmock("@/lib/ratelimit");
});

describe("submitTurn input validation", () => {
  it("refuses a message over 600 characters before calling the RPC", async () => {
    const { submitTurn } = await load();
    const result = await submitTurn({
      mode: "network", conversationId: null, opportunityId: null, kind: "message",
      message: "x".repeat(601), idempotencyKey: "a".repeat(10), expectedRevision: null, temporary: false,
    });
    expect(result.ok).toBe(false);
  });

  it("refuses an unknown mode", async () => {
    const { submitTurn } = await load();
    const result = await submitTurn({
      // @ts-expect-error — deliberately invalid at the boundary
      mode: "admin", conversationId: null, opportunityId: null, kind: "message",
      message: "python", idempotencyKey: "a".repeat(10), expectedRevision: null, temporary: false,
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a malformed idempotency key", async () => {
    const { submitTurn } = await load();
    const result = await submitTurn({
      mode: "network", conversationId: null, opportunityId: null, kind: "message",
      message: "python", idempotencyKey: "short", expectedRevision: null, temporary: false,
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a non-UUID conversation id", async () => {
    const { submitTurn } = await load();
    const result = await submitTurn({
      mode: "network", conversationId: "not-a-uuid", opportunityId: null, kind: "message",
      message: "python", idempotencyKey: "a".repeat(10), expectedRevision: null, temporary: false,
    });
    expect(result.ok).toBe(false);
  });

  it("refuses an unknown kind", async () => {
    const { submitTurn } = await load();
    const result = await submitTurn({
      mode: "network", conversationId: null, opportunityId: null,
      // @ts-expect-error — deliberately invalid at the boundary
      kind: "teleport", message: "python", idempotencyKey: "a".repeat(10), expectedRevision: null, temporary: false,
    });
    expect(result.ok).toBe(false);
  });
});

describe("editSpec input validation", () => {
  it("refuses an empty ops array before calling the RPC", async () => {
    const { editSpec } = await load();
    const result = await editSpec("12345678-1234-1234-1234-123456789012", 0, []);
    expect(result.ok).toBe(false);
  });

  it("refuses more than 16 ops in one call", async () => {
    const { editSpec } = await load();
    const ops = Array.from({ length: 17 }, () => ({ op: "undo" as const }));
    const result = await editSpec("12345678-1234-1234-1234-123456789012", 0, ops);
    expect(result.ok).toBe(false);
  });

  it("refuses a non-UUID conversation id", async () => {
    const { editSpec } = await load();
    const result = await editSpec("not-a-uuid", 0, [{ op: "undo" }]);
    expect(result.ok).toBe(false);
  });
});
