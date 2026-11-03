import { afterEach, describe, it, expect, vi } from "vitest";

// Lives beside the dynamic [purpose]/[key] segment because vitest's
// include globs treat brackets as character classes, so a test file
// under those folders is never discovered.

const signed = vi.fn(async (keys: string[]) => keys.map(() => "https://blob.example/x?sig=1"));
const currentUser = vi.fn();
const rpc = vi.fn();

async function load() {
  vi.resetModules();
  vi.doMock("@/lib/storage/blobRead", () => ({ signedImageUrls: signed }));
  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () => ({ rpc }),
  }));
  vi.doMock("@/lib/auth/currentUser", () => ({ currentUser }));
  return import("./[purpose]/[key]/route");
}

const call = async (purpose: string, key: string) => {
  const { GET } = await load();
  return GET({} as never, { params: Promise.resolve({ purpose, key }) });
};

afterEach(() => {
  signed.mockClear();
  currentUser.mockReset();
  rpc.mockReset();
  vi.doUnmock("@/lib/storage/blobRead");
  vi.doUnmock("@/lib/supabase/server");
  vi.doUnmock("@/lib/auth/currentUser");
});

const GOOD = "0f8b7c1e-2a3d-4e5f-8a9b-0c1d2e3f4a5b.webp";

describe("GET /api/img/[purpose]/[key]", () => {
  it("401s when there is no session", async () => {
    currentUser.mockResolvedValue({ user: null, error: null });
    const res = await call("profile_picture", GOOD);
    expect(res.status).toBe(401);
    expect(signed).not.toHaveBeenCalled();
  });

  it("403s when the session is not approved", async () => {
    currentUser.mockResolvedValue({ user: { id: "u" }, error: null });
    rpc.mockResolvedValue({ data: false, error: null });
    const res = await call("profile_picture", GOOD);
    expect(res.status).toBe(403);
    expect(rpc).toHaveBeenCalledWith("is_approved");
    expect(signed).not.toHaveBeenCalled();
  });

  it("redirects a well-formed profile picture key for an approved member", async () => {
    currentUser.mockResolvedValue({ user: { id: "u" }, error: null });
    rpc.mockResolvedValue({ data: true, error: null });
    const res = await call("profile_picture", GOOD);
    expect(res.status).toBe(302);
    expect(signed).toHaveBeenCalledWith([GOOD], "profile_picture");
  });

  it.each([
    "../../other-container/secret.webp",
    "a/b.webp",
    "0f8b7c1e-2a3d-4e5f-8a9b-0c1d2e3f4a5b.cv",
    "0F8B7C1E-2A3D-4E5F-8A9B-0C1D2E3F4A5B.webp",
    "not-a-key",
    "",
    `${GOOD}x`,
  ])("404s a malformed key without signing anything (%s)", async (key) => {
    currentUser.mockResolvedValue({ user: { id: "u" }, error: null });
    rpc.mockResolvedValue({ data: true, error: null });
    const res = await call("profile_picture", key);
    expect(res.status).toBe(404);
    expect(signed).not.toHaveBeenCalled();
  });

  it("404s a purpose other than profile_picture", async () => {
    currentUser.mockResolvedValue({ user: { id: "u" }, error: null });
    rpc.mockResolvedValue({ data: true, error: null });
    const res = await call("cv", GOOD);
    expect(res.status).toBe(404);
    expect(signed).not.toHaveBeenCalled();
  });
});
