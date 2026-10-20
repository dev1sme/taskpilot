#!/bin/sh
# Stands in for claude in e2e runs: prints how it was started, then echoes every input line.
echo "fake claude $1 $2"
while read -r line; do echo "got:$line"; done
