// The canonical names of the UI icon set. Components and pages import <Icon name="…" /> against this list; the drawings live in Icon.tsx.
// Add a name here and draw it there. Do not rename: call sites depend on these.
export const ICON_NAMES = [
  // where you can go (the app's destinations)
  "home", "community", "committee", "members", "foundry-ai", "connections", "messaging", "opportunities", "events", "vcs",
  "notifications", "calendar", "activity", "submissions", "settings", "profile", "sign-out", "admin",
  // arrows and chevrons
  "arrow-left", "arrow-right", "arrow-up", "arrow-down", "arrow-up-right", "chevron-left", "chevron-right", "chevron-up", "chevron-down", "expand", "collapse",
  // things you do
  "plus", "minus", "close", "check", "search", "filter", "sort", "bookmark", "bookmark-filled", "edit", "trash", "copy", "download", "upload", "share",
  "external", "link", "mail", "send", "refresh", "more", "menu", "grid", "list", "eye", "eye-off", "lock", "shield", "flag", "ban", "undo", "calendar-plus",
  "user-plus", "user-check", "sliders",
  // states
  "info", "warning", "error", "success",
  // things
  "clock", "pin", "globe", "user", "users", "github", "image", "file", "star", "spark", "tag",
] as const;
export type IconName = (typeof ICON_NAMES)[number];
