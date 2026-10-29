#!/usr/bin/env bash
# Shared helpers for the LaunchDarkly REST API scripts. Reads ../.env if present.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$root/.env" ]] && set -a && source "$root/.env" && set +a

: "${LAUNCHDARKLY_ACCESS_TOKEN:?Set LAUNCHDARKLY_ACCESS_TOKEN (Writer/Admin API token) in .env or the shell}"
: "${LD_PROJECT_KEY:?Set LD_PROJECT_KEY in .env or the shell}"
LD_ENVIRONMENT_KEY="${LD_ENVIRONMENT_KEY:-production}"
LD_API_BASE="${LD_API_BASE:-https://app.launchdarkly.com}"

ld_api() { # ld_api METHOD PATH [JSON_BODY] [EXTRA_HEADER]
  local method="$1" path="$2" body="${3:-}" extra="${4:-}"
  local args=(-sS -X "$method" "$LD_API_BASE$path"
    -H "Authorization: $LAUNCHDARKLY_ACCESS_TOKEN" -H "Content-Type: application/json")
  [[ -n "$extra" ]] && args+=(-H "$extra")
  [[ -n "$body" ]] && args+=(-d "$body")
  curl "${args[@]}"
}
