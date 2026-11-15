import type { ReactNode } from "react";

// ═════════════════════════════════════════════════════════════════
// Foundry · Timeline (Lumen)
//
// A programme or a history, in order: a hairline down the left, a ring on it at each
// step, the step's words beside the ring. The last step's ring is lit, the way the
// masthead rule lights its end (turned upright), so a programme reads as going
// somewhere. Nothing moves.
//
//   when    where the step sits in time ("January", "Late March"), in sentence case
//   title   what happens (a heading, an h3 by default: a Timeline sits inside a Section)
//   body    one or two sentences
//
// The markup is an ordered list, so a screen reader hears "list, 4 items" and each
// step's words in the order they are drawn. A server component.
// ═════════════════════════════════════════════════════════════════

export type TimelineItem = {
  when: string;
  title: string;
  body?: ReactNode;
};

export function Timeline({
  items,
  titleAs: Title = "h3",
  className = "",
}: {
  items: readonly TimelineItem[];
  /** The element each step's title is: a heading one level under the Section that holds the list, or a plain paragraph. */
  titleAs?: "h3" | "h4" | "p";
  className?: string;
}) {
  return (
    <ol className={`lm-timeline ${className}`.trim()}>
      {items.map((item) => (
        <li key={`${item.when}|${item.title}`} className="lm-timeline__item">
          <p className="lm-timeline__when">{item.when}</p>
          <Title className="lm-timeline__title">{item.title}</Title>
          {item.body ? <p className="lm-timeline__body">{item.body}</p> : null}
        </li>
      ))}
    </ol>
  );
}
