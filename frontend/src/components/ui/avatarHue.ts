// ═════════════════════════════════════════════════════════════════
// Foundry · the light a face is drawn in
//
// A person with no photo is their initials in a ring. To tell the people in a list apart at a glance, three in five of them are drawn in a
// light (warm, sun or cool; the colours are tokens.css, `--color-person-*`) and two in five stay neutral, so it reads as a few warm faces in a
// quiet crowd, never a rainbow. The light is chosen from the FIRST name only, because the same person is written "Ada", "Ada Okafor" and
// "Ada O." in different places and must be the same colour in all of them. Two Adas share one: it is decoration, never identity.
//
// Pure and server-safe, so a server component can set it too (the sidebar's profile chip does).
// ═════════════════════════════════════════════════════════════════

export type PersonHue = "warm" | "sun" | "cool" | undefined;

const HUES: readonly PersonHue[] = [undefined, undefined, "warm", "sun", "cool"];

/** "Ada Okafor" → the same light as "ada" and "Ada". No name, no light. */
export function hueOf(name: string | null | undefined): PersonHue {
  const first = (name ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!first) return undefined;
  let h = 2166136261; // FNV-1a: tiny, stable across runs and platforms, no dependency
  for (const ch of first) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return HUES[h % HUES.length];
}
