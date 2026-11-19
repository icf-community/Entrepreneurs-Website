import type { ReactNode } from "react";
import { Icon } from "@/design-system/icons/Icon";
import type { IconName } from "@/design-system/icons/names";

// ════════════════════════════════════════════════════════════════════
// Foundry · Notice (Lumen)
//
// The one banner every callout in the product is built from: the error above a
// form, the confirmation after a save, the incident strip over every page, the
// "this is waiting on a review" note, the "something went wrong loading this"
// message. A hairline and a wash in the tone's light, a drawn icon in a ring,
// the words in ink. The tone is carried by the line, the wash and the icon,
// never by a coloured stripe and never by colour alone: there are always words.
//
//   info     the cold light: something to know
//   lit      amber: something to look at (a review waiting, a listing about to expire)
//   danger   something went wrong
//   success  something went right
//
// `role` is the caller's choice, because only the caller knows how the notice
// arrives: role="alert" (assertive) for a failure that interrupts, role="status"
// (polite) for news, none for a notice that was simply on the page. Notice adds
// no role of its own, and no hidden text inside the live region, so what a
// screen reader announces is exactly `children`.
//
// shape="bar" is the full-bleed strip that sits above a page. `title` and
// `action` are for the larger notice that needs them; most need only words.
// Give the in-text links inside `children` their underline (the .lm-notice__text
// rule does).
//
// A notice is a server component unless `onDismiss` is used, which needs a
// client parent (a function cannot cross from the server).
// ════════════════════════════════════════════════════════════════════

export type NoticeTone = "info" | "lit" | "danger" | "success";

const DEFAULT_ICON: Record<NoticeTone, IconName> = { info: "info", lit: "warning", danger: "error", success: "success" };

export function Notice({
  tone = "info",
  icon,
  title,
  action,
  onDismiss,
  dismissLabel = "Dismiss",
  shape = "box",
  role,
  className = "",
  children,
}: {
  tone?: NoticeTone;
  /** The drawn icon; each tone has its own. `false` draws none. */
  icon?: IconName | false;
  /** A short line above the words, for a notice that needs a heading. */
  title?: ReactNode;
  /** A button or link, below the words. */
  action?: ReactNode;
  /** Shows a dismiss control. The specs look for the label, so pass the one the old banner had. */
  onDismiss?: () => void;
  dismissLabel?: string;
  /** `bar` is full-bleed: no radius, a hairline underneath, the page's gutter at the sides. */
  shape?: "box" | "bar";
  role?: "alert" | "status" | "note";
  className?: string;
  children?: ReactNode;
}) {
  const glyph = icon === false ? null : (icon ?? DEFAULT_ICON[tone]);
  return (
    <div role={role} className={`lm-notice ${className}`} data-tone={tone} data-shape={shape === "bar" ? "bar" : undefined}>
      {glyph ? (
        <span className="lm-notice__icon" aria-hidden="true">
          <Icon name={glyph} size={shape === "bar" ? 16 : 18} />
        </span>
      ) : null}
      <div className="lm-notice__body">
        {title ? <p className="lm-notice__title">{title}</p> : null}
        {children ? <div className="lm-notice__text">{children}</div> : null}
        {action ? <div className="lm-notice__action">{action}</div> : null}
      </div>
      {onDismiss ? (
        <button type="button" className="lm-notice__x" aria-label={dismissLabel} onClick={onDismiss}>
          <Icon name="close" size={16} />
        </button>
      ) : null}
    </div>
  );
}
