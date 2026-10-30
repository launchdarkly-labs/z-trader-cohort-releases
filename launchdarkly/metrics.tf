# Custom metrics sent by the simulator via client.track(). Randomised on `device` here,
# which a long-lived project can support. app/ld-bootstrap.js uses `user` instead,
# because a Demo Depot launch cannot register `device` as a randomization unit.

resource "launchdarkly_metric" "render_error" {
  project_key         = var.project_key
  key                 = "render-error"
  name                = "Render error"
  description         = "Portfolio screen failed to render. Binary conversion, lower is better. Primary regression signal."
  kind                = "custom"
  event_key           = "render-error"
  is_numeric          = false
  success_criteria    = "LowerThanBaseline"
  randomization_units = ["device"]
  tags                = var.tags
}

resource "launchdarkly_metric" "screen_load_ms" {
  project_key         = var.project_key
  key                 = "screen-load-ms"
  name                = "Screen load time (ms)"
  description         = "Portfolio screen load time in milliseconds. Numeric, lower is better."
  kind                = "custom"
  event_key           = "screen-load-ms"
  is_numeric          = true
  unit                = "ms"
  success_criteria    = "LowerThanBaseline"
  randomization_units = ["device"]
  tags                = var.tags
}

resource "launchdarkly_metric" "order_cancelled" {
  project_key         = var.project_key
  key                 = "order-cancelled"
  name                = "Order cancelled after placement"
  description         = "Trader cancelled or reversed an order shortly after placing it - the mis-trade signal. Binary conversion, lower is better. Guardrail for reducing order confirmation friction."
  kind                = "custom"
  event_key           = "order-cancelled"
  is_numeric          = false
  success_criteria    = "LowerThanBaseline"
  randomization_units = ["device"]
  tags                = var.tags
}

resource "launchdarkly_metric" "order_placed" {
  project_key         = var.project_key
  key                 = "order-placed"
  name                = "Order placed"
  description         = "Trader completed a market order. Binary conversion, higher is better. Primary metric for the quote-experience experiment."
  kind                = "custom"
  event_key           = "order-placed"
  is_numeric          = false
  success_criteria    = "HigherThanBaseline"
  randomization_units = ["device"]
  tags                = var.tags
}

# The pnl-display experiment's primary metric. Randomised like the others so release
# results and experiment results stay comparable.
resource "launchdarkly_metric" "holding_tapped" {
  project_key         = var.project_key
  key                 = "holding-tapped"
  name                = "Holding opened"
  description         = "Trader tapped into a holding to look closer. Binary conversion, higher is better. Primary metric for the pnl-display experiment."
  kind                = "custom"
  event_key           = "holding-tapped"
  is_numeric          = false
  success_criteria    = "HigherThanBaseline"
  randomization_units = ["device"]
  tags                = var.tags
}
