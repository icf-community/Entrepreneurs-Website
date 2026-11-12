import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// ════════════════════════════════════════════════════════════════════
// Foundry · Upload tickets
//
// A short-lived bearer token that lets a browser upload one image or
// document directly to the FastAPI gateway, without the gateway needing a
// database, a Supabase client, or any idea of what a Foundry member is.
//
// The division of labour:
//
//   Next.js   decides WHO may upload (approved member, rate limit,
//             kill switch — the last only for post_image) using guards
//             that already exist, and issues a ticket naming exactly one
//             blob key.
//   Gateway   decides WHAT may be stored (magic bytes, dimensions,
//             re-encode for images; magic bytes, macro/zip-bomb checks for
//             documents) and trusts the ticket for identity.
//
// This keeps every authorisation decision in one place while keeping
// upload bytes off Vercel entirely. It also means the eventual move to
// Clerk does not touch the gateway: the token format is ours, not
// Supabase's, so nothing about it changes when the identity provider
// does.
//
// WHY HAND-ROLLED RATHER THAN A JWT LIBRARY.
// The dangerous half of JWT is verification — algorithm confusion, the
// `none` algorithm, forgetting to pin `algorithms`. None of that lives
// here: this module only SIGNS, and verification happens in Python with
// PyJWT pinned to HS256. Signing is a base64url join and one HMAC, so a
// dependency would add supply-chain surface without removing a risk.
// (verifyTicket below exists only so the unit tests can round-trip.)
// ════════════════════════════════════════════════════════════════════

// Five minutes. Long enough for a slow upload on campus wifi, short
// enough that a ticket captured from a browser is worthless by the time
// anyone could use it.
const TTL_SECONDS = 300;

export type TicketPurpose = "post_image" | "profile_picture" | "cv";

// 8 MB for every purpose today. Images re-encode down to a bounded WebP
// regardless of what arrives, so this bounds what may be *sent*, not what
// is stored; a CV is stored verbatim, so its cap is a real ceiling on the
// original file. Kept as one constant rather than diverging per purpose
// because nginx's client_max_body_size (10m) was sized against this
// single number — raising one purpose's cap without raising the other
// would silently make nginx the more restrictive limit for whichever
// purpose fell behind.
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export type TicketClaims = {
  sub: string;
  purpose: TicketPurpose;
  key: string;
  max_bytes: number;
  exp: number;
  iat: number;
  /** B21: binds the token to uploads; must match server/app/auth.py. */
  aud: typeof TICKET_AUDIENCE;
  iss: typeof TICKET_ISSUER;
};

// Deploy the gateway that accepts these BEFORE a Next.js build that mints
// them: an older gateway rejects any ticket carrying `aud`.
export const TICKET_AUDIENCE = "foundry-gateway-upload";
export const TICKET_ISSUER = "foundry-web";

function secret(): string {
  const value = process.env.UPLOAD_TICKET_SECRET;
  // No `?? "dev-secret"` fallback. A signing key that silently falls back
  // to a literal is a signing key an attacker already has — the rule the
  // rest of the codebase follows for required config.
  if (!value) throw new Error("UPLOAD_TICKET_SECRET is not configured");
  return value;
}

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString("base64url");

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

/**
 * Mint a ticket for one blob key. The key must already exist as an
 * `upload_tickets` row — this function does not create anything, it only
 * attests that the caller may write to a key the database issued.
 */
export function issueTicket(args: {
  userId: string;
  key: string;
  purpose: TicketPurpose;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: TicketClaims = {
    sub: args.userId,
    purpose: args.purpose,
    key: args.key,
    max_bytes: MAX_UPLOAD_BYTES,
    iat: now,
    exp: now + TTL_SECONDS,
    aud: TICKET_AUDIENCE,
    iss: TICKET_ISSUER,
  };

  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const body = `${header}.${payload}`;
  return `${body}.${sign(body)}`;
}

/**
 * Verify and decode a ticket. The gateway is the real verifier; this
 * exists so the unit tests can prove a round trip, an expired ticket, and
 * a tampered ticket all behave.
 */
export function verifyTicket(token: string): TicketClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;

  const expected = Buffer.from(sign(`${header}.${payload}`));
  const actual = Buffer.from(signature);
  // Length check first: timingSafeEqual throws on a length mismatch, and
  // the length of an HMAC is not a secret.
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  let claims: TicketClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof claims.exp !== "number" || claims.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return claims;
}

export function gatewayUrl(): string {
  const value = process.env.UPLOAD_GATEWAY_URL;
  if (!value) throw new Error("UPLOAD_GATEWAY_URL is not configured");
  return value.replace(/\/$/, "");
}

/** The gateway path this purpose uploads to. Images (post_image and
 *  profile_picture) share one endpoint; a CV is validated differently and
 *  never touches the image sanitiser, so it gets its own. */
export function gatewayUploadUrl(purpose: TicketPurpose): string {
  return `${gatewayUrl()}${purpose === "cv" ? "/v1/documents" : "/v1/images"}`;
}

/** True when the gateway is configured. Every upload control hides rather
 *  than offering something that cannot work — a storage gateway must not
 *  be able to take out the Community tab, the onboarding photo step, or
 *  the CV step. */
export function uploadsEnabled(): boolean {
  return Boolean(process.env.UPLOAD_GATEWAY_URL && process.env.UPLOAD_TICKET_SECRET);
}
