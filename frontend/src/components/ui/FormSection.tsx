import { useId, type ComponentProps, type ReactNode } from "react";

// ════════════════════════════════════════════════════════════════════
// Foundry · FormSection and FieldGroup (Lumen)
//
// FormSection is the card a form sits in: one Panel (a hairline and a whisper of top light, 14 px
// corners) with an optional title and one-sentence description, the fields stacked 24 px apart. It
// replaces the pasted `form.space-y-5 rounded-2xl bg-bg-card border border-border p-8`.
//
//   as           "form" (the common case: carries onSubmit, ref, noValidate …), "section" or "div"
//   title        an h2 by default (headingAs="h3" or "h4" under a heading the page already has); the card is named by it
//   description  one sentence under the title
//   tone         a Panel tone, for the odd card that is lit or a danger zone
//
// FieldGroup is a titled cluster of fields *inside* a form: a <fieldset> with a <legend>, a hairline
// above it (on a wrapper div; see the note in the component), an optional description. Use it for "Contact email" (a checkbox, a field, a checkbox) or
// "Who is this for?" (a radio set), where several controls answer one question. A single control is
// not a group; give it a <Field>.
//
// Never nest a FormSection in another Panel; stack FieldGroups inside it instead.
// ════════════════════════════════════════════════════════════════════

type Tone = "default" | "inset" | "plain" | "lit" | "danger";

export function FormSection({
  as = "div",
  title,
  description,
  headingAs: Heading = "h2",
  tone = "default",
  className = "",
  children,
  ...rest
}: {
  as?: "form" | "section" | "div";
  title?: ReactNode;
  description?: ReactNode;
  headingAs?: "h2" | "h3" | "h4";
  tone?: Tone;
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<"form">, "title">) {
  const titleId = useId();
  // typed as a form because its props are form props; a section or a div simply ignores the few that do not apply
  const Tag = as as "form";
  return (
    <Tag
      // a generic <div> may not carry a name (ARIA 1.2); a <form> or <section> that has a title is a named landmark
      aria-labelledby={title && as !== "div" ? titleId : undefined}
      {...rest}
      className={`lm-panel lm-formsec ${className}`}
      data-tone={tone === "default" ? undefined : tone}
    >
      {title || description ? (
        <div className="lm-formsec__head">
          {title ? (
            <Heading id={titleId} className="lm-formsec__title">
              {title}
            </Heading>
          ) : null}
          {description ? <p className="lm-formsec__desc">{description}</p> : null}
        </div>
      ) : null}
      {children}
    </Tag>
  );
}

export function FieldGroup({
  legend,
  description,
  className = "",
  children,
  ...rest
}: {
  legend: ReactNode;
  description?: ReactNode;
} & ComponentProps<"fieldset">) {
  // The rule and the air above sit on a wrapper, not on the fieldset: a fieldset strikes its legend through its own top border and
  // puts its padding under the legend, so a border or padding on it lands in the wrong place.
  return (
    <div className={`lm-group ${className}`}>
      <fieldset {...rest} className="lm-group__set">
        <legend className="lm-group__legend">{legend}</legend>
        {description ? <p className="lm-group__desc">{description}</p> : null}
        <div className="lm-group__body">{children}</div>
      </fieldset>
    </div>
  );
}
