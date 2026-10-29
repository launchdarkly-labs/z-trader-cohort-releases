#!/usr/bin/env bash
# Stops the simulator and device wall. SIGINT so the SDK flushes queued events.
set -uo pipefail
stopped=0
for proc in "node simulator.js" "node demo.js" "node viewer.js" "node trader.js"; do
  if pgrep -f "$proc" >/dev/null; then
    pkill -INT -f "$proc" && echo "stopping $proc ..." && stopped=1
  fi
done
[[ $stopped -eq 0 ]] && { echo "Nothing was running."; exit 0; }
sleep 5
still() { pgrep -f "node simulator.js" >/dev/null || pgrep -f "node demo.js" >/dev/null \
        || pgrep -f "node viewer.js" >/dev/null || pgrep -f "node trader.js" >/dev/null; }
if still; then
  echo "Still running after SIGINT; sending again."
  for proc in "node simulator.js" "node demo.js" "node viewer.js" "node trader.js"; do
    pkill -f "$proc" 2>/dev/null || true
  done
  sleep 2
fi
if still; then echo "WARNING: something is still running"
else echo "All demo services stopped (events flushed)."; fi
