import { Lockup } from "@/design-system/logo/Lockup";

// ════════════════════════════════════════════════════════════════════
// Foundry · brand lockup (Lumen, 2026 logo)
//
// The Imperial Entrepreneurs lockup, with the product name "Foundry" beside it.
// Single source of truth for the brand across the public site, the sign-in and
// onboarding screens and the footer. It is the 2026 logo drawn as inline SVG
// (src/design-system/logo): one flat colour, sharp at any size, no image to load.
//
// Sizes are lockup heights, and none goes under 51 px: below that the ring
// drops under 45 px and the plume slits stop reading. (The previous PNG
// lockup was shown at 20–32 px, under that floor.) Inside the signed-in app
// the brand is the roundel alone (AppShell/Sidebar): the lockup does not
// fit a 4.5 rem rail.
// ════════════════════════════════════════════════════════════════════

type Size = "xs" | "sm" | "md";
const HEIGHT: Record<Size, number> = {
  xs: 51, // footer
  sm: 56, // sign-in, onboarding, intake, error screens
  md: 64, // marketing
};

export function BrandLogo({
  size = "sm",
  showWordmark = true,
}: {
  size?: Size;
  showWordmark?: boolean;
  /** Kept so existing call sites compile; an inline SVG has nothing to preload. */
  priority?: boolean;
}) {
  return (
    <div className="flex items-center gap-4">
      <Lockup height={HEIGHT[size]} label="Imperial Entrepreneurs" className="shrink-0 text-star" />
      {showWordmark && (
        // The product name is a second voice beside the lockup, set in the
        // display face and divided from it by a hairline.
        <span className="font-display hidden border-l border-border pl-4 text-lead text-text-primary min-[400px]:inline-block">
          Foundry
        </span>
      )}
    </div>
  );
}
