"use client";

import { useEffect, useRef } from "react";
import { TURNSTILE_SITE_KEY as SITE_KEY } from "@/lib/turnstileConfig";

// Cloudflare Turnstile widget. Renders nothing unless
// NEXT_PUBLIC_TURNSTILE_SITE_KEY is set, so the forms work unchanged in
// local dev. When configured, it loads the Turnstile script, renders the
// challenge, and calls onToken with the solved token (or "" on
// error/expiry so the parent can require a fresh solve).

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

export function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const rendered = useRef(false);
  const cb = useRef(onToken);

  useEffect(() => {
    cb.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!SITE_KEY) return;

    const render = () => {
      if (rendered.current || !ref.current || !window.turnstile) return;
      rendered.current = true;
      window.turnstile.render(ref.current, {
        sitekey: SITE_KEY,
        callback: (token: string) => cb.current(token),
        "error-callback": () => cb.current(""),
        "expired-callback": () => cb.current(""),
      });
    };

    if (window.turnstile) {
      render();
      return;
    }

    let script = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", render);
    return () => script?.removeEventListener("load", render);
  }, []);

  if (!SITE_KEY) return null;
  return <div ref={ref} className="my-1" />;
}
