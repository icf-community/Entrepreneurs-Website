"use client";

import type { ComponentProps, Ref } from "react";
import { Icon } from "@/design-system/icons/Icon";

// ════════════════════════════════════════════════════════════════════
// Foundry · SearchField (Lumen)
//
// A pill with a glass on the left and a clear button on the right that appears once
// there is something to clear. It is a controlled <input type="search">, so the
// parent owns the value (the filter boxes keep theirs in a debounced draft).
//
//   label         the accessible name. These boxes have no visible label; a placeholder is
//                 not a name.
//   inputRef      the <input>, for the one caller that moves focus into it
//   className     goes on the wrapper, which is where the layout margin belongs
//
// The clear button is named "Clear search" and returns focus to the input, so a keyboard
// user can wipe the box and keep typing.
// ════════════════════════════════════════════════════════════════════

export function SearchField({
  label,
  value,
  onChange,
  placeholder,
  className = "",
  inputRef,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
} & Omit<ComponentProps<"input">, "value" | "onChange" | "type" | "className" | "placeholder" | "ref">) {
  return (
    <div className={`lm-search ${className}`}>
      <Icon name="search" size={20} className="lm-search__icon" />
      <input
        spellCheck={false}
        autoComplete="off"
        {...rest}
        ref={inputRef}
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="lm-field"
      />
      {value ? (
        <button
          type="button"
          className="lm-search__clear"
          aria-label="Clear search"
          onClick={(e) => {
            onChange("");
            e.currentTarget.closest(".lm-search")?.querySelector("input")?.focus();
          }}
        >
          <Icon name="close" size={18} />
        </button>
      ) : null}
    </div>
  );
}
