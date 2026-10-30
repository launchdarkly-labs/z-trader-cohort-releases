# Z-Trader — cohort releases, per-cohort rollback, and an experiment on the same cohorts

A LaunchDarkly demo for a stock brokerage. Roll a mobile feature out **per group**,
roll it back **per group automatically** when it regresses, prove it with
**observability**, and reuse the same cohorts for an **experiment** — without the
app knowing anything about groups.

## The challenge

Z-Trader ships one app to traders across several Indian cities, on a device base
spanning iOS 16 to 18. A release that works for one group can break another, and
today one bad group forces a rollback for everyone. During market hours a failed
portfolio screen is lost revenue — brokerage is earned per executed order — so
rollback has to be automatic and it has to be surgical.

## What the demo shows

- **One flag, one line of app code.** The app asks `dark-mode` for a `user` + `device`
  multi-context. Group logic lives in LaunchDarkly segments, not in flag keys or app code.
- **Sequential release by region.** `dark-mode` runs Delhi → Jaipur → Goa. Jaipur has a
  rendering fault; LaunchDarkly detects the regression and rolls **that region** back
  while Delhi keeps the feature.
- **The evidence.** Errors, logs, traces and a session replay, from both the backend and
  the browser, all tagged with the group and the flag value that caused them.
- **The alternative, shown honestly.** `dark-mode-ios18/17/16` illustrate a flag per OS
  version. Parallel rollouts and per-cohort metrics are what that genuinely buys you —
  at the cost of sprawl and cohort logic in flag keys.
- **Two experiments, two audiences.** `quote-experience` is an A/B/n across three ways
  of delivering prices (pull-to-refresh, 5-second polling, live stream). Render cost
  rises with richness, so the winner differs by device — slice the results by
  `os_cohort` and the answer is "iOS 18 gets the live stream, older cohorts do not".
  `pnl-display` is the plain two-variation A/B for a mixed audience: percentage versus
  rupee amount on each holding, measured on whether the trader opens it.

## Contents

| Path | What |
| --- | --- |
| `app/simulator.js` | Traffic simulator. Two populations at once: cities for `dark-mode`, OS versions for the flag-per-OS comparison and the experiment |
| `app/demo.js` + `demo.html` | The single demo page: trader app and fleet wall on one port |
| `app/viewer.js`, `app/trader.js` | The wall and the app as standalone servers, if you ever want them apart |
| `scripts/start-demo.sh` | Pre-flight, starts everything, opens the browser |
| `scripts/stop-demo.sh` | Stops everything, flushing events |
| `scripts/reset-flags.sh` | Flags back to baseline; strips leftover catch-all rules |
| `scripts/backup-demo.sh` / `restore-demo.sh` | Snapshot and restore code plus LaunchDarkly state |
| `scripts/03-verify.sh` | Segments, flags, metrics, release policy, leftover-rule check |
| `app/vendor/` | The browser SDK bundles, served by the app instead of fetched from a CDN at page load |
| `scripts/vendor-sdks.sh` | Re-downloads those bundles |
| `launchdarkly/` | Terraform describing the objects — reference only, see "Not Terraform-managed" |
| `runbook.md` | Live steps, talk track, fallbacks, anticipated questions, cleanup |

## Run it

```bash
cp .env.example .env     # add LD_SDK_KEY, LAUNCHDARKLY_ACCESS_TOKEN, LD_CLIENT_SIDE_ID
cd app && npm install && cd ..
./scripts/start-demo.sh
```

Then follow `runbook.md`. `./scripts/03-verify.sh` checks everything is in place.

## LaunchDarkly objects

### Flags

| Flag | Kind | Purpose |
| --- | --- | --- |
| `dark-mode` | boolean | The sequential release. Three rules: Delhi, Jaipur, Goa |
| `dark-mode-ios18` / `ios17` / `ios16` | boolean | A flag per OS version; iOS 17 carries the mobile fault |
| `quote-experience` | string | `static` / `polled` / `live`. The device-capability experiment |
| `pnl-display` | string | `percent` / `rupees`. The stakeholder-friendly A/B |

`dark-mode-contrast` and `order-confirm-flow` were earlier experiment flags and are both
**archived** — superseded by the two above.

### Segments

| Segment | Rule |
| --- | --- |
| `region-delhi` / `region-jaipur` / `region-goa` | `user.region` in the city |
| `ios-18-plus` / `ios-17` / `ios-16-and-older` | `device.os_version` semantic-version ranges |

### Metrics

All randomised on `user`. `device` would count a trader on two devices twice, but a
depot launch cannot register it as a randomization unit — the service token is scoped
`project-writer`, which cannot change a project's experimentation settings. `user` is
also the unit the audience-sequenced story actually claims.

