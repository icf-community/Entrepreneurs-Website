import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The callback is the half of the GitHub connect flow that stores a token and queues scan jobs. Its state
// check only ties the request to a cookie the browser held, so the approval gate (same as ../start) is what
// keeps a pending or rejected member out. These run with a perfectly valid state cookie.

const auth = vi.fn();
const rpc = vi.fn();
const cookieValues: Record<string, string> = {};

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name in cookieValues ? { value: cookieValues[name] } : undefined),
    delete: vi.fn(),
  }),
}));
vi.mock("@/lib/auth/actionAuth", () => ({ getActionAuth: () => auth() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ rpc }) }));
vi.mock("@/lib/siteUrl", () => ({ emailBaseUrl: () => "http://localhost" }));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("GITHUB_OAUTH_CLIENT_ID", "id");
  vi.stubEnv("GITHUB_OAUTH_CLIENT_SECRET", "secret");
  vi.stubEnv("GITHUB_TOKEN_ENCRYPTION_KEY", "key");
  vi.stubGlobal("fetch", fetchMock);
  Object.assign(cookieValues, { github_oauth_state: "abc123" });
  rpc.mockResolvedValue({ error: null });
  fetchMock.mockImplementation(async (url: string) =>
    url.includes("oauth/access_token")
      ? new Response(JSON.stringify({ access_token: "tok" }), { status: 200 })
      : new Response(JSON.stringify({ id: 7, login: "octo" }), { status: 200 }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  for (const k of Object.keys(cookieValues)) delete cookieValues[k];
});

async function callback() {
  const { GET } = await import("./route");
  return GET(new Request("http://localhost/auth/github-connect/callback?code=c&state=abc123"));
}

const member = (status: string, isAdmin = false) => ({
  user: { id: "u1" }, isAdmin, status, unreachable: false, supabase: {},
});

describe("github-connect callback gates", () => {
  it.each(["pending_review", "rejected"])("refuses a %s member before any token exchange or write", async (status) => {
    auth.mockResolvedValue(member(status));
    const res = await callback();
    expect(res.headers.get("location")).toContain("github=error");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("connects an approved member", async () => {
    auth.mockResolvedValue(member("approved"));
    const res = await callback();
    expect(res.headers.get("location")).toContain("github=connected");
    expect(rpc).toHaveBeenCalledWith("confirm_github_connected", expect.objectContaining({ p_member_id: "u1" }));
  });

  it("lets an admin through regardless of their own member status", async () => {
    auth.mockResolvedValue(member("pending_review", true));
    const res = await callback();
    expect(res.headers.get("location")).toContain("github=connected");
  });

  it("sends a signed-out visitor to /login and treats an outage as an error, not a sign-out", async () => {
    auth.mockResolvedValue({ user: null, isAdmin: false, status: null, unreachable: false, supabase: {} });
    expect((await callback()).headers.get("location")).toContain("/login");
    auth.mockResolvedValue({ user: null, isAdmin: false, status: null, unreachable: true, supabase: {} });
    expect((await callback()).headers.get("location")).toContain("github=error");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still refuses a mismatched state, whatever the member's status", async () => {
    auth.mockResolvedValue(member("approved"));
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/auth/github-connect/callback?code=c&state=other"));
    expect(res.headers.get("location")).toContain("github=error");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
