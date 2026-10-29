#!/usr/bin/env bash
# Restores source files from a snapshot made by backup-demo.sh.
# Leaves .env and node_modules alone, so keys and installed deps survive.
#
#   ./scripts/restore-demo.sh                 -> list snapshots
#   ./scripts/restore-demo.sh <snapshot-name> -> restore it
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
snap="${1:-}"

if [[ -z "$snap" ]]; then
  echo "Snapshots in $root/backups:"
  ls -1 "$root/backups" 2>/dev/null | sed 's/^/  /' || echo "  (none)"
  echo
  echo "Usage: ./scripts/restore-demo.sh <snapshot-name>"
  exit 0
fi

src="$root/backups/$snap/code"
[[ -d "$src" ]] || { echo "No such snapshot: $root/backups/$snap"; exit 1; }

echo "Restoring from $snap"
echo "This overwrites app/, scripts/, launchdarkly/ and the docs. .env and node_modules are kept."
read -r -p "Continue? [y/N] " ok
[[ "$ok" == "y" || "$ok" == "Y" ]] || { echo "Aborted."; exit 1; }

# Stop anything running from the code we are about to replace.
pkill -INT -f "node simulator.js" 2>/dev/null || true
pkill -INT -f "node viewer.js" 2>/dev/null || true
sleep 2

rsync -a --exclude 'node_modules' --exclude '.env' "$src"/ "$root"/
echo "  ✓ code restored"
echo
echo "Next: ./scripts/reset-flags.sh   (put LaunchDarkly targeting back to baseline)"
echo "      ./scripts/start-demo.sh    (bring the demo back up)"
