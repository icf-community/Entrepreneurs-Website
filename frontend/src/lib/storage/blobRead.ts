import "server-only";
import * as Sentry from "@sentry/nextjs";
import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  generateBlobSASQueryParameters,
  type UserDelegationKey,
} from "@azure/storage-blob";
import { ClientSecretCredential } from "@azure/identity";

// ════════════════════════════════════════════════════════════════════
// Foundry · Reading blobs out of Azure — post images, avatars, and CVs
//
// All three containers are PRIVATE, and that is a compliance decision
// rather than a preference. If any were public-read, every URL would be a
// permanent unauthenticated link: the members-only feed would leak to
// anyone who ever saw a URL, and a deleted post's image (or a removed
// avatar, or a replaced CV) would stay fetchable forever — so "we deleted
// it" would not be true in the way an erasure request requires.
//
// So reads go through short-expiry user-delegation SAS, minted here at
// render time and never stored. A stored SAS URL would be stale within
// the hour anyway, which is why the referencing columns (post_images,
// profiles.avatar_path, profiles.cv_path) hold a container-relative key
// and nothing else.
//
// CREDENTIAL SEPARATION. This process holds a service principal scoped to
// `Storage Blob Data Reader` on each of the three containers, plus
// `Storage Blob Delegator` (account-scoped — see infra/azure/provision.sh
// for why that role in particular is account- not container-level). It
// cannot write and it cannot delete — only the gateway can, using the
// VM's managed identity. Neither holds the storage account key, which
// Azure cannot scope to a container at all. Shared-key access is disabled
// on the account, so a leaked connection string is not a thing that can
// exist here.
//
// Minting is local: one cached network call for the delegation key, then
// pure HMAC per URL. A feed page with 40 images costs 40 signatures and
// zero requests to Azure.
//
// AUTHORISATION IS NOT THIS FILE'S JOB. Every function here mints a URL
// for whatever key it is given — it has no idea who is asking or whether
// they are allowed to see it. That check happens one layer up, in the
// caller: post images are already gated by profiles_select_directory-style
// membership checks on the feed query, and a CV read must be gated by
// "is this the owner, or an admin" in the server action that calls
// signedCvUrl, using get_my_cv_info() / admin_get_cv_info() (both
// SECURITY DEFINER, both already caller-scoped) to prove it before this
// file is ever reached.
// ════════════════════════════════════════════════════════════════════

const SAS_TTL_MINUTES = 60;
// CVs are more sensitive than a feed image — a shorter window bounds how
// long a copied/leaked link stays live, at the cost of a member needing to
// re-open the page for a fresh one if they sit on a download link a while.
const CV_SAS_TTL_MINUTES = 5;

// The delegation key is valid for up to 7 days. Holding one for a day and
// refreshing at the 12-hour mark means the fetch essentially never lands
// on a user request, and a clock skew or a slow refresh cannot produce a
// key that is already expired.
const KEY_TTL_HOURS = 24;
const KEY_REFRESH_AFTER_HOURS = 12;

export type BlobPurpose = "post_image" | "profile_picture" | "cv";

type Config = {
  account: string;
  containers: Record<BlobPurpose, string>;
  tenantId: string;
  clientId: string;
  clientSecret: string;
};

function config(): Config | null {
  const account = process.env.AZURE_STORAGE_ACCOUNT;
  const postImages = process.env.AZURE_BLOB_CONTAINER;
  const avatars = process.env.AZURE_AVATAR_CONTAINER;
  const cvs = process.env.AZURE_CV_CONTAINER;
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  if (!account || !postImages || !avatars || !cvs || !tenantId || !clientId || !clientSecret) {
    return null;
  }
  return {
    account,
    containers: { post_image: postImages, profile_picture: avatars, cv: cvs },
    tenantId,
    clientId,
    clientSecret,
  };
}

/** True when blob reads are configured. Unset in CI, where the feed still
 *  works and image slots render a placeholder. Local dev is NOT unset —
 *  .env.development.local carries real credentials for the same Azure
 *  storage account production uses (there's no local storage sandbox), so
 *  a local run mints real SAS URLs against real blobs. */
