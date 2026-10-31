#!/usr/bin/env bash
# PostToolUse hook: format only the edited file, and only with a formatter
# the project itself has configured.
set -u

root="${CLAUDE_PROJECT_DIR:-$PWD}"
file="$(python3 -c '
import json, sys
d = json.load(sys.stdin)
print((d.get("tool_response") or {}).get("filePath") or (d.get("tool_input") or {}).get("file_path") or "")
')"
[ -n "$file" ] && [ -f "$file" ] || exit 0
case "$file" in "$root"/*) ;; *) exit 0 ;; esac
cd "$root" || exit 0

has_tool_section() { [ -f pyproject.toml ] && grep -q "^\[tool\.$1" pyproject.toml; }
has_file() { compgen -G "$1" >/dev/null; }

case "$file" in
  *.js|*.jsx|*.mjs|*.cjs|*.ts|*.tsx|*.json|*.css|*.scss|*.html|*.vue|*.svelte|*.md|*.yml|*.yaml)
    if [ -x node_modules/.bin/biome ] && has_file 'biome.json*'; then
      node_modules/.bin/biome format --write --no-errors-on-unmatched "$file"
    elif [ -x node_modules/.bin/prettier ] &&
      { has_file '.prettierrc*' || has_file 'prettier.config.*' ||
        { [ -f package.json ] && grep -q '"prettier"[[:space:]]*:[[:space:]]*[{"]' package.json; }; }; then
      node_modules/.bin/prettier --write --ignore-unknown "$file"
    fi
    ;;
  *.py)
    if command -v ruff >/dev/null && { has_file 'ruff.toml' || has_file '.ruff.toml' || has_tool_section ruff; }; then
      ruff format "$file"
    elif command -v black >/dev/null && has_tool_section black; then
      black -q "$file"
    fi
    ;;
  *.go)
    if [ -f go.mod ] && command -v gofmt >/dev/null; then gofmt -w "$file"; fi
    ;;
  *.rs)
    if [ -f Cargo.toml ] && command -v rustfmt >/dev/null; then rustfmt "$file"; fi
    ;;
esac >/dev/null 2>&1

exit 0
