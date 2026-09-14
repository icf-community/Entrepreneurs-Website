import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getActionAuth } from "@/lib/auth/actionAuth";
import { check } from "@/lib/ratelimit";
import { emailBaseUrl } from "@/lib/siteUrl";
import {
  GITHUB_OAUTH_RETURN_COOKIE,
  GITHUB_OAUTH_STATE_COOKIE,
  githubConnectReturnPath,
  type GithubConnectReturnTo,
} from "@/lib/github/oauthState";
import * as Sentry from "@sentry/nextjs";

// ════════════════════════════════════════════════════════════════════
// GitHub OAuth start — sibling to ../callback/route.ts, the other half
// of this flow. A plain Route Handler, not a Server Action.
//
// This used to be requestGithubConnectUrl in mediaActions.ts: a Server
// Action that set the two cookies below and returned the GitHub
// authorize URL as data, for the client to window.location.href to
// (and, briefly, a version that called next/navigation's redirect()
// instead — see this file's git history for why that didn't help
// either). Both raced Next's own RSC reconciliation: writing a cookie
// in a Server Action marks the current route dirty, so the response
// carries x-action-revalidated: 1 — but confirmed via a live prod
// repro (2026-09-14, response headers inspected directly): when the
// action's redirect target is external, Next sends that header
// alongside an EMPTY body (content-length: 0) regardless of which of
// the two approaches triggered the redirect. The client tries to parse
// a revalidated payload that was never sent and throws "An unexpected
// response was received from the server" into error.tsx for a moment,
// even though the real redirect to github.com still completes right
// after. A Route Handler is a plain HTTP request/response with none of
// the Server Action/RSC machinery, so this bug class can't happen here
// — the client just does a normal top-level navigation to this route
// and the browser follows the 307 on its own.
//
// Trade-off from moving off the Result-returning Server Action: a
// failure here can't set inline React error state directly anymore,
// since there's no client code left in the loop. Reuses the exact
// ?github=error convention ../callback/route.ts already established
// for its own failure paths — ProfileForm.tsx and IntakeFlow.tsx
// already read that param and show "We couldn't connect your GitHub
// account. Please try again.", so this needed no client-side changes
// for the error path, only for how the flow is triggered.
// ════════════════════════════════════════════════════════════════════

function returnToFromQuery(raw: string | null): GithubConnectReturnTo {
  return raw === "intake" ? "intake" : "profile";
}

export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url);
  const returnTo = returnToFromQuery(searchParams.get("returnTo"));
  const returnPath = githubConnectReturnPath(returnTo);
  const errorRedirect = () => NextResponse.redirect(`${origin}${returnPath}?github=error`);

  const { user, isAdmin, status } = await getActionAuth();
  if (!user) return NextResponse.redirect(`${origin}/login`);
  if (!isAdmin && status !== "approved") return errorRedirect();

  // Same bucket and fail-closed stance as every other upload-ticket
  // bucket in this codebase (mediaActions.ts's guardRate) — an Upstash
  // outage refuses the connect attempt rather than silently exceeding
  // a limit nobody could then explain.
  const decision = await check("githubConnect", user.id);
  if (decision === "limited") return errorRedirect();
  if (decision === "unavailable") {
    Sentry.captureMessage(
      "githubConnect rate-limit bucket unreachable — connect is being refused (fail-closed)",
      { level: "error", tags: { bucket: "githubConnect", surface: "profile-media" } },
    );
    return errorRedirect();
  }

  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) return errorRedirect();

  const state = randomBytes(32).toString("hex");
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  // redirect_uri is built from emailBaseUrl() (fixed config), not request
  // headers — same reasoning as email links: an attacker-controlled Host
  // header must not be able to steer where GitHub sends the OAuth code.
  url.searchParams.set("redirect_uri", `${emailBaseUrl()}/auth/github-connect/callback`);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "false");

  const response = NextResponse.redirect(url.toString());
  const cookieOptions = {
    httpOnly: true,
    secure: emailBaseUrl().startsWith("https"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600, // 10 minutes
  };
  response.cookies.set(GITHUB_OAUTH_STATE_COOKIE, state, cookieOptions);
  // Which of the two entry points started this. The callback maps it
  // through a fixed allow-list — githubConnectReturnPath — so even a
  // tampered cookie can only ever select between /profile and /intake.
  response.cookies.set(GITHUB_OAUTH_RETURN_COOKIE, returnTo, cookieOptions);
  return response;
}
