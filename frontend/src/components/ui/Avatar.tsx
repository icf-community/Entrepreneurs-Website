"use client";

import { useState } from "react";
import { hueOf } from "./avatarHue";

// ════════════════════════════════════════════════════════════════════
// Foundry · Avatar (Lumen)
//
// A person in a ring: their photo, or their initials in the display face.
// There were about twelve local copies (a letter in a circle in six shapes,
// a bare <img>, a grey disc) and no component. This is the one.
//
//   size    xs 20 · sm 32 · md 44 · lg 64 · xl 96
//   lit     the ring glows: the current or chosen person
//   tone    "lit" for a small marker of who posted or organised (amber, soft)
//   ring    false when something else already draws the ring: an Entry's
//           glyph disc does, and an Avatar inside it drops its own (data.css)
//
// With no photo the initials are drawn in a light chosen from the first name
// (avatarHue.ts: three in five faces are warm, sun or cool, two in five neutral),
// so people in a list are told apart at a glance and each keeps their colour.
// A lit or "lit"-toned avatar is amber and ignores it.
//
// The photo is a real <img> with the alt text it always had: empty, because
// the name is written beside it. Give `alt` only where the name is not (then
// the initials carry it too, as role="img"). `src` may be a signed URL; if it
// fails to load (they expire) the initials take its place.
// ════════════════════════════════════════════════════════════════════

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const PX: Record<AvatarSize, number> = { xs: 20, sm: 32, md: 44, lg: 64, xl: 96 };

/** "Elena Petrova" → "EP", "Elena" → "E", "" → "?". One letter at the smallest size. */
function initialsOf(name: string, max: 1 | 2): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = Array.from(words[0])[0] ?? "";
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? "") : "";
  return ((max === 1 ? first : first + last) || "?").toUpperCase();
}

export function Avatar({
  src,
  name,
  initials,
  size = "md",
  lit = false,
  tone = "neutral",
  ring = true,
  alt = "",
  className = "",
}: {
  /** A photo URL (a signed one is fine). Absent or failing, the initials show. */
  src?: string | null;
  /** The person's name, to draw their initials from. */
  name?: string;
  /** Overrides the initials drawn from `name`. */
  initials?: string;
  size?: AvatarSize;
  lit?: boolean;
  tone?: "neutral" | "lit";
  ring?: boolean;
  /** The name of the picture, only where the name is not already written next to it. */
  alt?: string;
  className?: string;
}) {
  // The URL that failed, not a flag: a new `src` gets its own try without any effect to reset state.
  const [failed, setFailed] = useState<string | null>(null);
  const photo = src && src !== failed ? src : null;
  const letters = initials ?? initialsOf(name ?? "", size === "xs" ? 1 : 2);
  const named = alt !== "";

  return (
    <span
      className={`lm-avatar ${className}`.trim()}
      data-size={size}
      data-lit={lit || undefined}
      data-tone={tone === "lit" ? "lit" : undefined}
      data-ring={ring ? undefined : "none"}
      data-hue={photo ? undefined : hueOf(name ?? initials)}
      role={named && !photo ? "img" : undefined}
      aria-label={named && !photo ? alt : undefined}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not a static asset
        <img
          className="lm-avatar__img"
          src={photo}
          alt={alt}
          width={PX[size]}
          height={PX[size]}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(photo)}
        />
      ) : (
        <span aria-hidden="true">{letters}</span>
      )}
    </span>
  );
}

/**
 * A few people, overlapping, with the surplus as a count. The faces are decorative; the names are in the DOM as visually hidden text
 * (or `label`, if you want it read another way), so nothing is lost to a screen reader.
 */
export function AvatarStack({
  people,
  max = 4,
  size = "sm",
  label,
  className = "",
}: {
  people: readonly { name: string; src?: string | null }[];
  max?: number;
  size?: AvatarSize;
  label?: string;
  className?: string;
}) {
  const shown = people.slice(0, max);
  const more = people.length - shown.length;
  const spoken = label ?? `${shown.map((p) => p.name).join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
  return (
    <span className={`lm-avatars ${className}`.trim()} data-size={size}>
      {shown.map((p) => (
        <Avatar key={`${p.name}|${p.src ?? ""}`} name={p.name} src={p.src} size={size} />
      ))}
      {more > 0 ? (
        <span className="lm-avatar lm-avatars__more" data-size={size} aria-hidden="true">
          +{more}
        </span>
      ) : null}
      <span className="sr-only">{spoken}</span>
    </span>
  );
}
