// The "who is in Foundry" row: six audience glyphs, one caption slot. The markup is the server's (components/landing/Hero.tsx); this attaches the behaviour.
// At rest the caption says what the row means; hovering or focusing a glyph names that audience and tells the scene to light its orbit.
import { AUDIENCES } from "@/design-system/icons/glyphs";
import { HERO } from "@/lib/landing/content";

/** `onSelect(i)` with the audience's index, or null when none is pointed at. `select(i)` is the same call from outside (?who=<n>). Returns `destroy`. */
export function mountWho(root: HTMLElement, { onSelect, initial }: { onSelect?: (i: number | null) => void; initial?: number | null } = {}): { select(i: number | null): void; destroy(): void } {
  const wrap = root.querySelector<HTMLElement>(".who-wrap");
  const cap = wrap?.querySelector<HTMLElement>(".who-cap");
  const btns = [...(wrap?.querySelectorAll<HTMLElement>(".who-btn") ?? [])];
  if (!wrap || !cap) return { select() {}, destroy() {} };
  const set = (i: number | null): void => {
    cap.textContent = i == null ? HERO.caption : AUDIENCES[i].full;
    btns.forEach((b, j) => b.classList.toggle("on", j === i));
    onSelect?.(i);
  };
  const off: (() => void)[] = [];
  btns.forEach((b, i) => {
    const enter = (): void => set(i);
    const leave = (): void => set(null);
    b.addEventListener("pointerenter", enter);
    b.addEventListener("pointerleave", leave);
    b.addEventListener("focus", enter);
    b.addEventListener("blur", leave);
    off.push(() => {
      b.removeEventListener("pointerenter", enter);
      b.removeEventListener("pointerleave", leave);
      b.removeEventListener("focus", enter);
      b.removeEventListener("blur", leave);
    });
  });
  if (initial != null && initial >= 0 && initial < AUDIENCES.length) set(initial);
  return {
    select: set,
    destroy() {
      for (const f of off) f();
      cap.textContent = HERO.caption;
      btns.forEach((b) => b.classList.remove("on"));
    },
  };
}
