/**
 * Creates the LaunchDarkly objects the Demo Depot seed importer cannot.
 *
 * The seed file handles flags. It does not yet apply rule-based segments
 * ("use flag rules instead") and does not create metrics at all — and without
 * metrics there is no guarded rollout, which is the whole demo. So this runs
 * once at startup and fills the gap over the REST API:
 *
 *   1. five custom metrics, randomised on `user`
 *   2. six rule-based segments (three cities, three OS ranges)
 *   3. repoints dark-mode's three city rules at the city segments, so the
 *      LaunchDarkly UI tells the "audiences are reusable objects" story
 *
 * Everything is idempotent and nothing here is fatal. Without LD_API_TOKEN it
 * does nothing at all, which is the normal case when you run the demo locally:
 * your own project already has these objects.
 */
'use strict';

const https = require('https');

const API = process.env.LD_API_BASE || 'https://app.launchdarkly.com';
// Prefer the owner's setup token when present. The injected LD_API_TOKEN can do
// flags, segments, environments and AI Configs, but its inline role has no
// `metric` resource, so it cannot create the metrics a guarded rollout needs.
// LD_SETUP_TOKEN is a demo secret the owner sets once in the portal; every launch
// gets it, and SEs launching the demo do nothing. Falls back to LD_API_TOKEN so a
// local run, or a launch before the secret is set, still does what it can.
const TOKEN = process.env.LD_SETUP_TOKEN || process.env.LD_API_TOKEN;
const USING_SETUP_TOKEN = Boolean(process.env.LD_SETUP_TOKEN);
const PROJECT = process.env.LD_PROJECT_KEY;
const ENV = process.env.LD_ENV_KEY || process.env.LD_ENVIRONMENT_KEY || 'production';

const SEMANTIC_PATCH = 'application/json; domain-model=launchdarkly.semanticpatch';

