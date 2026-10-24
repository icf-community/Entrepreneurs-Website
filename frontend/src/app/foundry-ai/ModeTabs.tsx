"use client";

import type { AiMode } from "@/lib/ai/types";

const MODE_LABEL: Record<AiMode, string> = {
  recruiter: "Find candidates",
  network: "Build your network",
  opportunities: "Find opportunities",
};

export function ModeTabs({
  modes, mode, onSwitch,
}: {
  modes: AiMode[];
  mode: AiMode;
  onSwitch: (m: AiMode) => void;
}) {
  if (modes.length <= 1) return null;
  return (
    <div role="tablist" aria-label="Search mode" className="flex flex-wrap gap-2">
      {modes.map((m) => (
        <button
          key={m}
          role="tab"
          type="button"
          aria-selected={m === mode}
          onClick={() => onSwitch(m)}
          className={`cursor-pointer rounded-lg border px-4 py-2 text-[0.8rem] ${
            m === mode ? "border-accent bg-white/[0.08] text-text-primary" : "border-border-strong text-text-secondary hover:border-accent"
          }`}
        >
          {MODE_LABEL[m]}
        </button>
      ))}
    </div>
  );
}
