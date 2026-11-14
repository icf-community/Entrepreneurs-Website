import type { HTMLAttributes } from "react";

// ════════════════════════════════════════════════════════════════════
// Foundry · Badge (Lumen)
//
// A small pill that says what kind or what state something is. There were
// twelve local copies (the sector/skill pair alone was pasted into eight
// files); this is the one. Tone is meaning, never decoration:
//
//   neutral  a kind (a sector, a skill, a role)
//   lit      a chosen or active thing, a status worth noticing (amber)
//   danger   something wrong or destructive
//   success  something confirmed
//   info     something to know (the cold light)
//
// `dot` adds a status dot in the tone's colour. Colour never carries the
// meaning alone: the badge always has a word.
// ════════════════════════════════════════════════════════════════════

export type BadgeTone = "neutral" | "lit" | "danger" | "success" | "info";

export function Badge({
  tone = "neutral",
  dot = false,
  className = "",
  ...rest
}: { tone?: BadgeTone; dot?: boolean } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...rest}
      className={`lm-badge ${className}`}
      data-tone={tone === "neutral" ? undefined : tone}
      data-dot={dot || undefined}
    />
  );
}
