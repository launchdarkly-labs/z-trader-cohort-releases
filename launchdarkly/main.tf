terraform {
  required_version = "~> 1.9"

  required_providers {
    launchdarkly = {
      source  = "launchdarkly/launchdarkly"
      version = "~> 2.0"
    }
  }
}

# Token comes from LAUNCHDARKLY_ACCESS_TOKEN if the variable is unset.
provider "launchdarkly" {
  access_token = var.launchdarkly_access_token
}

# Resources are split by type:
#   segments.tf — three region segments on `user`, three OS cohorts on `device`
#   flags.tf    — dark-mode (region-sequenced release), dark-mode-iosNN (a flag
#                 per OS version), quote-experience and pnl-display (experiments)
#   metrics.tf  — render-error, screen-load-ms, order-placed, order-cancelled,
#                 holding-tapped
#
# Not expressible in provider 2.x, so done via scripts/ or the API:
#   - the `device` context kind and its "available for experiments and guarded
#     rollouts" setting (scripts/01-context-kind.sh)
#   - the release policy that pre-fills the guarded steps (scripts/02-release-policy.sh)
#   - the guarded rollouts and the experiment themselves (UI / API; see ../runbook.md)
#
# IMPORTANT: this configuration holds NO STATE for the live demo project. Every
# object was created through the API and the LaunchDarkly MCP tools, so a
# `terraform apply` would try to create all of it again and `terraform destroy`
# would remove nothing. Treat these files as the reproducible reference, or
# `terraform import` the objects first.
