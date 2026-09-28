import { afterEach, describe, it, expect, vi } from "vitest";

// B2: this route has no caller-identity check by design (/committee shows
// avatars to signed-out visitors), so the key is the only input it trusts.
// Only the shape the upload pipeline actually generates — uuid4 + ".webp",
// the same rule as the gateway's is_valid_key — may reach the SAS signer.

const signed = vi.fn(async (keys: string[]) => keys.map(() => "https://blob.example/x?sig=1"));

async function load() {
  vi.resetModules();
  vi.doMock("@/lib/storage/blobRead", () => ({ signedImageUrls: signed }));
  return import("./route");
}

const call = async (purpose: string, key: string) => {
  const { GET } = await load();
  return GET({} as never, { params: Promise.resolve({ purpose, key }) });
};

afterEach(() => {
  signed.mockClear();
  vi.doUnmock("@/lib/storage/blobRead");
});

const GOOD = "0f8b7c1e-2a3d-4e5f-8a9b-0c1d2e3f4a5b.webp";

describe("GET /api/img/[purpose]/[key]", () => {
  it("redirects a well-formed profile picture key", async () => {
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
    const res = await call("profile_picture", key);
    expect(res.status).toBe(404);
    expect(signed).not.toHaveBeenCalled();
  });

  it("404s a purpose other than profile_picture", async () => {
    const res = await call("cv", GOOD);
    expect(res.status).toBe(404);
    expect(signed).not.toHaveBeenCalled();
  });
});
