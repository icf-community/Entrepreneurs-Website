// The drawings the scene paints are the page's own. Every glyph beside the words (the audience row, the roles, the members, the listings, the events, the
// steps) is the design system's `Glyph`, which tags its SVG with `data-glyph="<name>"`; the scene reads those elements and rasterises them (the WebGL bodies,
// the painted posters), so the body in the scene and the glyph beside the words are one drawing and there is no second copy to keep in step.
//
// Plain DOM reading, so it runs after the page is in the document: the engine starts after first paint.

export interface GlyphArt {
  /** True when the page holds a drawing for `name` ("ring" always: the visitor's body). */
  has(name: string): boolean;
  /** The drawing as a standalone SVG document in one flat colour (any CSS colour), 256 px square. */
  svg(name: string, color: string): string;
}

const SIZE = "256";

export function readGlyphArt(root: Element): GlyphArt {
  const found = new Map<string, SVGElement>();
  for (const el of root.querySelectorAll<SVGElement>("svg[data-glyph]")) {
    const name = el.dataset.glyph ?? "";
    if (name && !found.has(name)) found.set(name, el);
  }
  // the visitor's body is the glyph grammar's ring with no figure: the ring of any glyph that has one (it is drawn first, the only circle with no fill)
  const ringSource = [...found.values()].find((el) => el.querySelector(':scope > circle[fill="none"]'));
  const serializer = new XMLSerializer();

  function drawing(name: string): SVGElement | null {
    if (name === "ring") {
      if (!ringSource) return null;
      const ring = ringSource.cloneNode(false) as SVGElement;
      ring.appendChild((ringSource.querySelector(':scope > circle[fill="none"]') as Element).cloneNode(true));
      return ring;
    }
    return (found.get(name)?.cloneNode(true) as SVGElement | undefined) ?? null;
  }

  return {
    has: (name) => (name === "ring" ? !!ringSource : found.has(name)),
    svg(name, color) {
      const el = drawing(name);
      if (!el) return "";
      el.setAttribute("width", SIZE);
      el.setAttribute("height", SIZE);
      return serializer.serializeToString(el).replaceAll("currentColor", color);
    },
  };
}