| Metric | Direction | Used for |
| --- | --- | --- |
| `render-error` | lower is better | Guarded rollout regression signal |
| `screen-load-ms` | lower is better | Guarded rollout + experiment guardrail |
| `order-placed` | higher is better | Experiment primary metric |
| `order-cancelled` | lower is better | Experiment guardrail — the mis-trade signal |

### Release policy

`demo-guarded-1min` — scoped to `production` and flag tag `demo`. Randomises on
`device`, min sample 50, auto-rollback on, steps 25% then 50% at one minute each.
100% is implicit when a phase ends.

## Simulator dials

`SESSIONS_PER_MINUTE` is **per population**, so the default sends twice that in total.

| Env var | Default | Effect |
| --- | --- | --- |
| `SESSIONS_PER_MINUTE` | 1200 | Per population |
| `REGION_MIX` | `45,35,20` | Delhi / Jaipur / Goa |
| `OS_MIX` | `55,30,15` | iOS 18 / 17 / 16 |
| `BUGGY_REGION` | `jaipur` | Region with the fault, for `dark-mode` |
| `BUGGY_COHORT` | `ios17` | OS version with the fault, for the flag-per-OS comparison |
| `FAILURE_RATE` | `0.50` | Render-error rate in the affected group when dark mode is on |
| `BASELINE_ERROR_RATE` | `0` | Healthy groups emit **zero** errors, so a healthy rollout cannot false-positive |
| `FIX_APPLIED` | `false` | `true` clears the fault — the fix-forward beat |
| `ORDER_RATE_BASE` | `0.08` | Baseline order completion |
| `CANCEL_TWO_STEP` | `0.005` | Share of placed orders cancelled shortly after |
| `QE_ORDERS_STATIC` / `_POLLED` / `_LIVE` | see `.env.example` | Order completion per quote experience, per iOS 18/17/16. `live` wins on iOS 18 and loses on iOS 16 — that is the whole point of the experiment |
| `QE_LOAD_STATIC` / `_POLLED` / `_LIVE` | see `.env.example` | Extra render milliseconds each quote experience costs, per cohort |
| `HOLDING_TAP_PERCENT` / `HOLDING_TAP_RUPEES` | `0.22` / `0.29` | Share of sessions that open a holding, per `pnl-display` variation |
| `DEMO_MODE` | `both` | `one` or `optiona` to run a single population |
| `OBSERVABILITY` | `true` | `false` disables telemetry; the demo runs identically |
| `VIEWER_POOL` / `VIEWER_TILES` | 150 / 18 | Contexts sampled per group, and phones drawn |
| `APP_POOL` | 12 | Candidate identities the phone can adopt |

## How the pieces stay honest

**Per-group rollback.** Each phase is a rule on the same flag. A guarded rollout lives on
one rule, so a regression reverts that rule alone. Verified: Jaipur rolled back while
Delhi stayed dark.

**Zero baseline errors.** Healthy groups emit no render errors at all. A 1% baseline on a
one-minute sample produced false regressions on healthy groups during the build, which
killed the demo — the zero baseline makes it deterministic.

**The fleet wall reports real proportions.** Each group evaluates a fixed pool of 150
contexts and the tiles render the measured share. A pool the size of the tile count is
bucketed too lopsidedly to represent the exposure — 12 fixed keys showed 2 dark at a
real 50% rollout. Minting fresh keys each tick fixed the proportion but flooded rollouts
with metric-free contexts, which starved genuine regressions. A bounded fixed pool is
the version that is both accurate and safe.

**The phone shows an affected device.** A single fixed device at a 25% step usually is
not in the bucket, so it sat there looking healthy through the whole release. The phone
now adopts one of 12 candidate identities that is genuinely in the rollout, and says so
in its diagnostic line.

**The experiment rides on OS cohorts, not regions**, and is not gated on dark mode —
results slice by `os_cohort`, so every cohort needs traffic.

## Not Terraform-managed

Terraform is not installed on the build machine, so every object was created through the
API and the LaunchDarkly MCP tools. `launchdarkly/*.tf` therefore describes these objects
but holds **no state** for this project: `terraform apply` would try to create them all
again, and `terraform destroy` would remove nothing. Either `terraform import` them or
treat the `.tf` files as the reproducible reference.

## Notes

- Nothing here is customer-specific: project and environment keys are variables, and only
  `.env.example` is committed.
- Experiments in LaunchDarkly can be archived but **never deleted**. Be deliberate about
  creating them in a project a customer will see.
- The top-level **Ship it** button creates a catch-all rule rather than using your
  existing rules. See `runbook.md` before using it.
