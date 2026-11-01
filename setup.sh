#!/usr/bin/env bash

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)

DESTINATION=${1:-$PWD}

cp -r $SCRIPT_DIR/claude $DESTINATION/.claude
cp CLAUDE.md $DESTINATION/

echo "CLAUDE.local.md" >> .gitignore
