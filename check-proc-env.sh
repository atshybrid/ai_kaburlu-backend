#!/bin/bash
PID=$(pgrep -f "dist/index.js" | head -1)
echo "Process PID: $PID"
if [ -n "$PID" ]; then
  cat /proc/$PID/environ | tr '\0' '\n' | grep -i DATABASE
else
  echo "Process not found"
fi
