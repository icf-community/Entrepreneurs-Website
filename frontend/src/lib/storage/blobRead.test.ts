import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getKey, sign } = vi.hoisted(() => ({ getKey: vi.fn(), sign: vi.fn() }));
vi.mock("@azure/identity", () => ({ ClientSecretCredential: class {} }));
vi.mock("@azure/storage-blob", () => ({
  BlobServiceClient: class { getUserDelegationKey = getKey; },
  BlobSASPermissions: { parse: (value: string) => value },
  SASProtocol: { Https: "https" },
  generateBlobSASQueryParameters: sign,
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  for (const name of ["AZURE_STORAGE_ACCOUNT", "AZURE_BLOB_CONTAINER", "AZURE_AVATAR_CONTAINER",
    "AZURE_CV_CONTAINER", "AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET"]) {
    vi.stubEnv(name, "local-test");
  }
  sign.mockReturnValue({ toString: () => "test-signature" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Azure delegation key under concurrent renders", () => {
  it("coalesces cold requests across image and CV signing, then refreshes once", async () => {
    vi.useFakeTimers();
    let resolve!: (key: object) => void;
    getKey.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { signedImageUrls, signedCvUrl } = await import("./blobRead");
    const burst = Array.from({ length: 100 }, (_, i) => signedImageUrls([`avatar-${i}`], "profile_picture"));
    const cv = signedCvUrl("cv");
    expect(getKey).toHaveBeenCalledTimes(1);
    resolve({});
    expect((await Promise.all(burst)).every(([url]) => url?.includes("test-signature"))).toBe(true);
    expect(await cv).toContain("test-signature");
    await signedImageUrls(["warm"]);
    expect(getKey).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(12 * 3600 * 1000 + 1);
    const refresh = [signedCvUrl("cv"), signedImageUrls(["expired"])];
    expect(getKey).toHaveBeenCalledTimes(2);
    resolve({});
    await Promise.all(refresh);
  });

  it("fails to placeholders and retries after a failed shared refresh", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getKey.mockRejectedValueOnce(new Error("Azure unavailable")).mockResolvedValue({});
    const { signedImageUrls, signedCvUrl } = await import("./blobRead");
    const failed = await Promise.all([signedImageUrls(["a", "b"]), signedCvUrl("cv")]);
    expect(failed).toEqual([[null, null], null]);
    expect(getKey).toHaveBeenCalledTimes(1);
    expect(await signedCvUrl("recovered")).toContain("test-signature");
    expect(getKey).toHaveBeenCalledTimes(2);
  });
});
