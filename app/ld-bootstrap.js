/**
 * Creates the LaunchDarkly objects the Demo Depot seed importer cannot.
 *
 * The seed file handles flags. It does not yet apply rule-based segments
 * ("use flag rules instead") and does not create metrics at all — and without
 * metrics there is no guarded rollout, which is the whole demo. So this runs
 * once at startup and fills the gap over the REST API:
 *
 *   1. five custom metrics, randomised on `device`
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
const TOKEN = process.env.LD_API_TOKEN;
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
 * A fresh project has only the `user` context kind, so every metric below —
 * all of which randomise on `device` — fails with "Randomization unit device
 * not found in project settings", and the release policy fails with "context
 * kind device is not enabled for experimentation".
 *
 * The SDK auto-creates the kind the first time it sees one, but that is a race
 * with the container starting, and auto-created kinds are not enabled for
 * experimentation. So declare it explicitly, first, before anything references
 * it. This is scripts/01-context-kind.sh, which the depot path never ran.
 */
async function ensureDeviceContextKind() {
  const r = await api('PUT', `/api/v2/projects/${PROJECT}/context-kinds/device`, {
    name: 'Device',
    description: 'The phone or tablet running the trading app. Attributes: operating_system, os_version, model, app_version.',
    hideInTargeting: false,
    archived: false,
  });
  return { name: 'context kind device', ok: ok(r), status: r.status, body: r.body };
}

/** Without this, `device` cannot be a randomization unit for metrics or rollouts. */
async function enableDeviceForExperiments() {
  const r = await api('PUT', `/api/v2/projects/${PROJECT}/experimentation-settings`, {
    randomizationUnits: [
      { randomizationUnit: 'user', default: true },
      { randomizationUnit: 'device', default: false },
    ],
  });
  return { name: 'device as randomization unit', ok: ok(r), status: r.status, body: r.body };
}

async function createMetric(m) {
  const r = await api('POST', `/api/v2/metrics/${PROJECT}`, {
    key: m.key, name: m.name, description: m.description, kind: 'custom',
    eventKey: m.eventKey, isNumeric: m.isNumeric, unit: m.unit,
    successCriteria: m.successCriteria, randomizationUnits: ['device'], tags: ['demo'],
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
      rolloutContextKindKey: 'device',
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
  console.log(`ld-bootstrap: setting up project ${PROJECT}/${ENV}`);
  const results = [];
  // Order matters: the context kind has to exist and be enabled for
  // experimentation before any metric or the release policy can reference it.
  results.push(await ensureDeviceContextKind());
  results.push(await enableDeviceForExperiments());
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
  // Last: the metrics it references have to exist first.
  results.push(await createReleasePolicy());

  const failed = results.filter((r) => !r.ok);
  console.log(`ld-bootstrap: ${results.length - failed.length}/${results.length} steps ok`);
  for (const f of failed) {
    console.error(`ld-bootstrap: ${f.name} failed (${f.status}) ${String(f.body).slice(0, 160)}`);
  }
  if (failed.length) {
    console.error('ld-bootstrap: the demo still runs - the seeded flag rules target the same attributes directly. If the metrics or the release policy failed, pick render-error and screen-load-ms by hand when starting the guarded rollout.');
  }
}

// Never let setup take the container down.
module.exports = { bootstrap: () => bootstrap().catch((e) => console.error('ld-bootstrap: ' + e.message)) };

if (require.main === module) module.exports.bootstrap();
