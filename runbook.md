# Runbook: Z-Trader — cohort releases, experiment, observability

The operational script for running this demo live. The *why* is in `README.md`;
this file is what you keep open during the session.

Everything below reflects the demo as built and rehearsed. Where an earlier
approach failed in practice, the note says so — those are not hypothetical.

## What the demo is made of

| Piece | What it is |
| --- | --- |
| `dark-mode` | The sequential release. One flag, three phases by **region**: Delhi → Jaipur → Goa. Jaipur regresses. |
| `dark-mode-ios18/17/16` | A flag per **OS version**, for the "why not a flag each?" conversation. iOS 17 carries the mobile render fault. |
| `quote-experience` | Device-capability experiment. `static` / `polled` / `live` price delivery, sliced by OS cohort. |
| `pnl-display` | Plain A/B for any audience. Percentage vs rupee amount on each holding. |
| Trader app | Z-Trader portfolio screen, real browser SDK, observability + session replay. |
| Fleet wall | Share of each group currently served dark, from a 150-context pool per group. |
| Simulator | Two device populations at once: cities for `dark-mode`, OS versions for the flag-per-OS comparison. |

## Pre-flight

```sh
./scripts/start-demo.sh     # everything: page on :8765 + simulator in this terminal
./scripts/03-verify.sh      # segments, flags, metrics, policy, leftover rules
```

- [ ] `start-demo.sh` pre-flight prints all ✓ and the current `dark-mode` targeting
- [ ] `03-verify.sh` — every line `OK`, and **Leftover rules: all clean**
- [ ] Browser full-screen or at least 1100px wide. Below ~820px the wall stacks under the phone and falls off the fold
- [ ] Header filter and the app agree — the filter drives both, so they cannot disagree
- [ ] Experiments `quote-experience-os` and `pnl-display-ab` are **running** (Experiments list)
- [ ] Notifications off, LaunchDarkly on one half of the screen, the demo page on the other

### Reset between runs

```sh
./scripts/reset-flags.sh    # all flags back to baseline, strips leftover catch-all rules
```

Baseline: `dark-mode` on with Delhi/Jaipur/Goa all serving Light; the three per-OS
flags on with iOS 18 → Dark and the others Light.

## Live steps — the sequential release

| # | Say | Do | Expected | If it breaks |
| --- | --- | --- | --- | --- |
| 1 | "Z-Trader ships one app. Traders in Delhi, Jaipur and Goa. The app asks LaunchDarkly one question per session — is dark mode on for this trader — and reports whether the screen rendered and how long it took. That's the whole integration. Delhi already has it; we shipped that audience last week." | Header filter → **One flag**. Point at the terminal and the wall | Delhi dark (already shipped), Jaipur and Goa light, ~250ms, no errors | Fallback D |
| 2 | "Three phases, ordered by how much we're willing to risk. One rollout config, one set of guardrails, every phase. Notice what I didn't do — I didn't touch the app." | On the **Jaipur** rule: **Edit → Serve → Guarded rollout → save** | Jaipur starts at 25%, ~4 of 18 tiles dark | see "Do not use the top-level Ship it" |
| 3 | "It runs a sequential test at each step against traders in the same region still on light mode. It only advances when the sample is big enough and nothing regressed." | Set the app picker to **Jaipur** before you start. Watch the phone and the wall | Phone flips dark and shows the error panel; Jaipur tiles go red | Fallback A |
| 4 | "There's the bug. LaunchDarkly caught it at 25% of one region, rolled *that region* back, and left everyone else alone. No human in the loop." | Watch the banner: regression detected → rolled back | Jaipur returns to light; Delhi stays dark and healthy | Fallback E |
| 5 | "Every step is in the audit log — compliance gets the same story you just watched." | Flag → **Change history**; **Monitoring** → rollout history | Release start, steps, regression, auto-rollback, who and when | — |

## Live steps — observability

Errors are **zero** until dark mode reaches the affected group. That is the point:
the release creates the errors, and the telemetry proves which group and which flag value.

| Tab | Show | Filter |
| --- | --- | --- |
| Errors | `PortfolioRenderError` from `brokerage-trading-api` **and** `TypeError: Cannot read properties of null` from `brokerage-trader-web` — backend and browser, same cause | `service_name=brokerage-trader-web` |
| Sessions | Open the replay: watch the screen go dark and break | `has_errors=true` |
| Traces | `GET /portfolio` spans jump ~250ms → ~850ms for the affected group only | `app.region=Jaipur` |
| Logs | The render-failure lines with group and flag value inline | `level=error` |

Useful fields — these are the real indexed ones: `app.region`, `app.cohort`,
`app.os_version`, `feature.dark_mode`, `feature.flag_key`, `feature.demo_shape`,
`level`, `service_name`, `span_name`, `has_errors`. The SDK also adds
`feature_flag.key` and `feature_flag.result.value` by itself.

## Live steps — a flag per OS, and the experiment

