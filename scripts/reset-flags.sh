#!/usr/bin/env bash
# Puts the five demo flags back to the known-good baseline and strips any
# leftover catch-all rules a rolled-back release left behind.
#
# Baseline: dark-mode ON  (iOS 18+ -> true, iOS 17 -> false, iOS 16 -> false)
#           dark-mode-ios18/17/16 ON, same shape on their own flags
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec python3 "$root/scripts/reset_flags.py" "$@"