export function blobReadEnabled(): boolean {
  return config() !== null;
}

let clientCache: BlobServiceClient | null = null;

function serviceClient(cfg: Config): BlobServiceClient {
  if (!clientCache) {
    const credential = new ClientSecretCredential(cfg.tenantId, cfg.clientId, cfg.clientSecret);
    clientCache = new BlobServiceClient(`https://${cfg.account}.blob.core.windows.net`, credential);
  }
  return clientCache;
}

let keyCache: { key: UserDelegationKey; refreshAfter: number } | null = null;
let keyInFlight: Promise<UserDelegationKey> | null = null;

async function delegationKey(cfg: Config): Promise<UserDelegationKey> {
  const now = Date.now();
  if (keyCache && now < keyCache.refreshAfter) return keyCache.key;

  // A launch burst can have many renders in one warm process. Share the
  // refresh, not just its result, so a cold/expired cache makes one Azure
  // request per process. Rejections must clear this slot so later requests
  // can recover. Separate serverless processes still fetch their own key.
  keyInFlight ??= fetchDelegationKey(cfg, now).finally(() => {
    keyInFlight = null;
  });
  return keyInFlight;
}

async function fetchDelegationKey(cfg: Config, now: number): Promise<UserDelegationKey> {
  const startsOn = new Date(now - 5 * 60 * 1000); // clock-skew allowance
  const expiresOn = new Date(now + KEY_TTL_HOURS * 3600 * 1000);
  // Unbounded otherwise: a hung Azure network path would hang whichever
  // server action/page render triggered this refresh until the platform's
  // own function timeout killed it with an opaque error.
  const key = await serviceClient(cfg).getUserDelegationKey(startsOn, expiresOn, {
    abortSignal: AbortSignal.timeout(10_000),
  });

  keyCache = { key, refreshAfter: now + KEY_REFRESH_AFTER_HOURS * 3600 * 1000 };
  return key;
}

/**
 * Read URLs for a batch of blob keys, in the same order.
 *
 * Batched rather than per-key so one page render fetches the delegation
 * key at most once. Returns null in a slot the URL could not be minted
 * for — a broken image is a bad card, not a broken page, and the feed
 * must render even when storage is unreachable.
 *
 * `purpose` defaults to post_image — every existing caller (the community
 * feed) reads that container, and stays unchanged.
 */
export async function signedImageUrls(
  keys: string[],
  purpose: BlobPurpose = "post_image",
): Promise<(string | null)[]> {
  if (keys.length === 0) return [];

  const cfg = config();
  if (!cfg) return keys.map(() => null);

  let key: UserDelegationKey;
  try {
    key = await delegationKey(cfg);
  } catch (e) {
    // Logged, not thrown. Storage being unreachable degrades the feed to
    // text; it does not take the page down.
    console.error("Failed to obtain an Azure user delegation key:", e);
    Sentry.captureException(e, { tags: { surface: "blob-read", op: "delegationKey" } });
    return keys.map(() => null);
  }

  const container = cfg.containers[purpose];
  const startsOn = new Date(Date.now() - 5 * 60 * 1000);
  const expiresOn = new Date(Date.now() + SAS_TTL_MINUTES * 60 * 1000);

  return keys.map((blobKey) => {
    try {
      const sas = generateBlobSASQueryParameters(
        {
          containerName: container,
          blobName: blobKey,
          permissions: BlobSASPermissions.parse("r"), // read, and only read
          protocol: SASProtocol.Https,
          startsOn,
          expiresOn,
        },
        key,
        cfg.account,
      ).toString();

      return `https://${cfg.account}.blob.core.windows.net/${container}/${blobKey}?${sas}`;
    } catch (e) {
      console.error("Failed to sign a read URL for:", blobKey, e);
      Sentry.captureException(e, { tags: { surface: "blob-read", op: "signedImageUrls" } });
      return null;
    }
  });
}

/**
 * A single CV read URL, or null if it could not be minted.
 *
 * Shorter-lived than an image URL (see CV_SAS_TTL_MINUTES) and always
 * `attachment` at the gateway's write time — see server/app/main.py's
 * upload_document — so the link this signs downloads rather than renders
 * inline from the storage-account origin.
 *
 * Callers MUST have already established the caller may see this path —
 * this function performs no authorisation of its own. See the module
 * docstring.
 */
