"use client";

import { Tab, TabList, Tabs } from "@/components/ui/Tabs";
import type { AiMode } from "@/lib/ai/types";

const MODE_LABEL: Record<AiMode, string> = {
  recruiter: "Find candidates",
  network: "Build your network",
  opportunities: "Find opportunities",
};

// The one true tablist in the product: role=tablist / tab / aria-selected, now with a roving tabindex and
// arrow keys. `panels={false}` because the modes switch the whole search below, not a TabPanel.
export function ModeTabs({
  modes, mode, onSwitch,
}: {
  modes: AiMode[];
  mode: AiMode;
  onSwitch: (m: AiMode) => void;
}) {
  if (modes.length <= 1) return null;
  return (
    <Tabs<AiMode> value={mode} onValueChange={onSwitch} panels={false}>
      <TabList label="Search mode">
        {modes.map((m) => (
          <Tab key={m} value={m}>{MODE_LABEL[m]}</Tab>
        ))}
      </TabList>
    </Tabs>
  );
}
