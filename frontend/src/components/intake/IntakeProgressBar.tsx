import { ProgressBar } from "@/components/ui/ProgressBar";

/** The completeness progress bar between each screen's heading and its card: a hairline with a lit fill and a point of light at its
 *  leading edge, the words on the line beside it. Extracted out of IntakeFlow's render (structural only, no behavior change) to
 *  keep that component's size and complexity down. */
export function IntakeProgressBar({ pct }: { pct: number }) {
  return <ProgressBar layout="inline" value={pct} label="Profile completeness" end={`${pct}% profile complete`} />;
}
