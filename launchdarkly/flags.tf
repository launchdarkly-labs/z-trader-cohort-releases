# ---------------------------------------------------------------------------
# dark-mode: the ONE flag the app evaluates for the sequential release. Three
# targeting rules, one per REGION segment, all serving `false` initially. The
# guarded rollout is started on an individual rule in the UI (see runbook.md).
# ---------------------------------------------------------------------------

resource "launchdarkly_feature_flag" "dark_mode" {
  project_key    = var.project_key
  key            = "dark-mode"
  name           = "Dark Mode"
  description    = "Dark theme for the trading app. Rolled out per region, one phase at a time, with a guarded rollout on each phase."
  variation_type = "boolean"
  temporary      = true
  tags           = var.tags

  variations {
    value       = "true"
    name        = "Dark"
    description = "Dark theme on"
  }
  variations {
    value       = "false"
    name        = "Light"
    description = "Light theme (current behaviour)"
  }

  defaults {
    on_variation  = 1 # false
    off_variation = 1 # false
  }
}

resource "launchdarkly_feature_flag_environment" "dark_mode" {
  flag_id = launchdarkly_feature_flag.dark_mode.id
  env_key = var.environment_key

  on            = true
  off_variation = 1

  # Phases in order. Rule order is the sequence, so the descriptions are just
  # the city names.
  rules {
    description = "Delhi"
    clauses {
      context_kind = "user"
      attribute    = "segmentMatch"
      op           = "segmentMatch"
      values       = ["region-delhi"]
    }
    variation = 1
  }

  rules {
    description = "Jaipur"
    clauses {
      context_kind = "user"
      attribute    = "segmentMatch"
      op           = "segmentMatch"
      values       = ["region-jaipur"]
    }
    variation = 1
  }

  rules {
    description = "Goa"
    clauses {
      context_kind = "user"
      attribute    = "segmentMatch"
      op           = "segmentMatch"
      values       = ["region-goa"]
    }
    variation = 1
  }

  fallthrough {
    variation = 1 # default rule: off
  }

  lifecycle {
    # A guarded rollout rewrites these rules (rollout weights, then fixed
    # variations). Ignore rule drift after the initial apply so Terraform never
    # reverts a live release. Remove this block to force a reset.
    ignore_changes = [rules]
  }
}

# ---------------------------------------------------------------------------
# A flag per OS version — the alternative to one flag. Illustrates the "one
# flag" parallel alternative. The simulator never evaluates these.
# ---------------------------------------------------------------------------

locals {
  option_a = {
    "dark-mode-ios18" = { name = "Dark Mode (iOS 18)", segment = launchdarkly_segment.ios_18_plus.key, desc = "iOS 18 and newer devices" }
    "dark-mode-ios17" = { name = "Dark Mode (iOS 17)", segment = launchdarkly_segment.ios_17.key, desc = "iOS 17 devices" }
    "dark-mode-ios16" = { name = "Dark Mode (iOS 16)", segment = launchdarkly_segment.ios_16_and_older.key, desc = "iOS 16 and older devices" }
  }
}

resource "launchdarkly_feature_flag" "option_a" {
  for_each = local.option_a

  project_key    = var.project_key
  key            = each.key
  name           = each.value.name
  description    = "Shows the alternative to one flag: a separate dark-mode flag for every OS version, each needing its own rollout and rollback. Evaluated by the trader app and simulator when the demo is set to a flag per OS."
  variation_type = "boolean"
  temporary      = true
  tags           = concat(var.tags, ["flag-per-os"])

  variations {
    value = "true"
    name  = "Dark"
  }
  variations {
    value = "false"
    name  = "Light"
  }

  defaults {
    on_variation  = 1
    off_variation = 1
  }
}

resource "launchdarkly_feature_flag_environment" "option_a" {
  for_each = local.option_a

  flag_id       = launchdarkly_feature_flag.option_a[each.key].id
  env_key       = var.environment_key
  on            = true
  off_variation = 1

  rules {
    description = each.value.desc
    clauses {
      context_kind = "device"
      attribute    = "segmentMatch"
      op           = "segmentMatch"
      values       = [each.value.segment]
    }
    variation = 1
  }

  fallthrough {
    variation = 1
  }
}

