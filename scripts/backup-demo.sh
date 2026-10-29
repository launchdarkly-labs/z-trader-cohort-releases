#!/usr/bin/env bash
# Snapshots the working demo: source files + the LaunchDarkly configuration that
# the demo depends on. Secrets (.env) are never copied.
#
#   ./scripts/backup-demo.sh                 -> backups/<timestamp>/
#   ./scripts/backup-demo.sh pre-observability  -> backups/<timestamp>-pre-observability/
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
label="${1:-}"
stamp="$(date +%Y%m%d-%H%M%S)"
dest="$root/backups/$stamp${label:+-$label}"
mkdir -p "$dest/code"

echo "Snapshot -> $dest"

# ---- source (no node_modules, no .env) ----------------------------------
for item in app scripts launchdarkly README.md runbook.md .env.example .gitignore; do
  [[ -e "$root/$item" ]] || continue
  rsync -a --exclude 'node_modules' --exclude '.env' "$root/$item" "$dest/code/"
done
echo "  ✓ code copied ($(find "$dest/code" -type f | wc -l | tr -d ' ') files)"

# ---- LaunchDarkly configuration -----------------------------------------
set -a; . "$root/.env"; set +a
if [[ -z "${LAUNCHDARKLY_ACCESS_TOKEN:-}" || "$LAUNCHDARKLY_ACCESS_TOKEN" == REPLACE_WITH* || "$LAUNCHDARKLY_ACCESS_TOKEN" == *"00000000-0000"* ]]; then
  echo "  ! no usable API token; skipping LaunchDarkly export"
else
  ENVK="${LD_ENVIRONMENT_KEY:-production}"
  api() { curl -sS -H "Authorization: $LAUNCHDARKLY_ACCESS_TOKEN" ${2:+-H "$2"} "https://app.launchdarkly.com$1"; }
  mkdir -p "$dest/launchdarkly-state"
  for f in dark-mode pnl-display dark-mode-ios18 dark-mode-ios17 dark-mode-ios16; do
    api "/api/v2/flags/$LD_PROJECT_KEY/$f?env=$ENVK" > "$dest/launchdarkly-state/flag-$f.json"
  done
  for s in ios-18-plus ios-17 ios-16-and-older; do
    api "/api/v2/segments/$LD_PROJECT_KEY/$ENVK/$s" > "$dest/launchdarkly-state/segment-$s.json"
  done
  for m in render-error screen-load-ms order-placed; do
    api "/api/v2/metrics/$LD_PROJECT_KEY/$m" > "$dest/launchdarkly-state/metric-$m.json"
  done
  api "/api/v2/projects/$LD_PROJECT_KEY/release-policies" "LD-API-Version: beta" > "$dest/launchdarkly-state/release-policies.json"
  api "/api/v2/projects/$LD_PROJECT_KEY/environments/$ENVK" > "$dest/launchdarkly-state/environment.json"
  api "/api/v2/projects/$LD_PROJECT_KEY/context-kinds" > "$dest/launchdarkly-state/context-kinds.json"
  api "/api/v2/projects/$LD_PROJECT_KEY/experimentation-settings" > "$dest/launchdarkly-state/experimentation-settings.json"
  echo "  ✓ LaunchDarkly state exported ($(ls "$dest/launchdarkly-state" | wc -l | tr -d ' ') files)"

  # Human-readable summary of the targeting that the demo depends on.
  python3 - "$dest" <<'PY' > "$dest/TARGETING.txt"
import json, glob, os, sys
dest = sys.argv[1]
for path in sorted(glob.glob(os.path.join(dest, "launchdarkly-state", "flag-*.json"))):
    f = json.load(open(path))
    env = f["environments"][list(f["environments"])[0]]
    V = f.get("variations", [])
    v = lambda i: json.dumps(V[i].get("value")) if 0 <= i < len(V) else "?"
    print("%-20s %s" % (f["key"], "ON" if env.get("on") else "OFF"))
    for r in env.get("rules") or []:
        served = v(r["variation"]) if "variation" in r else "ROLLOUT"
        print("    %-34s -> %s" % ((r.get("description") or "(no description)")[:34], served))
    ft = env.get("fallthrough") or {}
    print("    %-34s -> %s" % ("default rule", v(ft["variation"]) if "variation" in ft else "rollout"))
PY
  echo "  ✓ TARGETING.txt written"
fi

cat > "$dest/RESTORE.md" <<EOF
# Snapshot $stamp${label:+ ($label)}

Taken while the demo was confirmed working.

## Restore the code

    ./scripts/restore-demo.sh $(basename "$dest")

That copies \`code/\` back over app/, scripts/, launchdarkly/ and the docs.
\`.env\` and \`node_modules\` are untouched, so your keys and deps survive.

## Restore LaunchDarkly targeting

    ./scripts/reset-flags.sh

Resets the five flags to the baseline in TARGETING.txt: dark-mode on with
iOS 18+ serving true and the other two cohorts false; the three per-OS flags
on with the same shape. Also removes any leftover catch-all rules.

## What is in here

- \`code/\` — source at snapshot time (no node_modules, no .env)
- \`launchdarkly-state/\` — raw API exports of flags, segments, metrics,
  release policies, environment settings, context kinds
- \`TARGETING.txt\` — readable summary of the flag targeting
EOF
echo "  ✓ RESTORE.md written"
echo
echo "Done. Restore code with: ./scripts/restore-demo.sh $(basename "$dest")"
