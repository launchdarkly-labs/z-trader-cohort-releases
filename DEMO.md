## What this shows

**This is the core Code Control demo.** Use it for any conversation about
releasing to a fragmented base: a mobile device estate, audiences held as
segments, a guarded release per audience, and automatic rollback of the one
cohort that regresses. The app happens to be a stock trading app, but nothing in
the story depends on that — swap "city" for region, tier, tenant or store and the
demo is unchanged.

The problem it answers: you ship one app to devices running three different OS
versions, across audiences that behave differently. A change that renders fine on
the newest OS can break on an older one. Ship to everyone and you break everyone;
hold the release for the slowest cohort and nobody gets it. What is missing is
not monitoring — the alert fires fine. It is a way to release to one audience at
a time and have the platform take back only the audience that broke.

Two shapes of that are shown side by side, each with its own guarded release:

1. **One flag, audience by audience.** `dark-mode` has three rules, one per
   audience segment. Rule order is the release sequence. The audience that
   regresses reverts on its own; the audiences already live keep the feature.
2. **A flag per OS version.** `dark-mode-ios18/17/16` is the same outcome built
   the other way. iOS 18 is already shipped; running a guarded release on
   `dark-mode-ios17` breaks and reverts while iOS 18 stays shipped — which is
   what makes the cost of the sprawl concrete rather than asserted.

## LaunchDarkly features

- **Guarded rollouts** — a release that watches `render-error` and
  `screen-load-ms` and reverts the phase that regresses, with no human in the loop.
- **Audience-based release** — one flag, one rule per audience. Rule order is the
  sequence, so a rollback touches one rule and leaves the rest alone.
- **Segments as reusable audiences** — the same six segments back the release, the
  experiment audiences and the monitoring filters.
- **Per-flag releases on a device base** — the per-OS flags, each independently
  releasable and independently reversible.
- **Observability** — errors, logs, traces and session replay from backend and
  browser, each carrying `feature.dark_mode` and the flag key.
- **Multi-contexts** — every evaluation sends a `user` and a `device`, so the
  release is sequenced on the user's audience while rollouts bucket on the device.
- **Experimentation** — two experiments reusing the same segments.

## The story (about 12 minutes)

Timings are cumulative. Go straight at the audience that breaks — there is no
value in watching a healthy phase walk its steps for three minutes.

1. **Open the app.** (0:00 → 1:30) Left is one device; right is a wall of real
   devices, one tile per context, grouped by audience. **Delhi is already dark —
   that audience shipped last week.** Jaipur and Goa are still light. Say: *"Every
   tile is a real evaluation. The app asks one question — `dark-mode` — for a user
   and their device together. It has no idea what an audience or a cohort is. One
   audience already has this feature; today we are releasing it to the next one."*

2. **Release to one audience, and let it break.** (1:30 → 4:00) On `dark-mode`,
   open the **Jaipur** rule → Edit → Serve → **Guarded rollout**. The metrics,
   steps and auto-rollback are pre-filled by the project's release policy —
   confirm `render-error` and `screen-load-ms` are listed, then start it. Set the
   device picker to **Jaipur** and watch both halves of the screen.

   Jaipur starts at 25%, roughly 4 of 18 tiles go dark, and within a minute the
   row turns red: the device throws a real `TypeError` and the guarded rollout
   reverts **that rule only**. Say: *"One audience at a time, with guardrails on
   every step. LaunchDarkly caught it at 25% of one audience, rolled that
   audience back, and left everyone else alone. No human in the loop."*

   **This is the aha moment** — stop talking and let them watch it revert.

3. **Show the blast radius.** (4:00 → 5:00) Point at Delhi, still dark. Say:
   *"Delhi still has it. The rollback took one audience, not the feature. The
   audience that was already live never flinched, Goa was never exposed, nothing
   was redeployed, and nobody restarted the app."*

   This is the line that separates a guarded release from a kill switch: a kill
   switch would have turned dark mode off for Delhi too.

4. **Show the evidence.** (5:00 → 6:30) Monitoring → the error is grouped by
   exception and filterable by `feature.dark_mode`; the session replay shows the
   broken screen as the user saw it; Change history has the release, the steps,
   the regression and the rollback with timestamps. Say: *"The flag value is an
   attribute on the telemetry, not something you infer from a deploy timestamp —
   and compliance gets the same story you just watched."*

5. **Fix forward.** (6:30 → 7:30) Set **Clear the fault** to `true` at launch, or
   flip `FIX_APPLIED`, and re-run Jaipur. It passes and completes to 100%.

