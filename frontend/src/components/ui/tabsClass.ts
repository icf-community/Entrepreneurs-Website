// ════════════════════════════════════════════════════════════════════
// Foundry · tabs, the class helpers (Lumen)
//
// The look of every tab and segmented control lives in design-system/data.css
// (.lm-tabs, .lm-tab) and reads the state off the ARIA attribute the markup
// already carries: aria-current (links, and buttons in a nav), aria-pressed
// (toggle buttons) or aria-selected (true tabs). So a site that has to keep its
// own markup (and its exact semantics) can take the look with two class
// strings and change nothing else:
//
//   <div className={tabsClass({ variant: "segmented" })}>
//     <button aria-pressed={on} className={tabClass}>Cards</button>
//
// No directive on purpose: server components may call these.
// ════════════════════════════════════════════════════════════════════

/** line: text tabs on a hairline, a rule draws under the current one.  segmented: a pill holding two or three short choices. */
export type TabsVariant = "line" | "segmented";
export type TabsSize = "sm" | "md";

export type TabsStyle = {
  variant?: TabsVariant;
  size?: TabsSize;
  /** The tabs share the width of their container equally. */
  fill?: boolean;
  className?: string;
};

/** The class string of a tab strip (the element that holds the tabs). */
export function tabsClass({ variant = "line", size = "md", fill = false, className = "" }: TabsStyle = {}): string {
  return [
    "lm-tabs",
    variant === "segmented" ? "lm-tabs--segmented" : "",
    size === "sm" ? "lm-tabs--sm" : "",
    fill ? "lm-tabs--fill" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

/** The class of one tab (a button or a link inside a strip). */
export const tabClass = "lm-tab";
