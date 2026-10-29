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

function api(method, path, body, contentType) {
  const url = new URL(API + path);
  const payload = body ? JSON.stringify(body) : null;
  const headers = { Authorization: TOKEN, 'Content-Type': contentType || 'application/json' };
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

async function createMetric(m) {
  const r = await api('POST', `/api/v2/metrics/${PROJECT}`, {
    key: m.key, name: m.name, description: m.description, kind: 'custom',
    eventKey: m.eventKey, isNumeric: m.isNumeric, unit: m.unit,
    successCriteria: m.successCriteria, randomizationUnits: ['device'], tags: ['demo'],
  });
  return { name: `metric ${m.key}`, ok: ok(r), status: r.status, body: r.body };
}

async function createSegment(key, name, description, clauses) {
  const r = await api('POST', `/api/v2/segments/${PROJECT}/${ENV}`, {
    key, name, description, tags: ['demo'],
    rules: [{ clauses }],
  });
  return { name: `segment ${key}`, ok: ok(r), status: r.status, body: r.body };
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

async function bootstrap() {
  if (!TOKEN || !PROJECT) {
    console.log('ld-bootstrap: no LD_API_TOKEN/LD_PROJECT_KEY, skipping (expected when running locally)');
    return;
  }
  console.log(`ld-bootstrap: setting up project ${PROJECT}/${ENV}`);
  const results = [];
  for (const m of METRICS) results.push(await createMetric(m));
  for (const c of CITIES) {
    results.push(await createSegment(c.key, c.name, `Traders in ${c.city}. A phase of the city-sequenced dark-mode release.`,
      [{ contextKind: 'user', attribute: 'region', op: 'in', values: [c.city], negate: false }]));
  }
  for (const s of OS_SEGMENTS) {
    results.push(await createSegment(s.key, s.name, `Devices matching ${s.name}. Backs the per-OS flags and the experiment audience.`, s.clauses));
  }
  results.push(await useSegmentsOnDarkMode());

  const failed = results.filter((r) => !r.ok);
  console.log(`ld-bootstrap: ${results.length - failed.length}/${results.length} steps ok`);
  for (const f of failed) {
    console.error(`ld-bootstrap: ${f.name} failed (${f.status}) ${String(f.body).slice(0, 160)}`);
  }
  if (failed.length) {
    console.error('ld-bootstrap: the demo still runs - the seeded flag rules target the same attributes directly. Guarded rollouts need the metrics above, so create any that failed by hand.');
  }
}

// Never let setup take the container down.
module.exports = { bootstrap: () => bootstrap().catch((e) => console.error('ld-bootstrap: ' + e.message)) };

if (require.main === module) module.exports.bootstrap();
