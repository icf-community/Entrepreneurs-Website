#!/usr/bin/env bash
# PostToolUse hook: runs react-doctor on any frontend file just written/edited
# by Claude, so every future frontend change is checked automatically instead
# of relying on a manual full-repo pass at the end of a session.
set -euo pipefail

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)}"
FRONTEND_DIR="$REPO_ROOT/frontend"

input="$(cat)"

file_path="$(echo "$input" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
ti = data.get("tool_input", {}) or {}
path = ti.get("file_path") or ti.get("path") or ""
print(path)
' 2>/dev/null || true)"

[ -z "$file_path" ] && exit 0

# Only check frontend source files with a .ts/.tsx extension.
case "$file_path" in
  "$FRONTEND_DIR"/src/*.ts|"$FRONTEND_DIR"/src/*.tsx) ;;
  *) exit 0 ;;
esac

rel_path="${file_path#"$FRONTEND_DIR"/}"

cd "$FRONTEND_DIR"
output="$(npx react-doctor@latest "$rel_path" --no-cache 2>&1 || true)"

if echo "$output" | grep -q "No issues found"; then
  exit 0
fi

# Issues found: block and feed the report back to Claude so it fixes them
# before moving on, instead of accumulating lint debt silently.
python3 -c '
import json, sys
report = sys.stdin.read()
rel = sys.argv[1]
msg = f"react-doctor found issues in {rel} — fix them now before continuing:\n\n{report}"
print(json.dumps({"decision": "block", "reason": msg}))
' "$rel_path" <<< "$output"
exit 0
