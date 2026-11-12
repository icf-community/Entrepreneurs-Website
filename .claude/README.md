# Project assistant tooling

Project skills, sub-agent definitions, shared settings and hooks are versioned.
Keep personal permissions in `settings.local.json` (ignored). Worktrees and
scheduled-task state are also ignored.

Most entries in `skills/` are relative symlinks to the checked-in
`.agents/skills/` packages. Preserve symlinks when cloning. `skills-lock.json`
records upstream sources and hashes; review upstream updates as code changes.
`frontend-design` and `graphify` are local installed packages in this directory.
The Cloudflare security audit skill is available as `skills/security-audit`.

Hooks require `graphify`, `python3`, Node.js and npm on PATH. Claude supplies
`CLAUDE_PROJECT_DIR` to locate the repository; no personal absolute paths are
required. The React Doctor hook currently resolves its upstream CLI through npm,
so it requires network access and should run only in trusted working copies.

Sub-agent definitions in `agents/` are the current project configuration; removed
definitions are intentionally not restored from history.
