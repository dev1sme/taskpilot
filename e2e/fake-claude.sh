#!/bin/sh
# Stands in for claude in e2e runs: prints how it was started, then echoes every input line.
if [ "$1" = "--version" ]; then
  echo "claude 2.1.101 (fake)"
  exit 0
fi
# Opt-in hook scenarios share the PTY parser; legacy terminal tests keep their echo fixture.
if [ -n "$FAKE_CLAUDE_SCENARIO" ]; then
  TASKPILOT_FAKE_AGENT=claude exec "$(dirname "$0")/fake-copilot.sh" "$@"
fi
echo "fake claude $1 $2"
while read -r line; do echo "got:$line"; done
