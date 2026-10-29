# Demo app: device traffic simulator

The application for this demo. Keep it self-contained — no dependencies on
anything outside this `demos/<customer>/` folder.

One file, `simulator.js`, using the LaunchDarkly server-side Node SDK. It
continuously simulates trading-app sessions across iOS 16/17/18 devices,
evaluates `dark-mode` for each, simulates rendering the portfolio screen, tracks
metrics, and prints a live per-cohort table (rows turn red above the error
threshold). This table is the audience-visible dashboard; there is no web UI.

## Setup

```sh
cp ../.env.example ../.env    # fill in your keys first
npm install && npm start      # Ctrl+C flushes events and exits
```

Node.js >= 18.

## Configuration

All LaunchDarkly configuration is read from `../.env` — never hardcode keys or
project/environment keys in source:

| Variable | Used for |
| --- | --- |
| `LD_SDK_KEY` | Server-side SDK initialization |
| `LD_PROJECT_KEY` | Reference only; the SDK key implies the project |
| `LD_ENVIRONMENT_KEY` | Reference only; the SDK key implies the environment |
| `SESSIONS_PER_MINUTE` | Steady traffic volume (default 600) |
| `OS_MIX` | iOS18,iOS17,iOS16 share, sums to 100 (default `55,30,15`) |
| `BUGGY_COHORT` | Cohort with the dark-mode fault (default `ios16`) |
| `FAILURE_RATE` | Render-error probability in the buggy cohort when dark mode is on (default 0.30; baseline 0.01) |
| `FIX_APPLIED` | `true` makes the buggy cohort behave normally (fix-forward beat) |
| `ERROR_THRESHOLD_PCT` | Dashboard row turns red above this (default 5) |
| `QE_ORDERS_*` / `QE_LOAD_*` | `order-placed` conversion and render cost per `quote-experience` variation, per cohort |
| `HOLDING_TAP_PERCENT` / `HOLDING_TAP_RUPEES` | `holding-tapped` conversion per `pnl-display` variation |

## Contexts

Every session builds a multi-context. A fresh `device` key per session so
distinct-device counts grow fast enough for guarded-rollout step minimums.

| Context kind | Key | Attributes |
| --- | --- | --- |
| user | `usr-<random>` | `plan_tier` (basic / plus / pro) |
| device | `dev-<random>` | `operating_system` (`iOS`), `os_version` (semver, e.g. `17.5`), `model` (iPhone/iPad), `app_version` |

Attribute names match the segment rules in `../launchdarkly/segments.tf` exactly.

## Flags used

| Flag key | Where it's evaluated | Default if LD is unreachable |
| --- | --- | --- |
| `dark-mode` | once per session, before rendering the portfolio screen | `false` (light mode) |
| `quote-experience` | every session in the OS-cohort population | `"static"` |
| `pnl-display` | every session, for the holdings list | `"percent"` |

`dark-mode-ios18` / `ios17` / `ios16` are **never** evaluated — they exist only for the "why not parallel?" conversation.

## Metrics sent

| Event key | When | Value |
| --- | --- | --- |
| `screen-load-ms` | every session | numeric, ms |
| `render-error` | on a render error | none (conversion) |
| `order-placed` | dark-mode session that converts | none (conversion) |

## Behaviour

- Dark mode **on** and cohort == `BUGGY_COHORT` and `FIX_APPLIED=false`: error with probability `FAILURE_RATE`, load time +600 ms.
- Otherwise: baseline error 1 %, load ~250 ms ± 40 ms.
