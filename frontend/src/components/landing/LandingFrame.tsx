"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { bootScene } from "./scene/boot";

// The page wrapper, and the only client component of the landing page. The page is the server's: every section arrives as HTML (children), and this
// wrapper hands it to the scene once the page has painted. `.lumen` is the scope of landing.css; nothing it styles can leak into the rest of the app.
// The scene mounts and unmounts here and nowhere else (scene/boot.ts, then the lazily loaded engine): StrictMode's second mount starts it again.

export function LandingFrame({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    return root ? bootScene(root) : undefined;
  }, []);
  return (
    <div ref={ref} className="lumen">
      {children}
    </div>
  );
}
