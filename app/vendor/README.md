# Vendored browser SDKs

These are the LaunchDarkly browser bundles the demo page imports, committed
rather than fetched from a CDN at page load.

| File | Package |
| --- | --- |
| `ld-client.js` | `launchdarkly-js-client-sdk@3.9.5` |
| `ld-observability.js` | `@launchdarkly/observability@1.1.23` |
| `ld-session-replay.js` | `@launchdarkly/session-replay@1.1.23` |

## Why they are here

The page used to `import` these from esm.sh. On 2026-10-30 esm.sh began returning
HTTP 500 for all three — while serving other packages fine — and the demo page
rendered an empty shell: the phone and the whole fleet wall are drawn by that
module script, so when it fails to load, nothing appears. There is no recovery
mid-call, and the cause is entirely outside our control.

A demo shown to customers should not depend on a third-party CDN being healthy at
the moment you present it. These are self-contained ESM bundles with no runtime
imports of their own, so serving them from the app removes the dependency
completely.

## Refreshing them

```bash
./scripts/vendor-sdks.sh          # re-downloads the pinned versions
```

Bump the versions in that script to upgrade, and re-run it. Keep the versions in
step with `app/package.json` where they overlap.
