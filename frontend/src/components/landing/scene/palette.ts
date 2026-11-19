// The scene's colours and the warm core's two constants, shared by the WebGL painter and the poster painter (kept out of gl.ts so the static page
// never loads the renderer).
import { Color, LinearSRGBColorSpace, SRGBColorSpace } from "three";

let probe: CanvasRenderingContext2D | null = null;
/** A CSS colour token → THREE.Color via a 1px canvas (the browser does the colour conversion). `el` is where the token is defined. */
export function cssColor(el: Element, name: string): Color {
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const c = probe as CanvasRenderingContext2D;
  c.canvas.width = c.canvas.height = 1;
  c.fillStyle = "#000";
  c.fillStyle = getComputedStyle(el).getPropertyValue(name).trim();
  c.fillRect(0, 0, 1, 1);
  const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
  return new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);
}

/** The token as the raw numbers a ShaderMaterial hands to the screen (it does no colour management): the token's sRGB bytes, so a lit orbit is the amber of the token
 *  and not a darker, redder orange. (The cool dust keeps Orbit's tuned look, which is the managed value shown raw.) */
export function rawColor(el: Element, name: string): Color {
  const h = cssColor(el, name).getHex();
  return new Color().setRGB(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255, LinearSRGBColorSpace);
}

/** A colour for a 2D canvas: three sRGB bytes and an alpha, written as CSS `color(srgb …)`. Every colour the scene paints is a token read at runtime
 *  (above), or a white ramp that a material tints; none is written into the code as a hue. */
export const srgb = (r: number, g: number, b: number, a = 1): string => `color(srgb ${r / 255} ${g / 255} ${b / 255} / ${a})`;

/** The warm core as light is a grey ramp the material tints amber: it spans CORE_SPAN mark radii. */
export const CORE_SPAN = 5.2;
/** How strong the core is at full (F.core = 1): added light at the peak, as a share of the amber token. Kept low enough that the white mark keeps 5:1 over it. */
export const CORE_PEAK = 0.42;
