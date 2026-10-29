# Two families of segments.
#
#   region-*  on the `user` context kind. These are the phases of the sequential
#             `dark-mode` release: Delhi -> Jaipur -> Goa.
#   ios-*     on the `device` context kind, semantic-version ranges. These back the
#             per-OS flags and the experiment audience.
#
# The `device` context kind must already exist (see scripts/01-context-kind.sh).
# semVer ">= X" is expressed as NOT (semVerLessThan X) via `negate = true`.

resource "launchdarkly_segment" "ios_18_plus" {
  key         = "ios-18-plus"
  project_key = var.project_key
  env_key     = var.environment_key
  name        = "iOS 18+"
  description = "Devices running iOS 18.0.0 or newer. Phase 1 (lowest risk)."
  tags        = var.tags

  rules {
    clauses {
      context_kind = "device"
      attribute    = "operating_system"
      op           = "in"
      values       = ["iOS"]
    }
    clauses {
      context_kind = "device"
      attribute    = "os_version"
      op           = "semVerLessThan"
      values       = ["18.0.0"]
      negate       = true
    }
  }
}

resource "launchdarkly_segment" "ios_17" {
  key         = "ios-17"
  project_key = var.project_key
  env_key     = var.environment_key
  name        = "iOS 17"
  description = "Devices running iOS 17.x. Phase 2."
  tags        = var.tags

  rules {
    clauses {
      context_kind = "device"
      attribute    = "operating_system"
      op           = "in"
      values       = ["iOS"]
    }
    clauses {
      context_kind = "device"
      attribute    = "os_version"
      op           = "semVerLessThan"
      values       = ["17.0.0"]
      negate       = true
    }
    clauses {
      context_kind = "device"
      attribute    = "os_version"
      op           = "semVerLessThan"
      values       = ["18.0.0"]
    }
  }
}

resource "launchdarkly_segment" "ios_16_and_older" {
  key         = "ios-16-and-older"
  project_key = var.project_key
  env_key     = var.environment_key
  name        = "iOS 16 and older"
  description = "Devices running iOS below 17.0.0. Phase 3 (highest risk)."
  tags        = var.tags

  rules {
    clauses {
      context_kind = "device"
      attribute    = "operating_system"
      op           = "in"
      values       = ["iOS"]
    }
    clauses {
      context_kind = "device"
      attribute    = "os_version"
      op           = "semVerLessThan"
      values       = ["17.0.0"]
    }
  }
}

# ---------------------------------------------------------------------------
# Region segments — the phases of the sequential dark-mode release.
# Region arrives as a user attribute; the app supplies it like any other.
# ---------------------------------------------------------------------------

locals {
  regions = {
    "region-delhi"  = { name = "Delhi", city = "Delhi" }
    "region-jaipur" = { name = "Jaipur", city = "Jaipur" }
    "region-goa"    = { name = "Goa", city = "Goa" }
  }
}

resource "launchdarkly_segment" "region" {
  for_each = local.regions

  key         = each.key
  project_key = var.project_key
  env_key     = var.environment_key
  name        = each.value.name
  description = "Traders in ${each.value.city}. Phase of the region-sequenced dark-mode release."
  tags        = concat(var.tags, ["region"])

  rules {
    clauses {
      context_kind = "user"
      attribute    = "region"
      op           = "in"
      values       = [each.value.city]
    }
  }
}