6. **The same thing, one flag per OS version.** (7:30 → 9:00) Open
   `dark-mode-ios18`, `ios17` and `ios16` side by side. iOS 18 is already
   serving. Say: *"Same outcome, built the other way. Three flags, three
   rollouts, three metric sets — and the cohort is now part of the flag key."*

7. **Run the per-OS guarded release, and break that too.** (9:00 → 11:00) Start a
   guarded rollout on **`dark-mode-ios17`**. iOS 17 carries the fault
   (`BUGGY_COHORT`), so the iOS 17 row turns red and that flag reverts — while
   `dark-mode-ios18` stays shipped and `ios16` is untouched. Say: *"Per-flag
   releases work. You just maintain three of everything, and every new OS version
   is a new flag instead of a new segment."*

8. **Reuse the audiences.** (11:00 → 12:30) The `quote-experience` experiment runs
   on the same OS segments. Filter results by `os_cohort`: the live price stream
   wins on iOS 18, is marginal on iOS 17, and loses on iOS 16. Say: *"There is no
   single winning experience, and you only get that finding because the audience
   was already defined."*

Short on time: beats 1–4 are the demo. Beats 6–7 are the comparison, beat 8 is a
bonus.

## Created during the demo

Nothing in LaunchDarkly is created by a tool on the SE's behalf, but two things are
created **by the presenter during the call** and are deliberately not seeded — seeding
them would leave the demo with nothing to do:

| Key or pattern | Created by | When |
| --- | --- | --- |
| The guarded rollout on the `dark-mode` Jaipur rule | Presenter, in the UI | Beats 2 and 5 |
| The guarded rollout on `dark-mode-ios17` | Presenter, in the UI | Beat 7 |
| The `quote-experience-os` and `pnl-display-ab` experiments | Presenter, in the UI | Beat 8 (optional) |

The six **segments**, five **metrics** and the **release policy** are not in
`ld/seed.json` either, but for a different reason: the seed importer applies only
list-based segments, and creates neither metrics nor policies. `app/ld-bootstrap.js`
creates all of them over the API at startup with the `project-writer` token, repoints
`dark-mode`'s three audience rules at the segments, and pre-fills every guarded release
in the project with `render-error`, `screen-load-ms`, auto-rollback and two 1-minute
steps. It is idempotent and never fatal — check the `web` container's log for
`ld-bootstrap: 13/13 steps ok`.

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

- **`dark-mode` starts ON with Delhi serving `true`, Jaipur and Goa `false`.** The flag
  has to be on for a guarded rollout to be startable. Delhi is seeded as *already
  shipped* so the demo opens mid-sequence: when Jaipur reverts, the audience that was
  already live visibly keeps the feature, which is the isolation argument. Jaipur and Goa
  start light or there is no release to run. The rules exist up front because rule
  *order* is the release sequence.
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

- **Your LaunchDarkly API token in Demo Depot Settings must have the Admin role.**
  This demo sets `apiToken: project-writer`, so the depot mints a service token for
  the container at launch. A Writer-role token is denied `createAccessToken` and the
  launch fails before the container starts, with a 403 on `POST /api/v2/tokens`. A
  Writer token is enough for every other part of the demo, so this is easy to miss.
- **Nothing for the core story.** The seed creates the flags; the bootstrap creates the
  segments, the metrics and the release policy; the traffic sidecar is already running
  when the URL goes live.
- **Wait about 60 seconds** after the instance is ready before beat 2, so the metrics
  have events. The fleet wall will be populated by then, and a rollout started
  before that can roll back for insufficient sample rather than a real regression.
- **Confirm the guarded-rollout dialog is pre-filled** when you open it in beat 2. If the
  metrics are empty, the release policy did not apply — pick `render-error` (primary) and
  `screen-load-ms`, set two 1-minute steps and enable rollback on regression by hand. The
  demo is unaffected otherwise.
- **The two experiments in beat 8 are optional** and must be created in the UI; the flags
  and metrics they need already exist.

## Known limitations

- **Guarded rollouts and experiments are not seeded**, because they are the thing the
  presenter demonstrates. Beats 2, 5, 7 and 8 are clicks in the LaunchDarkly UI.
- **Session replay only records while a browser tab is open** on the demo URL. Open the
  page at the start of the call, not when you reach beat 4.
- **Counters on the fleet wall and the traffic log are cumulative** and never reset. If
  you rehearse and then present on the same instance, the percentages are averages across
  both. Pause and resume the instance for a clean slate — the container is disposable and
  the LaunchDarkly project survives.
- **The demo does not reset the flags for you.** After a run, `dark-mode` has whatever
  state you left it in. Relaunching is the clean reset; `scripts/reset-flags.sh` does it
  in place if you would rather keep the instance.
