@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist target\claude-task-board.jar (
  java -jar target\claude-task-board.jar %*
) else (
  java -jar claude-task-board.jar %*
)
pause
