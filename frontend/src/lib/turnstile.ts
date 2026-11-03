import "server-only";

import { isProductionDeploy } from "@/lib/productionEnv";

// Cloudflare Turnstile server-side verification.
//
// ENV-GATED: with no TURNSTILE_SECRET_KEY, verifyTurnstile() returns true
// in local / CI / preview so those environments run without ceremony. A
// real production deploy without the secret used to fail OPEN (and only
// log at boot) — that is now fail-closed so a dropped Vercel env var
// cannot silently disable bot protection on the contact form.

const SECRET = process.env.TURNSTILE_SECRET_KEY;

export const turnstileServerEnabled = Boolean(SECRET);

export async function verifyTurnstile(token: string | null | undefined): Promise<boolean> {
  if (!SECRET) return !isProductionDeploy(); // prod without secret → refuse
  if (!token) return false; // configured but no token → fail

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: SECRET, response: token }),
      // A hung Cloudflare call must not hang the login/OTP request behind
      // it — same fail-mode as any other failure here (catch → false).
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false; // non-2xx from Cloudflare → fail closed, same as any other failure here
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
