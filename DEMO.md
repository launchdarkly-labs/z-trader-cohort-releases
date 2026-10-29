## What this shows

A brokerage ships one app to iPhones running three different versions of iOS, across
cities that trade very differently. A dark theme that renders fine on the newest OS can
break on an older one, and during market hours a broken portfolio screen is lost money.
The usual choice is bad either way: ship to everyone and hope, or hold the release back
for the slowest cohort. This demo releases dark mode **one city at a time**, lets a
guarded rollout **revert the one city that breaks** while the others keep the feature,
and then reuses the very same audiences to run two experiments — with the errors, logs,
traces and session replay all tagged with the flag value that caused them.

## LaunchDarkly features

- **Guarded rollouts** — a release that watches `render-error` and `screen-load-ms` per
  phase and reverts the phase that regresses, with no human in the loop.
- **Audience-based release** — one flag, three rules, released city by city. Rule order
  is the sequence, so a rollback touches one rule and the cities already live are untouched.
- **Segments as reusable audiences** — the same six segments back the release, the
  experiment audiences and the monitoring filters.
- **Experimentation** — a device-capability A/B/n whose winner differs by device, and a
  plain two-variation A/B any stakeholder can read.
- **Observability** — errors, logs, traces and session replay from both the backend and
  the browser, every one carrying `feature.dark_mode` and the flag key.
- **Multi-contexts** — every evaluation sends a `user` and a `device` together, so the
  release is sequenced on the trader's city while rollouts bucket on the device.

## The story (about 10 minutes)

1. **Open the app.** The left half is a trader's phone; the right is a wall of real
   devices, one tile per context, grouped by city. Everything is in light mode. Say:
   *"Every tile is a real evaluation. The app asks one question — `dark-mode` — for a
   trader and their device together. It has no idea what a city or a cohort is."*

2. **Start the release on Delhi.** On `dark-mode`, open the **Delhi** rule → Edit →
   Serve → **Guarded rollout**. Keep the pre-filled metrics and 1-minute steps. Delhi's
   tiles start turning dark as the rollout steps 10 → 25 → 50 → 100%. Jaipur and Goa stay
   light. Say: *"One city at a time, and LaunchDarkly is watching the error rate while it
   ramps."*

3. **Ship Jaipur, and let it fail.** Same thing on the **Jaipur** rule. Within a minute
   the Jaipur row turns red, the phone throws a real `TypeError`, and the guarded rollout
   reverts **that rule only**. Delhi keeps dark mode. **This is the aha moment** — say
   nothing for a few seconds and let them watch it roll back by itself.

4. **Show the evidence.** Monitoring → the error is grouped by exception and filterable
   by `feature.dark_mode`; the session replay shows the broken screen as the trader saw
   it. Say: *"The flag value is an attribute on the telemetry, not something you infer
   from a deploy timestamp."*

5. **Fix forward.** Relaunch with **Clear the fault** set to `true`, or flip
   `FIX_APPLIED`, and re-run Jaipur. It passes.

6. **The alternative, honestly.** Open `dark-mode-ios18/17/16` side by side. Three flags,
   three rollouts, three metric sets. Say: *"This also works. It is just three times the
   work, every time the device matrix changes."*

7. **Reuse the audiences.** The `quote-experience` experiment runs on the same OS
   segments. Filter the results by `os_cohort`: the live price stream wins clearly on
   iOS 18, is marginal on iOS 17, and loses even to pull-to-refresh on iOS 16. Say:
   *"There is no single winning experience. That is the finding, and you only get it
   because the audience was already defined."*

## Created during the demo

Nothing in LaunchDarkly is created by a tool on the SE's behalf, but two things are
created **by the presenter during the call** and are deliberately not seeded — seeding
them would leave the demo with nothing to do:

| Key or pattern | Created by | When |
| --- | --- | --- |
| The guarded rollout on each `dark-mode` rule | Presenter, in the UI | Beats 2, 3 and 5 |
| The `quote-experience-os` and `pnl-display-ab` experiments | Presenter, in the UI | Beat 7 (optional) |

The six **segments** and five **metrics** are not in `ld/seed.json` either, but for a
different reason: the seed importer applies only list-based segments today and does not
create metrics at all. `app/ld-bootstrap.js` creates them over the API at startup, using
the `project-writer` token, and then repoints `dark-mode`'s three city rules at the city
segments. It is idempotent and never fatal.

## Launch parameters

| Parameter | What it does |
| --- | --- |
| `BUGGY_REGION` | Which city hits the rendering fault. Defaults to `jaipur`, which makes Delhi pass and Jaipur fail — the shape the story above assumes. |
| `BUGGY_COHORT` | Which OS version hits the fault in the per-OS comparison. Defaults to `ios17`. |
| `FAILURE_RATE` | Render-error rate in the affected group when dark mode is on. `0.50` makes the regression obvious inside one 1-minute step. |
| `SESSIONS_PER_MINUTE` | Traffic per population. Keep at or above 600 so the smallest group reaches the guarded rollout's per-step minimum. |
| `FIX_APPLIED` | `true` clears the fault, for the fix-forward beat without relaunching. |
| `DEMO_MODE` | `both` runs the city release and the per-OS comparison together. `one` or `optiona` runs a single population if you are short of time. |

## Why the seeded rules look the way they do

- **`dark-mode` starts ON with all three city rules serving `false`.** The flag has to be
  on for a guarded rollout to be startable, and every city has to start in light mode or
  there is no release to show. The rules exist up front because rule *order* is the
  release sequence.
- **The seeded rules clause on `user.region` directly** rather than on a segment. The
  seed importer does not apply rule-based segments, so a `segmentMatch` rule would import
  against a segment that does not exist. The bootstrap upgrades them to `segmentMatch`
  once the segments are there; if that step fails the rules still match the same traders.
- **`dark-mode-ios18` starts serving `true`, 17 and 16 serve `false`.** iOS 18 is
  "already shipped", which is what makes the per-OS sprawl visible in beat 6, and leaves
  iOS 17 as the one to roll out and break.
- **`quote-experience` starts on `static` and `pnl-display` on `percent`** — the current
  behaviour in both cases, so the experiment has a real control.

## Setup the SE does

- **Nothing for the core story.** The seed creates the flags; the bootstrap creates the
  segments and metrics; the traffic sidecar is already running when the URL goes live.
- **Wait about 60 seconds** after the instance is ready before beat 2, so the metrics
  have events. The fleet wall will be populated by then.
- **The two experiments in beat 7 are optional** and must be created in the UI; the flags
  and metrics they need are already there. Skip beat 7 if you are short of time.

## Known limitations

- **Guarded rollouts and experiments are not seeded**, because they are the thing the
  presenter demonstrates. Beats 2, 3 and 7 are clicks in the LaunchDarkly UI.
- **Session replay only records while a browser tab is open** on the demo URL. Open the
  page at the start of the call, not when you reach beat 4.
- **Counters on the fleet wall and the traffic log are cumulative** and never reset. If
  you rehearse and then present on the same instance, the percentages are averages across
  both. Pause and resume the instance for a clean slate — the container is disposable and
  the LaunchDarkly project survives.
- **The demo does not reset the flags for you.** After a run, `dark-mode` has whatever
  state you left it in. Relaunching is the clean reset; `scripts/reset-flags.sh` does it
  in place if you would rather keep the instance.
