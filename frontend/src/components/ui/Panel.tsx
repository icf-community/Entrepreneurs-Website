import type { HTMLAttributes } from "react";

// ════════════════════════════════════════════════════════════════════
// Foundry · Panel (Lumen)
//
// A surface: a hairline, a whisper of top light, 14 px corners. The shape
// of every card, form block and settings section, which used to be a
// pasted `rounded-2xl bg-bg-card border border-border` in about 40 places.
// The look is in components.css (.lm-panel); padding is the caller's.
//
//   tone="inset"   a recessed field inside a panel or a band
//   tone="plain"   no surface at all, same structure
//   tone="lit"     the one panel that matters (a featured thing): warm hairline and glow
//   tone="danger"  a destructive zone
//   interactive    the whole panel is a target: it lifts a step when pointed at
//
// Never nest a panel in a panel: use an inset tone or a hairline instead.
// ════════════════════════════════════════════════════════════════════

export type PanelTone = "default" | "inset" | "plain" | "lit" | "danger";

export function Panel({
  as: Tag = "div",
  tone = "default",
  size = "md",
  interactive = false,
  className = "",
  ...rest
}: {
  as?: "div" | "section" | "article" | "aside" | "li" | "form" | "header";
  tone?: PanelTone;
  size?: "sm" | "md" | "lg";
  interactive?: boolean;
} & HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      {...rest}
      className={`lm-panel ${className}`}
      data-tone={tone === "default" ? undefined : tone}
      data-size={size === "md" ? undefined : size}
      data-interactive={interactive || undefined}
    />
  );
}
