#!/usr/bin/env bash
# Stop hook: run the project's tests when uncommitted code changed since the
# last passing run. A failure sends Claude back once.
# Override detection by putting a command in .claude/test-command.
set -u

parsed="$(python3 -c '
import json, sys
d = json.load(sys.stdin)
print("active" if d.get("stop_hook_active") else "idle", d.get("session_id") or "default")
')" || exit 0
[ "${parsed%% *}" = "active" ] && exit 0
session="${parsed#* }"

cd "${CLAUDE_PROJECT_DIR:-$PWD}" || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

changed="$(git status --porcelain -uall | cut -c4- |
  grep -Ev '(\.(md|mdx|txt|rst)$|^\.claude/|^CLAUDE(\.local)?\.md$)')"
[ -n "$changed" ] || exit 0

test_command() {
  if [ -s .claude/test-command ]; then
    head -n 1 .claude/test-command
  elif [ -f package.json ] && python3 -c '
import json, sys
t = json.load(open("package.json")).get("scripts", {}).get("test", "")
sys.exit(0 if t and "no test specified" not in t else 1)
'; then
    if [ -f pnpm-lock.yaml ]; then echo "pnpm test"
    elif [ -f yarn.lock ]; then echo "yarn test"
    elif [ -f bun.lockb ] || [ -f bun.lock ]; then echo "bun run test"
    else echo "npm test"; fi
  elif [ -f Makefile ] && grep -q '^test:' Makefile; then echo "make test"
  elif [ -f Cargo.toml ]; then echo "cargo test"
  elif [ -f go.mod ]; then echo "go test ./..."
  elif [ -d tests ] || [ -f pytest.ini ] || grep -qs '^\[tool\.pytest' pyproject.toml; then
    command -v pytest >/dev/null && echo "pytest -q"
  fi
}

cmd="$(test_command)"
[ -n "$cmd" ] || exit 0

state_dir="${TMPDIR:-/tmp}/claude-test-hook"
mkdir -p "$state_dir"
stamp="$state_dir/$session-$(pwd | sha256sum | cut -c1-16)"
fingerprint="$( { git status --porcelain -uall; git diff HEAD 2>/dev/null; git ls-files -o --exclude-standard -z | xargs -0 -r sha256sum; } | sha256sum)"
[ "$(cat "$stamp" 2>/dev/null)" = "$fingerprint" ] && exit 0

if output="$(bash -c "$cmd" 2>&1)"; then
  echo "$fingerprint" >"$stamp"
  exit 0
fi

{
  echo "Tests failed (\`$cmd\`). Fix the code or report the failure to the user."
  tail -n 60 <<<"$output"
} >&2
exit 2