# ---------------------------------------------------------------------------
# quote-experience: the device-capability experiment. Three ways to deliver
# prices on the portfolio screen, rising in richness and in render cost, so the
# winning variation is expected to DIFFER BY DEVICE. Audience is every iOS
# cohort, which is what lets the results be sliced by device.os_cohort.
#
# dark-mode-contrast and order-confirm-flow were earlier experiment flags and
# are both ARCHIVED, superseded by this one and by pnl-display below.
# ---------------------------------------------------------------------------

resource "launchdarkly_feature_flag" "quote_experience" {
  project_key    = var.project_key
  key            = "quote-experience"
  name           = "Portfolio quote experience"
  description    = "Three ways to deliver prices on the portfolio screen, from cheapest to richest: pull-to-refresh, 5-second polling, live websocket stream. Render cost rises with richness, so the winner is expected to differ by device. Slice results by os_cohort."
  variation_type = "string"
  temporary      = true
  tags           = concat(var.tags, ["experiment"])

  variations {
    value       = "static"
    name        = "Pull to refresh"
    description = "Cheapest. The trader refreshes by hand."
  }
  variations {
    value       = "polled"
    name        = "Polled every 5s"
    description = "Middle ground. A repaint every five seconds."
  }
  variations {
    value       = "live"
    name        = "Live websocket stream"
    description = "Richest, and most expensive to paint. Repaints on every tick."
  }

  defaults {
    on_variation  = 0
    off_variation = 0
  }

  client_side_availability {
    using_environment_id = true
    using_mobile_key     = true
  }
}

resource "launchdarkly_feature_flag_environment" "quote_experience" {
  flag_id       = launchdarkly_feature_flag.quote_experience.id
  env_key       = var.environment_key
  on            = true
  off_variation = 0

  # The experiment attaches its traffic split to this rule.
  rules {
    description = "Experiment audience: all iOS cohorts"
    clauses {
      context_kind = "device"
      attribute    = "segmentMatch"
      op           = "segmentMatch"
      values = [
        launchdarkly_segment.ios_18_plus.key,
        launchdarkly_segment.ios_17.key,
        launchdarkly_segment.ios_16_and_older.key,
      ]
    }
    variation = 0
  }

  fallthrough {
    variation = 0
  }

  lifecycle {
    # A running experiment owns the split on this rule. Never fight it.
    ignore_changes = [rules, fallthrough]
  }
}

# ---------------------------------------------------------------------------
# pnl-display: the experiment any stakeholder can read in one sentence. Half the
# traders see the day's gain as a percentage, half as a rupee amount; nothing
# else changes. Measured on holding-tapped — did they open the holding and look
# closer. No audience rule, so it runs across the whole book.
# ---------------------------------------------------------------------------

resource "launchdarkly_feature_flag" "pnl_display" {
  project_key    = var.project_key
  key            = "pnl-display"
  name           = "Day's gain: rupees or percentage"
  description    = "How each holding shows its gain or loss for the day — as a percentage, or as a rupee amount. +1.24% is abstract; +Rs 3,327 is money. Measured on whether the trader opens the holding."
  variation_type = "string"
  temporary      = true
  tags           = concat(var.tags, ["experiment"])

  variations {
    value       = "percent"
    name        = "Shown as a percentage"
    description = "Current behaviour, e.g. +1.24%."
  }
  variations {
    value       = "rupees"
    name        = "Shown in rupees"
    description = "The money amount, e.g. +Rs 3,327."
  }

  defaults {
    on_variation  = 0
    off_variation = 0
  }

  client_side_availability {
    using_environment_id = true
    using_mobile_key     = true
  }
}

resource "launchdarkly_feature_flag_environment" "pnl_display" {
  flag_id       = launchdarkly_feature_flag.pnl_display.id
  env_key       = var.environment_key
  on            = true
  off_variation = 0

  # No rule: the experiment splits the default rule across everyone.
  fallthrough {
    variation = 0
  }

  lifecycle {
    ignore_changes = [rules, fallthrough]
  }
}
