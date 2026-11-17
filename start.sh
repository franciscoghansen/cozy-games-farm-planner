#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js was not found. Install Node.js LTS (npm is included): https://nodejs.org/en/download' >&2
  exit 1
fi
exec node scripts/start-local.mjs
