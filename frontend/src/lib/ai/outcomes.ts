// One sentence per refusal or failure (owner preference, F22): what
// happened and what to do. The detail lives on /ai-notice.

const MESSAGES: Record<string, string> = {
  disabled: "AI search is switched off right now.",
  invalid_message: "Keep your search under 600 characters.",
  idempotency_conflict: "That search was already sent. Refresh the page and try again.",
  job_not_eligible: "Recruiter search is for open jobs you posted yourself.",
  requirements_unconfirmed: "Confirm this job's requirements before searching.",
  requirements_outdated: "This job changed since you opened it. Reload to see its current requirements.",
  not_found: "That conversation is no longer available.",
  stale_revision: "Your criteria changed in another tab. Refresh to see the latest.",
  thread_full: "This conversation has reached 15 searches. Start a new one to continue.",
  nothing_to_confirm: "There's nothing waiting to be confirmed.",
  too_many_threads: "You have five conversations already. Delete one to start another.",
  busy: "A search is already running. Wait for it to finish.",
  rate_minute: "That's a lot of searches in a minute. Try again shortly.",
  rate_day: "You've used today's 40 AI searches.",
  rescan_cooldown: "You can check for new matches again in a few minutes.",
  rescan_limit: "You've checked this job ten times today.",
  surface_limit: "You've seen today's limit of 150 people. It resets tomorrow.",
  queue_full: "AI search is busy right now. Your message is still here; try again in a minute.",
  budget_exhausted: "AI search has reached today's limit. It resets at midnight UTC.",
  named_person: "Search by skills and interests, not by someone's name.",
  unavailable: "AI search is temporarily unavailable. Try again shortly.",
  limited: "That's a lot of requests. Try again shortly.",
};

export function outcomeMessage(outcome: string | null | undefined): string {
  return (outcome && MESSAGES[outcome]) || "Something went wrong. Please try again.";
}

const STAGES: Record<string, string> = {
  queued: "Waiting to start…",
  understanding: "Reading your request…",
  searching: "Searching the directory…",
  assessing: "Checking evidence…",
  scoring: "Ranking results…",
};

export function stageLabel(stage: string | null | undefined): string {
  return (stage && STAGES[stage]) || "Working…";
}
