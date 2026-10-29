#!/usr/bin/env bash
# Creates a project release policy that pre-fills every guarded release with the
# demo settings: randomise on `device`, both regression metrics, auto-rollback,
# four ~1-minute steps (10 → 25 → 50 → 100). Release policies are a beta API;
# the Terraform resource is also beta, so we use the API directly.
#
# Steps are CUMULATIVE target allocations in 1/1000ths of a percent, and must strictly
# increase: 25000 = 25%, then 50000 = 50%. 100% is implicit when the phase ends, so do not
# add a 100% stage. (An earlier version of this comment claimed the values were incremental
# additions; they are not, and the UI rejects non-increasing steps.)
source "$(dirname "$0")/_common.sh"

STEP_MS="${STEP_MS:-60000}"            # 1 minute per step; shortest the API accepts
MIN_SAMPLE="${MIN_SAMPLE:-50}"         # low so a 15% cohort at 10% exposure still qualifies

echo "Creating release policy 'demo-guarded-1min' in project $LD_PROJECT_KEY ..."
ld_api POST "/api/v2/projects/$LD_PROJECT_KEY/release-policies" "{
  \"key\": \"demo-guarded-1min\",
  \"name\": \"Demo: guarded, 1-minute steps\",
  \"description\": \"Cohort-release demo pacing. Four short steps so each phase completes in under 5 minutes.\",
  \"releaseMethod\": \"guarded-release\",
  \"scope\": { \"environmentKeys\": [\"$LD_ENVIRONMENT_KEY\"], \"flagTagKeys\": [\"demo\"] },
  \"guardedReleaseConfig\": {
    \"rolloutContextKindKey\": \"device\",
    \"minSampleSize\": $MIN_SAMPLE,
    \"rollbackOnRegression\": true,
    \"metricKeys\": [\"render-error\", \"screen-load-ms\"],
    \"stages\": [
      { \"allocation\": 10000, \"durationMillis\": $STEP_MS },
      { \"allocation\": 15000, \"durationMillis\": $STEP_MS },
      { \"allocation\": 25000, \"durationMillis\": $STEP_MS },
      { \"allocation\": 50000, \"durationMillis\": $STEP_MS }
    ]
  }
}" "LD-API-Version: beta" | sed 's/^/  /'
echo
echo "Done. Verify: Project settings → Release settings → policy appears and is top priority for $LD_ENVIRONMENT_KEY."
echo "If the API rejects a field, create the same policy in the UI using the values above (runbook.md § Pre-flight)."
