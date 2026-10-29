#!/usr/bin/env bash
# Builds the LaunchDarkly objects in dependency order. Reads ../.env.
# Stops after `terraform plan` so you can review; pass --apply to continue.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$(dirname "$here")"
[[ -f "$root/.env" ]] && set -a && source "$root/.env" && set +a

"$here/01-context-kind.sh"

cd "$root/launchdarkly"
export TF_VAR_project_key="$LD_PROJECT_KEY" TF_VAR_environment_key="${LD_ENVIRONMENT_KEY:-production}"
terraform init -input=false
terraform validate
terraform plan -input=false -out=tfplan
if [[ "${1:-}" == "--apply" ]]; then
  terraform apply -input=false tfplan
  "$here/02-release-policy.sh"
  echo; echo "Done. Next: cd app && npm install && npm start, then follow runbook.md."
else
  echo; echo "Plan saved to launchdarkly/tfplan. Review it, then re-run with --apply."
fi
