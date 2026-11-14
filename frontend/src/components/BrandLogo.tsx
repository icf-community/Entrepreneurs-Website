import { Lockup } from "@/design-system/logo/Lockup";
import { Roundel } from "@/design-system/logo/Roundel";

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
//
// On a phone the lockup is wider than the room beside whatever shares its bar
// (a sign-out link, a skip button), and the logo may not be shrunk to fit. So
// below sm the brand is the roundel alone, 48 px, as it is in the app's bar and
// rail; from sm up it is the lockup with the name. Exactly one of the two is
// displayed at any width, so one of them is always the link's name.
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
    <>
      <Roundel size={48} label="Imperial Entrepreneurs" className="text-star sm:hidden" />
      <div className="hidden items-center gap-4 sm:flex">
        <Lockup height={HEIGHT[size]} label="Imperial Entrepreneurs" className="shrink-0 text-star" />
        {showWordmark && (
          // The product name is a second voice beside the lockup, set in the
          // display face and divided from it by a hairline.
          <span className="font-display border-l border-border pl-4 text-lead text-text-primary">Foundry</span>
        )}
      </div>
    </>
  );
}
