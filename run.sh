#!/usr/bin/env bash
cd "$(dirname "$0")"
JAR=claude-task-board.jar
[ -f target/claude-task-board.jar ] && JAR=target/claude-task-board.jar
exec java -jar "$JAR" "$@"
