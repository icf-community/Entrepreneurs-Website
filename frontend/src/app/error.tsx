"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import Starfield from "@/components/Starfield";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { PageHead } from "@/components/ui/PageHead";
import { Disc } from "@/design-system/icons/Disc";
import { Icon } from "@/design-system/icons/Icon";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // instrumentation.ts's onRequestError only covers server-render
    // errors — an error caught here (after hydration, in a client
    // component) would otherwise never reach Sentry despite the rest of
    // the app being fully wired to it.
    console.error(error);
    Sentry.captureException(error);
  }, [error]);

  // The sky behind it, and no background of its own: the atmosphere shows through. The one thing to do is try again, so that is the
  // primary action; the way home is the quiet one beside it. The error id is a measured value.
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <Starfield className="pointer-events-none absolute inset-0 h-full w-full" />

      <main id="main-content" tabIndex={-1} className="relative z-10 flex flex-1 items-center justify-center px-[var(--gutter)] py-12">
        <div className="grid w-full max-w-[520px] justify-items-start gap-2">
          <Disc size="lg" className="[--_d:88px]">
            <Icon name="warning" size={32} />
          </Disc>

          <PageHead
            context="Oops"
            title="Something went wrong."
            lede="We couldn't load this page. This is usually a brief hiccup on our side and nothing is wrong with your account — try again in a moment."
            actions={
              <>
                <Button type="button" onClick={retry}>
                  Try again
                </Button>
                <ButtonLink href="/" variant="ghost">
                  Back to home
                </ButtonLink>
              </>
            }
          />

          {error.digest && (
            <p className="mt-6 text-small text-text-muted">
              Error ID: <span className="data">{error.digest}</span>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
