"use client";

import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRef } from "react";
import { scrollBehavior } from "@/lib/motion";

// three.js is a heavy dependency to ship in the main bundle of the public
// marketing page every prospective member hits before signing up. The
// static Image fallback below is already the scene's own "not live yet"
// state (see its own comment), so deferring the module fetch to the client
// costs nothing visually — it's the same frame either way until the point
// cloud is sampled.
const HeroScene = dynamic(() => import("@/components/HeroScene"), { ssr: false });

// ════════════════════════════════════════════════════════════════════
// Foundry · Hero
//
// The previous version stacked a 620px lockup above the headline and came
// out 983px tall in a 900px viewport: the h1 began at y=470 and the buttons
// at y=854, so the first screen was a nav, a logo, and empty space. The
// message was below the fold on a laptop. It also showed the wordmark
// "IMPERIAL ENTREPRENEURS" at full width 60px under a nav already showing
// it, and then again as a 0.7rem label beside the heading — the same words
// three times in one viewport.
//
// So: the headline leads, at the page's own left margin. The roundel is the
// mark — the half of the logo that is not already on screen — set large in
// the sky beside it. The starfield is the material, unchanged; it was the
// part that was working.
// ════════════════════════════════════════════════════════════════════

export default function Hero() {
  // The WebGL layer is full-bleed so the sky fills the section, but the mark
  // has to sit exactly where the grid puts it. This element reserves that
  // space in the layout and the scene projects onto its rect.
  const markAnchor = useRef<HTMLDivElement>(null);

  return (
    <section
      id="hero"
      className="relative flex min-h-[max(560px,86svh)] flex-col justify-center overflow-hidden px-8 pb-14 pt-24"
    >
      <HeroScene
        anchorRef={markAnchor}
        className="starfield-parallax pointer-events-none absolute inset-0 h-full w-full"
      />

      <div className="relative mx-auto grid w-full max-w-[1200px] grid-cols-1 items-center gap-x-16 gap-y-12 lg:grid-cols-[1.55fr_1fr]">
        <div className="min-w-0">
          {/* The wordmark's device: heavy and tight, then lighter and wider,
              across three lines of untouched copy. The emphasis a gold serif
              italic used to carry is a weight step now. */}
          <h1 className="display-xl anim-fade-up mb-8 text-[clamp(2rem,4.2vw,3.5rem)]">
            <span className="block font-bold text-text-primary">
              The founder community,
            </span>
            <span className="block font-normal text-text-primary" style={{ fontStretch: "88%", letterSpacing: "-0.03em" }}>
              built by Imperial students
            </span>
            <span className="block font-light text-text-secondary" style={{ fontStretch: "100%", letterSpacing: "-0.015em" }}>
              for Imperial students.
            </span>
          </h1>

          <p className="anim-fade-up delay-100 mb-9 max-w-[52ch] text-[1.0625rem] leading-[1.6] text-text-secondary">
            Foundry connects students, recent graduates, alumni founders, mentors,
            and investors across Imperial&apos;s ecosystem. Build something real, together.
          </p>

          <div className="anim-fade-up delay-200 flex flex-wrap items-center gap-3">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-7 py-3.5 text-sm font-semibold text-bg-primary no-underline transition-colors duration-150 hover:bg-accent-dim"
            >
              Join Foundry
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M2.5 7H11.5M8 3.5L11.5 7L8 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <a
              href="#who-we-are"
              onClick={(e) => { e.preventDefault(); document.getElementById("who-we-are")?.scrollIntoView({ behavior: scrollBehavior() }); }}
              aria-label="Learn more about who we are"
              className="inline-flex items-center gap-2 rounded-lg border border-border-strong bg-white/[0.05] px-7 py-3.5 text-sm text-text-primary no-underline transition-colors duration-150 hover:border-accent hover:bg-white/[0.10]"
            >
              Learn more
            </a>
          </div>
        </div>

        {/* The mark, in the sky rather than on a picture of one. Ordered first
            on a phone so the artwork is what greets you, second on desktop so
            the headline holds the left. */}
        <div className="order-first flex justify-center lg:order-last lg:justify-end">
          <div
            ref={markAnchor}
            className="relative aspect-square w-[42vw] max-w-[340px] lg:w-full"
          >
            {/* Shown until the point cloud is sampled, and left in place for
                good if WebGL is unavailable or the context is lost. The scene
                sets data-live on its canvas, which hides this. */}
            <Image
              src="/logo-roundel.png"
              alt="Imperial Entrepreneurs"
              width={512}
              height={514}
              priority
              sizes="(min-width: 1024px) 340px, 42vw"
              className="hero-mark-fallback h-full w-full object-contain"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
