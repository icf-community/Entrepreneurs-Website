import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { emailBaseUrl } from "@/lib/siteUrl";
import {
  GITHUB_OAUTH_RETURN_COOKIE,
  GITHUB_OAUTH_STATE_COOKIE,
  githubConnectReturnPath,
} from "@/lib/github/oauthState";

// ════════════════════════════════════════════════════════════════════
// GitHub OAuth callback — connects a member's GitHub account for the CV
// matchmaker's optional GitHub signal (server/app/github_pipeline.py).
//
// Deliberately NOT routed through Supabase Auth's own OAuth handling
// (unlike /auth/callback, which is Google sign-IN): this is a standalone
// OAuth App (own client id/secret, github.com/login/oauth/*), used only
// to link a secondary account to an already-signed-in, already-approved
// member — enabling GitHub as a Supabase Auth provider would also let
// strangers sign UP via GitHub, bypassing whatever gates Google/Imperial
// signups today. See mediaActions.ts's requestGithubConnectUrl for the
// other half of this flow.
// ════════════════════════════════════════════════════════════════════

// Connecting can start from the profile page or from the intake flow's
// GitHub screen, and must land back where it started — an intake member
// dumped on /profile has silently fallen out of signup.
//
// `returnPath` is NEVER a value from the request. It comes from
// githubConnectReturnPath, which maps a two-value cookie through a fixed
// allow-list to one of two hardcoded paths and defaults to /profile on
// anything else. Reflecting a URL from the query string here would be a
// textbook open redirect.
function redirectBack(origin: string, returnPath: string, outcome: "connected" | "error") {
  return NextResponse.redirect(`${origin}${returnPath}?github=${outcome}`);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // Length check first: timingSafeEqual throws on a length mismatch, and
  // the length of a state token is not a secret.
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);

  const cookieStore = await cookies();
  const cookieState = cookieStore.get(GITHUB_OAUTH_STATE_COOKIE)?.value;
  const returnPath = githubConnectReturnPath(cookieStore.get(GITHUB_OAUTH_RETURN_COOKIE)?.value);
  cookieStore.delete(GITHUB_OAUTH_STATE_COOKIE);
  cookieStore.delete(GITHUB_OAUTH_RETURN_COOKIE);

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code || !state || !cookieState || !safeEqual(state, cookieState)) {
    console.error("github-connect: state check failed", { hasCode: !!code, hasState: !!state, hasCookie: !!cookieState });
    return redirectBack(origin, returnPath, "error");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const encryptionKey = process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
  if (!clientId || !clientSecret || !encryptionKey) {
    console.error("github-connect: missing env var(s)", { clientId: !!clientId, clientSecret: !!clientSecret, encryptionKey: !!encryptionKey });
    return redirectBack(origin, returnPath, "error");
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: `${emailBaseUrl()}/auth/github-connect/callback`,
    }),
  });
  const tokenJson: { access_token?: string; error?: string; error_description?: string } = await tokenRes
    .json()
    .catch(() => ({}));
  if (!tokenRes.ok || !tokenJson.access_token) {
    // Log the named error fields, never the whole body: GitHub can
    // return a non-2xx that still carries an access_token, and a
    // credential in the log stream is a credential leaked to everyone
    // who can read logs.
    console.error("github-connect: token exchange failed", {
      status: tokenRes.status,
      error: tokenJson.error,
      description: tokenJson.error_description,
    });
    return redirectBack(origin, returnPath, "error");
  }

  const ghUserRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      Accept: "application/vnd.github+json",
    },
  });
  const ghUser: { id?: number; login?: string } = await ghUserRes.json().catch(() => ({}));
  if (!ghUserRes.ok || !ghUser.id || !ghUser.login) {
    console.error("github-connect: fetching GitHub user failed", { status: ghUserRes.status, body: ghUser });
    return redirectBack(origin, returnPath, "error");
  }

  const { error } = await supabase.rpc("confirm_github_connected", {
    p_github_user_id: ghUser.id,
    p_github_username: ghUser.login,
    p_access_token: tokenJson.access_token,
    p_encryption_key: encryptionKey,
  });
  if (error) {
    console.error("github-connect: confirm_github_connected RPC failed", error);
    return redirectBack(origin, returnPath, "error");
  }

  return redirectBack(origin, returnPath, "connected");
}
