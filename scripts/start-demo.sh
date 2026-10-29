#!/usr/bin/env bash
# Starts everything needed for the cohort-release demo:
#   - app/demo.js       trader app + fleet wall on ONE page (background)
#   - app/simulator.js  traffic + live dashboard (foreground, this terminal)
# Opens the page in your browser, prints the current dark-mode targeting, and
# shuts the background service down when you Ctrl+C the simulator.
#
# viewer.js (wall only) and trader.js (app only) still run standalone if wanted.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app="$root/app"
DEMO_PORT_="${DEMO_PORT:-8765}"
DEMO_LOG="${TMPDIR:-/tmp}/brokerage-demo.log"

# Node was installed by hand under ~/.local/node and may not be on PATH
# in a non-login shell, so add it defensively.
[[ -d "$HOME/.local/node/bin" ]] && PATH="$HOME/.local/node/bin:$PATH"

step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }

step "Pre-flight"

command -v node >/dev/null || { bad "node not found. Install Node 18+ or add ~/.local/node/bin to PATH."; exit 1; }
ok "node $(node -v)"

[[ -f "$root/.env" ]] || { bad "$root/.env missing. Copy .env.example to .env and fill in your keys."; exit 1; }
set -a; . "$root/.env"; set +a

if [[ -z "${LD_SDK_KEY:-}" || "$LD_SDK_KEY" == REPLACE_WITH* || "$LD_SDK_KEY" == *"00000000-0000"* ]]; then
  bad "LD_SDK_KEY is missing or still the placeholder in $root/.env"; exit 1
fi
ok "LD_SDK_KEY set (${#LD_SDK_KEY} chars)"
ok "project ${LD_PROJECT_KEY:-?} / env ${LD_ENVIRONMENT_KEY:-production}"

if [[ -z "${LD_CLIENT_SIDE_ID:-}" || "$LD_CLIENT_SIDE_ID" == REPLACE_WITH* || "$LD_CLIENT_SIDE_ID" == 0000* ]]; then
  bad "LD_CLIENT_SIDE_ID missing in .env - the page needs it for the trader app half"
  exit 1
fi
ok "LD_CLIENT_SIDE_ID set"

[[ -d "$app/node_modules" ]] || { step "Installing dependencies"; (cd "$app" && npm install --no-fund --no-audit); }
ok "dependencies present"

# Never leave two simulators running - duplicate traffic makes the dashboard lie.
if pgrep -f "node simulator.js" >/dev/null || pgrep -f "node viewer.js" >/dev/null \
   || pgrep -f "node trader.js" >/dev/null || pgrep -f "node demo.js" >/dev/null; then
  step "Stopping previous run"
  for proc in "node simulator.js" "node viewer.js" "node trader.js" "node demo.js"; do
    pkill -INT -f "$proc" 2>/dev/null || true
  done
  sleep 3
  ok "old processes stopped"
fi

# Show what the flag is actually set to - state drift is the usual cause of a
# demo that "does nothing". Needs the API token; skipped if absent.
if [[ -n "${LAUNCHDARKLY_ACCESS_TOKEN:-}" && "$LAUNCHDARKLY_ACCESS_TOKEN" != REPLACE_WITH* && "$LAUNCHDARKLY_ACCESS_TOKEN" != *"00000000-0000"* ]]; then
  step "Current dark-mode targeting (${LD_ENVIRONMENT_KEY:-production})"
  curl -sS -H "Authorization: $LAUNCHDARKLY_ACCESS_TOKEN" \
    "https://app.launchdarkly.com/api/v2/flags/$LD_PROJECT_KEY/dark-mode?env=${LD_ENVIRONMENT_KEY:-production}" \
  | python3 -c '
import sys, json
f = json.load(sys.stdin)
e = f["environments"][list(f["environments"])[0]] if "environments" in f else {}
V = f.get("variations", [])
v = lambda i: json.dumps(V[i].get("value")) if 0 <= i < len(V) else "?"
print("  targeting:", "ON" if e.get("on") else "OFF  <-- turn it on before demoing")
for r in e.get("rules") or []:
    d = r.get("description") or "(NO DESCRIPTION - leftover rule, remove it)"
    print("  %-30s -> %s" % (d[:30], v(r["variation"]) if "variation" in r else "ROLLOUT ACTIVE"))
ft = e.get("fallthrough") or {}
print("  default rule                   ->", v(ft["variation"]) if "variation" in ft else "rollout")
' || bad "could not read flag state (continuing anyway)"
fi

wait_for() { # wait_for PORT
  for _ in $(seq 1 30); do
    curl -sS -o /dev/null --max-time 1 "http://localhost:$1" 2>/dev/null && return 0
    sleep 0.4
  done
  return 1
}

step "Starting the demo page"
( cd "$app" && nohup node demo.js > "$DEMO_LOG" 2>&1 & )
if wait_for "$DEMO_PORT_"; then
  ok "trader app + fleet wall   http://localhost:$DEMO_PORT_  (log: $DEMO_LOG)"
  command -v open >/dev/null && open "http://localhost:$DEMO_PORT_"
else
  bad "demo page did not come up - see $DEMO_LOG"
fi

cleanup() {
  printf '\n'
  pkill -INT -f "node demo.js" 2>/dev/null || true
  printf 'Demo page stopped. Demo shut down.\n'
}
trap cleanup EXIT

step "Starting traffic simulator (Ctrl+C stops everything)"
sleep 1
cd "$app" && exec node simulator.js
