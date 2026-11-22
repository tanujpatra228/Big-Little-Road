#!/usr/bin/env bash
# Starts the real Worker locally (the same runtime that hosts the rooms), waits for it, runs the
# end-to-end checks against it, and stops it. Used by CI before every deploy, and runnable by hand:
#   npm run build && bash scripts/ci-e2e.sh
# These checks exist because some bugs (a room forgetting its rules when it hibernates) only show up
# against the real runtime, never in the pure unit tests.
set -u
PORT="${PORT:-8788}"
export WRANGLER_SEND_METRICS=false
LOG="$(mktemp)"

npx wrangler dev --port "$PORT" >"$LOG" 2>&1 &
WRANGLER_PID=$!
cleanup() {
  kill "$WRANGLER_PID" 2>/dev/null
  pkill -P "$WRANGLER_PID" 2>/dev/null
  pkill -f "workerd" 2>/dev/null
  true
}
trap cleanup EXIT

for _ in $(seq 1 90); do
  curl -sf "http://localhost:$PORT/api/health" >/dev/null && break
  sleep 1
done
if ! curl -sf "http://localhost:$PORT/api/health" >/dev/null; then
  echo "The Worker did not start. Its log:"
  tail -40 "$LOG"
  exit 1
fi

# The checks use real timers, so one retry is allowed for a slow shared runner. A real bug fails twice.
if node scripts/net-smoke.mjs "http://localhost:$PORT"; then
  exit 0
fi
echo "--- first run failed, retrying once ---"
node scripts/net-smoke.mjs "http://localhost:$PORT"
