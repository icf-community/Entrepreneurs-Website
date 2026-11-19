// ════════════════════════════════════════════════════════════════════
// Foundry · Divider (Lumen)
//
// The hairline with a small lit end: the same device as the rule that opens
// every masthead (PageHead). Use it to separate two things on a page that
// need more than space between them; between two rows of a list a plain
// hairline (border-border-subtle) is enough and quieter.
//
//   end="end"    the point of light at the right end (default) · "start" · "none"
//   vertical     a rule between two items in a row (the point sits at its foot)
//   decorative   true by default: hidden from assistive technology, which is
//                right for a rule that only draws a line. Pass false where it
//                really separates content, and it becomes role="separator".
//
// Server component.
// ════════════════════════════════════════════════════════════════════

export function Divider({
  end = "end",
  vertical = false,
  decorative = true,
  className = "",
}: {
  end?: "end" | "start" | "none";
  vertical?: boolean;
  decorative?: boolean;
  className?: string;
}) {
  return (
    <div
      role={decorative ? undefined : "separator"}
      aria-orientation={decorative ? undefined : vertical ? "vertical" : "horizontal"}
      aria-hidden={decorative ? true : undefined}
      className={`lm-divider ${className}`.trim()}
      data-end={end === "end" ? undefined : end}
      data-vertical={vertical || undefined}
    />
  );
}