export async function signedCvUrl(blobKey: string): Promise<string | null> {
  const cfg = config();
  if (!cfg) return null;

  let key: UserDelegationKey;
  try {
    key = await delegationKey(cfg);
  } catch (e) {
    console.error("Failed to obtain an Azure user delegation key:", e);
    Sentry.captureException(e, { tags: { surface: "blob-read", op: "delegationKey" } });
    return null;
  }

  const container = cfg.containers.cv;
  const startsOn = new Date(Date.now() - 5 * 60 * 1000);
  const expiresOn = new Date(Date.now() + CV_SAS_TTL_MINUTES * 60 * 1000);

  try {
    const sas = generateBlobSASQueryParameters(
      {
        containerName: container,
        blobName: blobKey,
        permissions: BlobSASPermissions.parse("r"),
        protocol: SASProtocol.Https,
        startsOn,
        expiresOn,
      },
      key,
      cfg.account,
    ).toString();

    return `https://${cfg.account}.blob.core.windows.net/${container}/${blobKey}?${sas}`;
  } catch (e) {
    console.error("Failed to sign a read URL for:", blobKey, e);
    Sentry.captureException(e, { tags: { surface: "blob-read", op: "signedCvUrl" } });
    return null;
  }
}

/**
 * Download a CV's raw bytes for server-side text extraction (the
 * deterministic skill pre-fill — see lib/cv/extractText.ts). This process
 * already holds `Storage Blob Data Reader` on the CV container, so no new
 * credential is needed. Returns null when storage is unconfigured or the
 * blob can't be read; callers degrade to "no suggestions", never an error.
 */
export async function downloadCvBytes(blobKey: string): Promise<Buffer | null> {
  const cfg = config();
  if (!cfg) return null;

  try {
    const container = serviceClient(cfg).getContainerClient(cfg.containers.cv);
    return await container.getBlockBlobClient(blobKey).downloadToBuffer(undefined, undefined, {
      abortSignal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.error("Failed to download CV blob:", blobKey, e);
    Sentry.captureException(e, { tags: { surface: "blob-read", op: "downloadCvBytes" } });
    return null;
  }
}

/**
 * Confirm blobs actually exist before a post/avatar/CV is allowed to
 * reference them.
 *
 * The database knows a ticket was ISSUED; it cannot know whether bytes
 * were ever written. Without this check a client could submit a key it
 * never uploaded to and create a post — or confirm an avatar/CV — with a
 * permanently broken reference. This process already holds read access,
 * so the check is cheap and needs no new credential — and it deliberately
 * does not give the gateway a database connection to solve the same
 * problem.
 */
export async function blobsExist(
  keys: string[],
  purpose: BlobPurpose = "post_image",
): Promise<boolean> {
  if (keys.length === 0) return true;

  const cfg = config();
  // Unconfigured means local dev or CI, where uploads cannot have happened
  // at all. Refusing here would block the composer in exactly the
  // environments used to test it.
  if (!cfg) return true;

  try {
    const container = serviceClient(cfg).getContainerClient(cfg.containers[purpose]);
    const results = await Promise.all(
      keys.map((k) => container.getBlockBlobClient(k).exists({ abortSignal: AbortSignal.timeout(10_000) })),
    );
    return results.every(Boolean);
  } catch (e) {
    console.error("Failed to verify uploaded blobs:", e);
    Sentry.captureException(e, { tags: { surface: "blob-read", op: "blobsExist" } });
    return false;
  }
}

/** The origin the CSP must allow in `img-src`. Null when unconfigured.
 *  Container-agnostic: all three containers live on the same storage
 *  account, so one origin covers post images, avatars, and (for the rare
 *  case a CV URL is ever rendered rather than navigated to) CVs alike. */
export function blobOrigin(): string | null {
  const account = process.env.AZURE_STORAGE_ACCOUNT;
  return account ? `https://${account}.blob.core.windows.net` : null;
}
