#!/usr/bin/env bash
# Casper Carbon — one-command demo.
# Starts all three agents + the dashboard, opens the browser when ready.
# Ctrl-C stops everything.
set -u
cd "$(dirname "$0")"

PORT="${PORT:-3000}"
PIDS=()

cleanup() {
  echo ""
  echo "Stopping demo..."
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null; done
  # next start spawns children; make sure the port is freed
  lsof -ti ":$PORT" 2>/dev/null | xargs kill 2>/dev/null
  wait 2>/dev/null
  exit 0
}
trap cleanup INT TERM

# Prefix each line of a command's output with a colored tag
run() { # run <color> <tag> <dir> <cmd...>
  local color="$1" tag="$2" dir="$3"; shift 3
  ( cd "$dir" && "$@" 2>&1 | while IFS= read -r line; do
      printf "\033[%sm[%s]\033[0m %s\n" "$color" "$tag" "$line"
    done ) &
  PIDS+=($!)
}

echo "⬡ Casper Carbon demo — starting agents + dashboard"
echo ""

run 36 verifier   agents npm run --silent verifier
run 35 compliance agents npm run --silent compliance
run 33 market     agents npm run --silent market

if [ ! -d web/.next ]; then
  echo "[web] first run — building dashboard..."
  ( cd web && npm run --silent build ) || { echo "web build failed"; cleanup; }
fi
run 32 web web npm run --silent start -- -p "$PORT"

# Open the dashboard once it responds
(
  for _ in $(seq 1 60); do
    if curl -sf "http://localhost:$PORT" >/dev/null 2>&1; then
      echo "✅ Dashboard ready → http://localhost:$PORT"
      command -v open >/dev/null && open "http://localhost:$PORT"
      exit 0
    fi
    sleep 1
  done
  echo "⚠ Dashboard did not come up on port $PORT"
) &
PIDS+=($!)

wait
