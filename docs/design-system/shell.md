# The app shell

The signed-in frame (`components/app/AppShell.tsx` and `Sidebar.tsx`, styled by `design-system/shell.css`). Desktop: a labelled rail on the left, sticky at full height. Below `lg` (1024 px):
an app bar with a menu control and the roundel, and the same rail as a drawer from the left.

**The idea: the ring is the cursor.** Every row of the rail has a ring's worth of room at its left, empty until the row is the page you are on (or is pointed at); then the ring draws round
the icon and lights. It is the landing page's roundel cursor, kept for an app that needs words beside its marks. Nothing else in the rail is lit, so the one lit ring is what you see.
While a navigation is in flight the row's ring turns (and a hairline sweeps the top of the viewport): `LinkPending`.

## Anatomy

- **Brand**: the roundel alone, 48 px (never a word beside it; the lockup does not fit a rail with a control beside it). It links to `/home`.
- **Primary rows** (Home, Community, Meet the Committee, Members, Foundry AI, Connections, Messaging when enabled, Opportunities, Events, Grants & VCs), a hairline, **secondary rows** (Notifications, Calendar,
  My activity, My submissions, Settings). A member still in review sees "Return to home" and Settings only.
- **Footer**: Admin (admins only, an outlined row), the profile row (initial in a ring, name, "View profile"), Sign out.
- **Collapsed** (desktop, remembered in `localStorage` under `foundry.nav.collapsed`): a column of rings, 92 px wide. Labels stay in the page, only drawn away, so every destination keeps its accessible name; `title` is the pointer's tooltip.
- **Phone**: the app bar is 76 px (a 45 px ring plus a quarter of the mark's height clear). The drawer is the same rail, opaque, never collapsed, with a "Close navigation" control that takes focus when it opens;
  Escape and the scrim close it, focus returns to the menu control, and it closes by itself if the window grows to a desktop.

## Contract (tests and users rely on it)

One `<nav aria-label="Main">`; link names and hrefs fixed; `aria-current="page"` on the active row (the lit ring is drawn from it: `.lm-navitem[aria-current="page"]`); buttons "Collapse navigation" / "Expand navigation" /
"Open navigation" / "Close navigation"; the count badges (`PendingBadge`, `UnreadBadge`) fail to nothing. `AppShell` draws no background: the atmosphere shows behind every member page, so never give a page wrapper an opaque one.

## Changing it

- Add or rename a destination: `PRIMARY` / `SECONDARY` in `Sidebar.tsx` (pick an `Icon` name from `icons/names.ts`); keep the `NavKey` list in step with the pages that pass `active`.
- Widths and the bar height are tokens (`--rail-width`, `--rail-width-collapsed`, `--appbar-height`).
- How a row, the ring or the bar looks: `shell.css`, which reads only tokens.
