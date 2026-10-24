import { useCallback, useEffect, useState } from "react";
import type { useRouter } from "next/navigation";
import { getMyGithubStatus, getMyGithubShowcase, setMyGithubShowcase } from "@/app/profile/mediaActions";
import type { GithubScreenState } from "./screens";

/**
 * GitHub connect/scan/showcase state for intake screen 03 — owned here
 * rather than in screens.tsx for the same reason the avatar and CV
 * uploads are: screens.tsx stays pure UI, and every round trip lives in
 * one file. Extracted out of IntakeFlow (structural only, no behavior
 * change) to keep that component's size and complexity down.
 */
export function useGithubConnectFlow(
  githubConnected: boolean,
  githubReturn: string | null,
  router: ReturnType<typeof useRouter>,
): { ghConnected: boolean; github: GithubScreenState } {
  const [ghConnected, setGhConnected] = useState(githubConnected);
  const [ghScanning, setGhScanning] = useState(false);
  const [ghConnecting, setGhConnecting] = useState(false);
  const [ghError, setGhError] = useState(
    githubReturn === "error" ? "We couldn't connect your GitHub account. Please try again." : "",
  );
  const [ghShowcase, setGhShowcase] = useState<GithubScreenState["showcase"]>(null);
  const [ghSaving, setGhSaving] = useState(false);
  const [ghSaved, setGhSaved] = useState(false);

  /**
   * Polls the scan the way the profile dialog does, then loads the
   * picker. Bounded: a scan that hasn't finished within ~40s leaves the
   * screen saying so and lets the member move on — an optional screen
   * must never be able to trap someone mid-signup.
   */
  const loadGithub = useCallback(async () => {
    setGhScanning(true);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const status = await getMyGithubStatus();
      if (!status.ok || !status.data) break;
      setGhConnected(true);
      if (status.data.scanStatus === "failed") {
        setGhError(status.data.scanFailureReason ?? "We couldn't read your repositories.");
        setGhScanning(false);
        return;
      }
      if (status.data.scanStatus === "ready") {
        const showcase = await getMyGithubShowcase();
        if (showcase.ok && showcase.data) setGhShowcase(showcase.data);
        setGhScanning(false);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    setGhScanning(false);
  }, []);

  /**
   * The OAuth round trip leaves the flow entirely and comes back to
   * /intake?github=connected. The draft in localStorage restores every
   * answer, but `step` is deliberately NOT drafted — which is exactly
   * why the query param has to carry it. Cleared with router.replace so
   * a later refresh doesn't re-trigger this.
   */
  useEffect(() => {
    if (githubReturn !== "connected" && githubReturn !== "error") return;
    // Clear the param so a refresh doesn't re-enter this branch. The step
    // and the error message are already in the initial state above.
    // react-doctor-disable-next-line react-doctor/nextjs-no-client-side-redirect -- cleans up a transient OAuth-return query param after a client-only round trip; must preserve in-memory flow state a server redirect can't carry
    router.replace("/intake");
    // Genuinely does set state synchronously: loadGithub's first line is
    // setGhScanning(true), before it polls. That is the point — the
    // screen must already read as scanning when the member lands back
    // from github.com, not one poll later. The cost is one extra render
    // on a mount that is navigating anyway.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (githubReturn === "connected") void loadGithub();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on the OAuth return
  }, []);

  // A plain navigation to a Route Handler, not a Server Action call —
  // see auth/github-connect/start/route.ts's header comment for why:
  // a Server Action here raced Next's own RSC reconciliation and
  // flashed error.tsx before the real redirect completed. Failure
  // comes back as ?github=error, read by the effect above (githubReturn).
  const connectGithub = () => {
    setGhConnecting(true);
    // A hard navigation on purpose — router.push() would soft-navigate
    // within the SPA instead of making the real GET request this Route
    // Handler needs to run its guards and set-then-redirect.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/auth/github-connect/start?returnTo=intake";
  };

  const saveGithubPicks = async (picks: { name: string; blurb: string }[]) => {
    setGhError("");
    setGhSaving(true);
    try {
      const result = await setMyGithubShowcase(picks);
      if (!result.ok) { setGhError(result.error); return; }
      setGhSaved(true);
    } finally {
      setGhSaving(false);
    }
  };

  return {
    ghConnected,
    github: {
      connected: ghConnected,
      scanning: ghScanning,
      connecting: ghConnecting,
      error: ghError,
      showcase: ghShowcase,
      saving: ghSaving,
      saved: ghSaved,
      onConnect: connectGithub,
      onSave: saveGithubPicks,
    },
  };
}
