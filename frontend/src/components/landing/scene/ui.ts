// The page's small instruments: they change state when the viewer acts, and nothing here moves on its own.
//   · the skills / sectors picker (Community): pick up to 5 and up to 2, "+" lays the other tags in
//   · smart matching: the picks light the example members who share them (the content's own skills data; no new words)
import { COMMUNITY } from "@/lib/landing/content";

const LIMIT: Record<string, number> = { skills: COMMUNITY.limits.skills, sectors: COMMUNITY.limits.sectors };

/** onChange(matches): one 0..1 value per example member (skills shared with the picks, over the picks that can match). Returns `destroy`. */
export function mountPicker(root: HTMLElement, { onChange }: { onChange?: (matches: number[]) => void } = {}): () => void {
  const picker = root.querySelector<HTMLElement>("#picker");
  const more = picker?.querySelector<HTMLElement>(".more");
  if (!picker || !more) return () => {};
  const tags = [...picker.querySelectorAll<HTMLElement>(".tag")];
  tags.forEach((t, i) => t.style.setProperty("--i", String(i)));
  const pressed = (t: Element): boolean => t.getAttribute("aria-pressed") === "true";
  const members = [...root.querySelectorAll<HTMLElement>(".member")];
  const timers = new Set<number>();
  let frames = 0;

  function matches(): number[] {
    const picks = new Set(tags.filter((t) => t.dataset.kind === "skills" && pressed(t)).map((t) => t.dataset.v));
    const out = COMMUNITY.profiles.map((p) => p.skills.filter((s) => picks.has(s)).length / p.skills.length);
    members.forEach((el, i) => el.classList.toggle("match", out[i] > 0));
    return out;
  }

  const onPick = (e: MouseEvent): void => {
    const t = (e.target as Element).closest<HTMLElement>(".tag");
    if (!t) return;
    const kind = t.dataset.kind ?? "";
    const on = pressed(t);
    if (!on && tags.filter((x) => x.dataset.kind === kind && pressed(x)).length >= LIMIT[kind]) {
      t.classList.remove("deny");
      void t.offsetWidth;
      t.classList.add("deny");
      timers.add(window.setTimeout(() => t.classList.remove("deny"), 220));
      return;
    }
    t.setAttribute("aria-pressed", String(!on));
    // a tag put down while the picker is closed stays until focus leaves it (focus must not fall to the page)
    if (on && !picker.classList.contains("open")) {
      t.classList.add("keep");
      t.addEventListener("blur", () => t.classList.remove("keep"), { once: true });
    }
    onChange?.(matches());
  };
  picker.addEventListener("click", onPick);

  // the other tags lay in below the fold: bring the whole picker into view (a one-off, user-triggered scroll; never past the top of the picker)
  function reveal(): void {
    const r = picker?.getBoundingClientRect() as DOMRect;
    const top = (root.querySelector("#nav")?.getBoundingClientRect().height ?? 80) + 16; // under the nav bar
    const bottom = window.innerHeight - 28;
    let d = r.bottom > bottom ? r.bottom - bottom : 0;
    if (r.top - d < top) d = Math.max(0, r.top - top);
    if (d > 8) window.scrollBy({ top: d, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }
  const onMore = (): void => {
    const open = picker.classList.toggle("open");
    more.setAttribute("aria-expanded", String(open));
    root.dispatchEvent(new Event("orbit:layout"));
    if (open) frames = requestAnimationFrame(() => (frames = requestAnimationFrame(reveal)));
  };
  more.addEventListener("click", onMore);
  onChange?.(matches());

  return () => {
    picker.removeEventListener("click", onPick);
    more.removeEventListener("click", onMore);
    cancelAnimationFrame(frames);
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
    for (const m of members) m.classList.remove("match");
    for (const t of tags) t.classList.remove("deny", "keep");
  };
}
