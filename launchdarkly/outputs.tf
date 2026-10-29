output "project_key" {
  description = "Project this demo was applied to."
  value       = var.project_key
}

output "environment_key" {
  description = "Environment this demo was applied to."
  value       = var.environment_key
}

output "flag_keys" {
  description = "Flags managed by this configuration — the archive list after a demo."
  value = concat(
    [launchdarkly_feature_flag.dark_mode.key,
      launchdarkly_feature_flag.quote_experience.key,
    launchdarkly_feature_flag.pnl_display.key],
    [for f in launchdarkly_feature_flag.option_a : f.key],
  )
}

output "region_segment_keys" {
  description = "Region segments in release-phase order: Delhi, Jaipur, Goa."
  value       = [for k in ["region-delhi", "region-jaipur", "region-goa"] : launchdarkly_segment.region[k].key]
}

output "os_segment_keys" {
  description = "OS cohort segments, used by the per-OS flags and the experiment audience."
  value = [
    launchdarkly_segment.ios_18_plus.key,
    launchdarkly_segment.ios_17.key,
    launchdarkly_segment.ios_16_and_older.key,
  ]
}

output "metric_keys" {
  value = [
    launchdarkly_metric.render_error.key,
    launchdarkly_metric.screen_load_ms.key,
    launchdarkly_metric.order_placed.key,
    launchdarkly_metric.order_cancelled.key,
  ]
}