function api(method, path, body, contentType, extraHeaders) {
  const url = new URL(API + path);
  const payload = body ? JSON.stringify(body) : null;
  const headers = Object.assign(
    { Authorization: TOKEN, 'Content-Type': contentType || 'application/json' },
    extraHeaders || {});
  if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
  return new Promise((resolve) => {
    const req = https.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', (e) => resolve({ status: 0, body: e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

// A 409 means it is already there, which for an idempotent step is success.
const ok = (r) => (r.status >= 200 && r.status < 300) || r.status === 409;

const METRICS = [
  { key: 'render-error', name: 'Render error', eventKey: 'render-error', isNumeric: false,
    successCriteria: 'LowerThanBaseline',
    description: 'Portfolio screen failed to render. The primary regression signal for the guarded rollout.' },
  { key: 'screen-load-ms', name: 'Screen load time (ms)', eventKey: 'screen-load-ms', isNumeric: true,
    unit: 'ms', successCriteria: 'LowerThanBaseline',
    description: 'Portfolio screen load time in milliseconds.' },
  { key: 'order-placed', name: 'Order placed', eventKey: 'order-placed', isNumeric: false,
    successCriteria: 'HigherThanBaseline',
    description: 'Session ended with a trade order. Primary metric for the quote-experience experiment.' },
  { key: 'order-cancelled', name: 'Order cancelled after placement', eventKey: 'order-cancelled',
    isNumeric: false, successCriteria: 'LowerThanBaseline',
    description: 'Trader cancelled an order shortly after placing it - the mis-trade guardrail.' },
  { key: 'holding-tapped', name: 'Holding opened', eventKey: 'holding-tapped', isNumeric: false,
    successCriteria: 'HigherThanBaseline',
    description: 'Trader opened a holding to look closer. Primary metric for the pnl-display experiment.' },
];

const CITIES = [
  { key: 'region-delhi', name: 'Delhi', city: 'Delhi' },
  { key: 'region-jaipur', name: 'Jaipur', city: 'Jaipur' },
  { key: 'region-goa', name: 'Goa', city: 'Goa' },
];

// semVer ">= X" has no operator of its own: it is NOT (semVerLessThan X).
const OS_SEGMENTS = [
  { key: 'ios-18-plus', name: 'iOS 18+', clauses: [
    { contextKind: 'device', attribute: 'os_version', op: 'semVerLessThan', values: ['18.0.0'], negate: true } ] },
  { key: 'ios-17', name: 'iOS 17', clauses: [
    { contextKind: 'device', attribute: 'os_version', op: 'semVerLessThan', values: ['17.0.0'], negate: true },
    { contextKind: 'device', attribute: 'os_version', op: 'semVerLessThan', values: ['18.0.0'], negate: false } ] },
  { key: 'ios-16-and-older', name: 'iOS 16 and older', clauses: [
    { contextKind: 'device', attribute: 'os_version', op: 'semVerLessThan', values: ['17.0.0'], negate: false } ] },
];

/**
 * Everything here randomises on `user`, not `device`.
 *
 * `device` would be the nicer unit — a trader on two devices then counts twice —
 * but it is not reachable from here. A fresh project has only the `user` context
 * kind, and the depot's service token is scoped `project-writer`, which cannot
 * createContextKind or updateExperimentationSettings. Verified on a real launch:
 * both calls failed, so every metric failed with "Randomization unit device not
 * found in project settings" and the release policy with "context kind device is
 * not enabled for experimentation". The manifest can only ask for `none` or
 * `project-writer`, so there is no higher privilege to request.
 *
 * `user` is also the better fit for this story: the release is sequenced by the
 * user's audience, so bucketing the rollout by user is what the narrative claims.
 * Targeting is unaffected — the `device` kind is auto-created by the SDK on first
 * evaluation and the iOS segments clause on device.os_version regardless, because
 * targeting a kind does not require it to be a randomization unit.
 */
async function createMetric(m) {
  const r = await api('POST', `/api/v2/metrics/${PROJECT}`, {
    key: m.key, name: m.name, description: m.description, kind: 'custom',
    eventKey: m.eventKey, isNumeric: m.isNumeric, unit: m.unit,
    successCriteria: m.successCriteria, randomizationUnits: ['user'], tags: ['demo'],
  });
  return { name: `metric ${m.key}`, ok: ok(r), status: r.status, body: r.body };
}

/**
 * Creates a segment AND its rule.
 *
 * POST /segments accepts key, name, description and tags, and silently ignores
 * `rules` — the segment comes back with rulesCount 0. The rule has to go on in a
 * second call, as an addRule semantic patch. Getting this wrong is invisible in a
 * project where the segments already exist (every POST is a 409 and the rule path
 * never runs), and fatal in a fresh one: the segments match nobody, so every flag
 * rule pointing at them serves the fallthrough.
 */
async function createSegment(key, name, description, clauses) {
  const created = await api('POST', `/api/v2/segments/${PROJECT}/${ENV}`, {
    key, name, description, tags: ['demo'],
  });
  if (!ok(created)) {
    return { name: `segment ${key}`, ok: false, status: created.status, body: created.body };
  }

  // Already there from a previous boot, and already ruled? Leave it alone.
  const existing = await api('GET', `/api/v2/segments/${PROJECT}/${ENV}/${key}`);
  if (existing.status === 200) {
    try {
      if (((JSON.parse(existing.body).rules) || []).length) {
        return { name: `segment ${key}`, ok: true, status: 200, body: 'already has a rule' };
      }
    } catch (_) { /* fall through and try to add the rule */ }
  }

  const patched = await api('PATCH', `/api/v2/segments/${PROJECT}/${ENV}/${key}`, {
    comment: 'depot bootstrap: targeting rule',
    instructions: [{ kind: 'addRule', description: name, clauses }],
  }, SEMANTIC_PATCH);
  if (!ok(patched)) {
    return { name: `segment ${key} rule`, ok: false, status: patched.status, body: patched.body };
  }

  // Trust nothing: read it back and confirm the rule is actually there.
  const check = await api('GET', `/api/v2/segments/${PROJECT}/${ENV}/${key}`);
  let ruleCount = 0;
  try { ruleCount = ((JSON.parse(check.body).rules) || []).length; } catch (_) { /* reported below */ }
  return ruleCount > 0
    ? { name: `segment ${key}`, ok: true, status: 200, body: `${ruleCount} rule(s)` }
    : { name: `segment ${key}`, ok: false, status: check.status,
        body: 'created but has no targeting rule, so it matches nobody' };
}

/** Point the three city rules at the city segments now that they exist. */
async function useSegmentsOnDarkMode() {
  const got = await api('GET', `/api/v2/flags/${PROJECT}/dark-mode?env=${ENV}`);
  if (got.status !== 200) return { name: 'dark-mode rules', ok: false, status: got.status, body: got.body };
  let env;
  try { env = JSON.parse(got.body).environments[ENV]; }
  catch (e) { return { name: 'dark-mode rules', ok: false, status: 0, body: 'unparseable flag' }; }

  const instructions = [];
  for (const city of CITIES) {
    const rule = (env.rules || []).find((r) => r.description === city.name);
    if (!rule) continue;
    // Already a segment rule from a previous boot: leave it alone.
    if ((rule.clauses || []).some((c) => c.op === 'segmentMatch')) continue;
    const clause = (rule.clauses || [])[0];
    if (!clause) continue;
    instructions.push({
      kind: 'updateClause', ruleId: rule._id, clauseId: clause._id,
      clause: { contextKind: 'user', attribute: 'segmentMatch', op: 'segmentMatch',
                values: [city.key], negate: false },
    });
  }
  if (!instructions.length) return { name: 'dark-mode rules', ok: true, status: 200, body: 'already using segments' };

  const r = await api('PATCH', `/api/v2/flags/${PROJECT}/dark-mode`, {
    environmentKey: ENV, comment: 'depot bootstrap: use the city segments', instructions,
  }, SEMANTIC_PATCH);
  return { name: 'dark-mode rules', ok: ok(r), status: r.status, body: r.body };
}

/**
 * Pre-fills every guarded release in this project with the demo's settings, so
 * the SE picks "Guarded rollout" and the metrics, steps and rollback are already
 * right. Without it they have to select render-error and screen-load-ms by hand,
 * mid-call, which is exactly the fumble the runbook used to walk them into.
 *
 * Scoped to the environment, not to a flag tag: the seed schema has no `tags`
 * field for flags, so a flagTagKeys scope would match nothing. Each launch gets
 * its own throwaway project, so an environment-wide policy is safe here.
 *
 * Two stages, not four. 100% is implicit when the phase ends, so 25 -> 50 ->
 * done completes a healthy phase in about two minutes. A regressing phase trips
 * on the first stage either way.
 */
async function createReleasePolicy() {
  const r = await api('POST', `/api/v2/projects/${PROJECT}/release-policies`, {
    key: 'demo-guarded-1min',
    name: 'Demo: guarded, 1-minute steps',
    description: 'Cohort-release demo pacing. Short steps so a healthy phase completes inside the demo.',
    releaseMethod: 'guarded-release',
    scope: { environmentKeys: [ENV] },
    guardedReleaseConfig: {
      rolloutContextKindKey: 'user',
      minSampleSize: 50,
      rollbackOnRegression: true,
      metricKeys: ['render-error', 'screen-load-ms'],
      stages: [
        { allocation: 25000, durationMillis: 60000 },
        { allocation: 50000, durationMillis: 60000 },
      ],
    },
  }, undefined, { 'LD-API-Version': 'beta' });
  return { name: 'release policy', ok: ok(r), status: r.status, body: r.body };
}

async function bootstrap() {
  if (!TOKEN || !PROJECT) {
    console.log('ld-bootstrap: no LD_API_TOKEN/LD_PROJECT_KEY, skipping (expected when running locally)');
    return;
  }
  console.log(`ld-bootstrap: setting up project ${PROJECT}/${ENV}`
    + (USING_SETUP_TOKEN ? ' (owner setup token)' : ' (injected project token — metrics will be refused)'));
  const results = [];
  for (const m of METRICS) results.push(await createMetric(m));
  for (const c of CITIES) {
    results.push(await createSegment(c.key, c.name, `Traders in ${c.city}. A phase of the city-sequenced dark-mode release.`,
      [{ contextKind: 'user', attribute: 'region', op: 'in', values: [c.city], negate: false }]));
  }
  for (const s of OS_SEGMENTS) {
    results.push(await createSegment(s.key, s.name, `Devices matching ${s.name}. Backs the per-OS flags and the experiment audience.`, s.clauses));
  }
  // Only repoint the flag if every city segment actually has a rule. Pointing a
  // flag rule at an empty segment is worse than leaving it on the attribute
  // clause: it matches nobody and the demo silently serves light mode to all.
  const citiesOk = CITIES.every((c) => {
    const r = results.find((x) => x.name === `segment ${c.key}`);
    return r && r.ok;
  });
  if (citiesOk) {
    results.push(await useSegmentsOnDarkMode());
  } else {
    console.error('ld-bootstrap: city segments are not usable, leaving dark-mode on its attribute clauses (the demo still works)');
  }
  // The release policy names metrics, so it is pointless without them.
  const metricsOk = METRICS.every((m) => {
    const r = results.find((x) => x.name === `metric ${m.key}`);
    return r && r.ok;
  });
  if (metricsOk) {
    results.push(await createReleasePolicy());
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`ld-bootstrap: ${results.length - failed.length}/${results.length} steps ok`);
  for (const f of failed) {
    console.error(`ld-bootstrap: ${f.name} failed (${f.status}) ${String(f.body).slice(0, 160)}`);
  }
  if (failed.length) {
    if (failed.some((f) => f.name.startsWith('metric '))) {
      console.error([
        'ld-bootstrap: metrics could not be created, and a guarded rollout needs one to watch.',
        '  The injected LD_API_TOKEN cannot create metrics: its inline role covers proj/<key>,',
        '  env/*, flag/*, segment/* and aiconfig/*, and `metric` is not in that list.',
        '  FIX ONCE, FOR EVERY LAUNCH: the demo owner sets the LD_SETUP_TOKEN demo secret in',
        '  the portal at /owners/z-trader-cohort-releases to a LaunchDarkly API token that can',
        '  create metrics. Nothing changes for whoever launches the demo.',
        '  To carry on without it, create two metrics by hand in this project:',
        '    render-error    custom, event key render-error,   lower is better',
        '    screen-load-ms  custom, event key screen-load-ms, lower is better, unit ms',
        '  The app is already sending both events, so they will have data within a minute.',
      ].join('\n'));
    }
    console.error('ld-bootstrap: everything else is in place - the seeded flag rules target the same attributes directly, so targeting and the release sequence work regardless.');
  }
}

// Never let setup take the container down.
module.exports = { bootstrap: () => bootstrap().catch((e) => console.error('ld-bootstrap: ' + e.message)) };

if (require.main === module) module.exports.bootstrap();
