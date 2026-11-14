import { Suspense } from "react";
import LoginClient from "./LoginClient";
import { SiteBanner } from "@/components/SiteBanner";
import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";

// A thin server wrapper, added 2026-09-08, for two reasons that both come
// out of removing `force-dynamic` from the root layout (C2 Finding 6).
//
// 1. This page MUST render per request. /login is deliberately kept off
//    csp.ts's STATIC_CSP_ROUTES: it takes user input and is the highest-
//    value phishing/XSS target in the app, so it keeps the strict
//    nonce + strict-dynamic policy. A statically rendered page cannot
//    carry a per-request nonce, and strict-dynamic ignores 'self', so a
//    prerendered /login would ship with its own bundle blocked — a login
//    form with no working JavaScript.
//
// 2. Route segment config is IGNORED in a "use client" module. Putting
//    `export const dynamic` at the top of the old client page looked
//    right, changed nothing, and the build failed identically — which is
//    the useful part of the story: the guarantee has to live in a server
//    component or it is not a guarantee at all. Hence this file, with the
//    UI moved to LoginClient.tsx untouched.
//
// The Suspense boundary is what useSearchParams() requires; without it
// prerendering fails outright. It is deliberately kept even though the
// page is force-dynamic, so the requirement is satisfied structurally
// rather than depending on the config export above staying put.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <>
      <SiteBanner />
      {/* C1: a form-shaped placeholder instead of a blank page while the
          client half hydrates. */}
      <Suspense fallback={<LoginSkeleton />}>
        <LoginClient />
      </Suspense>
    </>
  );
}

function LoginSkeleton() {
  return (
    // No background of its own: the atmosphere shows through, as it does behind the real page.
    <main id="main-content" tabIndex={-1} className="flex min-h-screen items-center justify-center px-[var(--gutter)]">
      <SkeletonRegion label="Loading sign in…" className="w-full max-w-[460px] space-y-4">
        <Skeleton className="h-12 w-12" shape="ring" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-14 w-full rounded-lg" />
      </SkeletonRegion>
    </main>
  );
}
