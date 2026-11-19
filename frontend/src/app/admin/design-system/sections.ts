// The twelve sections of the style guide, in the order they are on the page. The contents list (StyleGuideNav) and each section's own heading both
// read this, so a section is named once and the two cannot drift. A section's id is its anchor.

export const SECTIONS = [
  { id: "lights", title: "The six lights" },
  { id: "surfaces", title: "Surfaces, ink and lines" },
  { id: "type", title: "Type" },
  { id: "layout", title: "Page layout" },
  { id: "buttons", title: "Buttons" },
  { id: "badges", title: "Badges and panels" },
  { id: "entries", title: "Entries" },
  { id: "logo", title: "The logo" },
  { id: "icons", title: "Icons and glyphs" },
  { id: "forms", title: "Forms" },
  { id: "data", title: "Data display and structure" },
  { id: "overlays", title: "Overlays and feedback" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

/** A section's title, from the list above. */
export function titleOf(id: SectionId): string {
  return SECTIONS.find((s) => s.id === id)?.title ?? id;
}
