import Image from "next/image";

// Imperial Entrepreneurs logo + "Foundry" wordmark.
//
// Single source of truth for the brand mark across both the public
// marketing site and the authenticated app.
//
// The asset is /logo-lockup.png: the roundel and wordmark cut out of the
// original artwork with a real alpha channel. Two things that fixes.
//
//   * The old source was the full 2416x1270 canvas — mostly black field. At
//     `h-9` the roundel rendered about 12px tall inside a box of nothing.
//     This asset's bounding box IS the artwork, so the height prop means what
//     it says.
//   * It was composited with mixBlendMode:"screen" to knock the black out.
//     That only approximates transparency, and the source carried a 3px
//     #717171 frame on three edges which screen mode lifted into a visible
//     rectangle on every surface the mark appeared on.

type Size = "xs" | "sm" | "md";
const HEIGHT: Record<Size, string> = {
  xs: "h-5",  // 20px — footer
  sm: "h-6",  // 24px — app headers
  md: "h-8",  // 32px — marketing site
};
const WORDMARK_TEXT: Record<Size, string> = {
  xs: "text-[0.8rem]",
  sm: "text-[0.875rem]",
  md: "text-[0.95rem]",
};

export function BrandLogo({
  size = "sm",
  showWordmark = true,
  priority = false,
}: {
  size?: Size;
  showWordmark?: boolean;
  /**
   * Preload the mark. Opt-in, because this renders in the footer of every page
   * as well as the header — `priority` there preloaded a below-the-fold image
   * and competed with LCP. Set it only where the logo is above the fold.
   */
  priority?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <Image
        src="/logo-lockup.png"
        alt="Imperial Entrepreneurs"
        width={1024}
        height={206}
        priority={priority}
        loading={priority ? undefined : "lazy"}
        className={`${HEIGHT[size]} w-auto`}
      />
      {showWordmark && (
        // Set to match the wordmark it sits beside rather than contrast with
        // it: same grotesque, uppercase, tracked out. The rule is the divider.
        <span
          className={`${WORDMARK_TEXT[size]} hidden font-medium uppercase tracking-[0.16em] text-text-primary border-l border-border pl-3 min-[380px]:inline-block`}
        >
          Foundry
        </span>
      )}
    </div>
  );
}