| # | Say | Do |
| --- | --- | --- |
| 6 | "You could do a flag per OS version instead. Each carries its own rollout and they can run in parallel — that's the one thing this genuinely buys you, because LaunchDarkly allows only one guarded rollout per flag. The costs: sprawl, and the version name ends up hard-coded into the flag name, so the app has to know which one to ask for." | Header filter → **A flag per OS**. The app heading changes to *asking LaunchDarkly for dark-mode-ios17*, and each column names its own flag |
| 7 | "Same fault, same story, three times the surface area." | On `dark-mode-ios17`: **Edit → Serve → Guarded rollout** → the iOS 17 phone breaks and rolls back |
| 8 | "The cohorts you built to protect a release are the ones you use to optimise one. Richer price delivery costs render time, so the winner should differ by device — and it does." | Experiments → **Which quote experience wins, per OS** → Results. Slice by `os_cohort` |

The experiment's intended conclusion: one-tap lifts order completion everywhere
(+2pp iOS 18, +3pp iOS 17, +5pp iOS 16) but cancellations climb 0.5% → 1.0% /
1.6% / 3.0%. So ship one-tap on iOS 18 and 17, keep the confirm sheet on iOS 16 —
which lands straight back in cohort-scoped targeting.

## Do not use the top-level "Ship it"

The **Ship it** button next to "Flag is On" does not attach to your rules. It
creates a **new catch-all rule** (`context kind is one of device`), runs a
single-phase release on it against the whole fleet, and leaves that rule behind
when it rolls back. The leftover rule then sits first and swallows all traffic,
so the next run silently does nothing.

This happened three times during the build. Use **Edit → Serve → Guarded rollout**
on the specific rule instead, and run `./scripts/03-verify.sh` between runs — it
reports any leftover catch-all rule with its `ruleId`.

Ship it *can* work for a true multi-phase audience-based release, but you must
change Phase 1's audience from the catch-all default to the segment, add the
other phases, and set Final phase to **Keep the release limited to this audience**
(not "Release to everyone", which deletes your phase rules).

## Fallbacks

| Failure | Symptom | Fallback |
| --- | --- | --- |
| A. Slow regression detection | Affected group not red after ~2 min | Restart with `FAILURE_RATE=0.7` or `SESSIONS_PER_MINUTE=2400`. Say "let me turn up the afternoon traffic" |
| B. "Waiting for minimum sample" | Step keeps extending | Same as A. Policy min sample is 50 |
| C. Phone stays light through the rollout | Diagnostic line has no `[in rollout]` | The phone hops onto an affected device automatically. If it does not, the group you picked is not the one rolling out — check the picker |
| D. "Not receiving device evaluations" | Warning on save, wall all light | Simulator is not running, or `LD_SDK_KEY` is for another environment. `pgrep -f "node simulator.js"` |
| E. Out of time, nothing red | — | Monitoring → **Roll back** manually; narrate that the automatic path does exactly this |
| F. Rollout rolled back as "insufficient sample size" | Not a real regression | The simulator was not running, so only the wall's contexts evaluated the flag and they send no metric events. Start the simulator, wait 60s, retry |
| G. Experiment shows "not enough data" | Results empty | The experiment rides on the per-OS population only. Confirm the simulator is up and that traffic is flowing |
| No network | App can't reach LaunchDarkly | Walk the UI on rehearsal screenshots |

## Anticipated questions

### "Each phase has an *Add adaptive trigger* button — can each group watch its own metric?"

Yes for configuration, no for scoping. Two different mechanisms:

| | Guarded rollout metrics | Adaptive trigger |
| --- | --- | --- |
| Scope | Shared by every phase | Per rule, so per phase |
| Logic | Statistical regression vs baseline | Metric crosses a threshold you set |
| Action | Pause / roll back the release | Switch variation + alert |
| Analysis unit | The randomization unit (`user`) | **The whole environment** |

The answer: *"You can attach a trigger to an individual phase, but a trigger
measures its source across the entire environment — so use the guarded rollout
when you want a group-scoped decision."* Do not add one during the demo; on the
Jaipur rule watching `render-error` it would count Delhi and Goa errors too.

Docs: [Adaptive triggers](https://launchdarkly.com/docs/home/flags/triggers),
[Audience-based releases](https://launchdarkly.com/docs/home/releases/audience-based-releases).

### "Why not one flag per cohort?"

See step 6. Parallel rollouts and per-cohort metrics are the two real advantages,
and they are the only two.

### "How does region get into the context?"

The simulator supplies `user.region`. A real app sends it the same way it sends
any context attribute. With the mobile SDKs, OS and device attributes come for
free if you enable environment attributes; region is yours to provide.

## Cleanup

- [ ] Stop any active release (serve Light) and, if you started a new iteration, stop the experiment
- [ ] `./scripts/reset-flags.sh` — baseline restored, leftover rules stripped
- [ ] `./scripts/stop-demo.sh` — simulator and page down, events flushed
- [ ] `./scripts/03-verify.sh` — confirm clean before you walk away
- [ ] **Do not leave the simulator running.** It ran for two days once at 1200/min — roughly 3.9M sessions of contexts and events
- [ ] Archiving: flags and metrics can be archived; **experiments can only be archived, never deleted**
- [ ] `git grep -nE 'sdk-[a-f0-9-]{36}|api-[a-f0-9-]{36}'` — confirm no real keys committed

## Not Terraform-managed

`launchdarkly/*.tf` describes these objects but holds **no state** for this
project — everything was created through the API and MCP. `terraform apply`
would try to create it all again; `terraform destroy` would remove nothing.
Treat the `.tf` files as the reproducible reference, not the live source.
