import Link from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import type { ButtonSize, ButtonVariant } from "./Button";

// A link drawn as a button: the same .lm-btn shapes as <Button>, on an <a>.
// Internal hrefs go through next/link (prefetch, client navigation); anything
// with a protocol, a hash or a mailto: stays a plain anchor. About 116 call
// sites used to paste the button class string onto a link by hand.
export function ButtonLink({
  href,
  variant = "primary",
  size = "lg",
  lit = false,
  leading,
  className = "",
  children,
  ...rest
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  lit?: boolean;
  leading?: ReactNode;
  children: ReactNode;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "children">) {
  const common = {
    ...rest,
    "data-variant": variant,
    "data-size": size,
    "data-lit": lit || undefined,
    className: `lm-btn ${className}`,
  };
  const body = (
    <>
      {leading}
      {children}
    </>
  );
  const internal = href.startsWith("/") && !href.startsWith("//");
  return internal ? (
    <Link href={href} {...common}>
      {body}
    </Link>
  ) : (
    <a href={href} {...common}>
      {body}
    </a>
  );
}
