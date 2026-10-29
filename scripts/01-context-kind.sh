#!/usr/bin/env bash
# Creates/updates the `device` context kind and enables it for experiments
# and guarded rollouts. Idempotent. The Terraform provider has no context-kind
# resource, so this is done via the REST API.
source "$(dirname "$0")/_common.sh"

echo "Upserting context kind 'device' in project $LD_PROJECT_KEY ..."
ld_api PUT "/api/v2/projects/$LD_PROJECT_KEY/context-kinds/device" '{
  "name": "Device",
  "description": "Physical device running the trading app. Attributes: operating_system, os_version, model, app_version.",
  "hideInTargeting": false,
  "archived": false
}' >/dev/null

echo "Enabling 'device' for experiments and guarded rollouts ..."
ld_api PUT "/api/v2/projects/$LD_PROJECT_KEY/experimentation-settings" '{
  "randomizationUnits": [
    { "randomizationUnit": "user",   "default": true  },
    { "randomizationUnit": "device", "default": false }
  ]
}' | sed 's/^/  /'
echo
echo "Done. Verify: Project settings → Context kinds → device → 'Available for experiments and guarded rollouts' is checked."
