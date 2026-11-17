#!/bin/sh
# Finder can start with a shorter PATH than a terminal.
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH
cd "$(dirname "$0")" || exit 1
/bin/sh ./start.sh
status=$?
if [ "$status" -ne 0 ]; then
  printf '\nPress Enter to close this window. '
  read -r answer
fi
exit "$status"
