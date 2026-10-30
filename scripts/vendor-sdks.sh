#!/usr/bin/env bash
# Re-downloads the browser SDK bundles into app/vendor/.
#
# The demo page serves these itself rather than importing them from a CDN, so a
# CDN outage cannot blank the page mid-demo. See app/vendor/README.md.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$(dirname "$here")"
dest="$root/app/vendor"
mkdir -p "$dest"

# package@version : filename
PKGS=(
  "launchdarkly-js-client-sdk@3.9.5:ld-client.js"
  "@launchdarkly/observability@1.1.23:ld-observability.js"
  "@launchdarkly/session-replay@1.1.23:ld-session-replay.js"
)

for spec in "${PKGS[@]}"; do
  pkg="${spec%%:*}"; out="${spec##*:}"
  url="https://cdn.jsdelivr.net/npm/${pkg}/+esm"
  echo "fetching $pkg"
  tmp="$(mktemp)"
  if ! curl -sSfL --max-time 60 "$url" -o "$tmp"; then
    echo "  FAILED: $url — leaving the existing $out in place"; rm -f "$tmp"; continue
  fi
  # A CDN error page is not a module. Refuse to overwrite a good bundle with one.
  if ! grep -qE 'export\s*\{|export default' "$tmp"; then
    echo "  FAILED: $url did not return an ES module — leaving $out in place"; rm -f "$tmp"; continue
  fi
  mv "$tmp" "$dest/$out"
  echo "  wrote app/vendor/$out ($(wc -c < "$dest/$out" | tr -d ' ') bytes)"
done
echo
echo "Done. Restart the demo page to pick them up."
