#!/usr/bin/env node
/**
 * Brokerage dark-mode cohort-release demo — device traffic simulator.
 *
 * Simulates trading-app sessions across iOS 16/17/18 devices, evaluates the
 * dark-mode flag(s) for a user+device multi-context, simulates rendering the
 * portfolio screen, and tracks metrics back to LaunchDarkly.
 *
 * Runs TWO independent device populations at once so both demos are live
 * simultaneously and you never restart between them:
 *
 *   one      traders grouped by REGION ask the single `dark-mode` flag, which is
 *            sequenced Delhi -> Jaipur -> Goa   (recommended shape)
 *   optiona  devices grouped by OS COHORT ask their own `dark-mode-iosNN` flag,
 *            which is where the mobile render fault lives   (flag-per-OS comparison)
 *
 * The populations use disjoint device keys, so a guarded rollout on one shape
 * only ever analyses its own devices. Exposures never cross over.
 *
 * DEMO_MODE=both (default) | one | optiona
 * SESSIONS_PER_MINUTE is PER POPULATION; "both" therefore sends twice that.
 *
 * Metrics tracked: render-error, screen-load-ms, order-placed, order-cancelled,
 *                  holding-tapped
 *
 * The experiment runs in the OS-cohort population, so it slices by device.os_cohort:
 *
 *   quote-experience    THE DEVICE EXPERIMENT. Three experiences of rising richness:
 *                       static -> polled -> live. Render cost rises with richness, so
 *                       the WINNING experience differs by cohort: live wins clearly on
 *                       iOS 18, is marginal on iOS 17, and is worse than static on
 *                       iOS 16. One experiment, three experiences, a per-cohort answer.
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// The observability plugin instruments libraries by hooking the CommonJS loader,
// so it is required before everything else. OBSERVABILITY=false disables it
// entirely: the demo runs identically without it.
const OBSERVABILITY = !/^false$/i.test(process.env.OBSERVABILITY || 'true');
let Observability = null, LDObserve = null;
if (OBSERVABILITY) {
  try {
    ({ Observability, LDObserve } = require('@launchdarkly/observability-node'));
  } catch (e) {
    console.error('Observability plugin unavailable, continuing without it:', e.message);
    Observability = null; LDObserve = null;
  }
}

const ld = require('@launchdarkly/node-server-sdk');
const crypto = require('crypto');

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function parseMix3(s) {
  const parts = s.split(',').map((x) => Number(x.trim()));
  if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x))) {
    throw new Error(`expected three numbers for iOS 18,17,16 (got "${s}")`);
  }
  return { ios18: parts[0], ios17: parts[1], ios16: parts[2] };
}
function parseMix(s) {
  const parts = s.split(',').map((x) => Number(x.trim()));
  if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x)) || Math.abs(parts.reduce((a, b) => a + b, 0) - 100) > 0.01) {
    throw new Error(`mix must be three numbers summing to 100, e.g. 55,30,15 (got "${s}")`);
  }
  return parts;
}

const cfg = {
  sdkKey: process.env.LD_SDK_KEY,
  sessionsPerMinute: num(process.env.SESSIONS_PER_MINUTE, 600),
  osMix: parseMix(process.env.OS_MIX || '55,30,15'),
  buggyCohort: (process.env.BUGGY_COHORT || 'ios17').toLowerCase(),
  buggyRegion: (process.env.BUGGY_REGION || 'jaipur').toLowerCase(),
  regionMix: parseMix(process.env.REGION_MIX || '45,35,20'),
  failureRate: num(process.env.FAILURE_RATE, 0.3),
  fixApplied: /^true$/i.test(process.env.FIX_APPLIED || 'false'),
  errorThresholdPct: num(process.env.ERROR_THRESHOLD_PCT, 5),
  // Baseline order completion, used when a quote experience has no figure set.
  orderRateBase: num(process.env.ORDER_RATE_BASE, 0.08),
  cancelTwoStep: num(process.env.CANCEL_TWO_STEP, 0.005),
  // pnl-display A/B: share of sessions that open a holding. Showing the rupee
  // amount instead of a percentage is expected to draw more taps.
  holdingTapPercent: num(process.env.HOLDING_TAP_PERCENT, 0.22),
  holdingTapRupees: num(process.env.HOLDING_TAP_RUPEES, 0.29),
  // quote-experience: order completion per cohort for each experience, and the
  // render cost each experience adds. Richness helps until the device cannot
  // paint it, at which point it actively hurts.
  qeOrders: {
    static: parseMix3(process.env.QE_ORDERS_STATIC || '0.060,0.060,0.060'),
    polled: parseMix3(process.env.QE_ORDERS_POLLED || '0.085,0.080,0.075'),
    live:   parseMix3(process.env.QE_ORDERS_LIVE   || '0.130,0.090,0.040'),
  },
  qeLoad: {
    static: parseMix3(process.env.QE_LOAD_STATIC || '0,0,0'),
    polled: parseMix3(process.env.QE_LOAD_POLLED || '10,25,60'),
    live:   parseMix3(process.env.QE_LOAD_LIVE   || '15,120,520'),
  },
  // Healthy cohorts emit zero render errors so a guarded rollout on a healthy
  // cohort cannot produce a false regression from small-sample noise.
  baselineErrorRate: num(process.env.BASELINE_ERROR_RATE, 0),
  baselineLoadMs: 250,
  buggyExtraLoadMs: 600,
  refreshMs: 3000,
  demoMode: (process.env.DEMO_MODE || 'both').toLowerCase(),
};

// Exiting here used to be right for a CLI tool. It is wrong in the depot: every
// container in the task is essential: true, so this process exiting takes the
// demo page down with it. Log loudly and keep running instead — the SDK returns
// defaults and the dashboard shows the problem.
if (!cfg.sdkKey || cfg.sdkKey.startsWith('sdk-xxxx')) {
  console.error('LD_SDK_KEY is not set. Copy .env.example to .env and add your server-side SDK key.');
  console.error('Continuing without it: every flag will fall back to its default.');
}
if (!['both', 'one', 'optiona'].includes(cfg.demoMode)) {
  console.error(`DEMO_MODE must be "both", "one" or "optiona" (got "${cfg.demoMode}") - using "both"`);
  cfg.demoMode = 'both';
}

// ---------- Device catalogue ---------------------------------------------
const COHORTS = {
  ios18: { label: 'iOS 18', versions: ['18.0', '18.0.1', '18.1', '18.1.1', '18.2', '18.3', '18.4'] },
  ios17: { label: 'iOS 17', versions: ['17.0', '17.1', '17.2', '17.3', '17.4', '17.5', '17.6.1'] },
  ios16: { label: 'iOS 16', versions: ['16.0', '16.1', '16.2', '16.3.1', '16.4', '16.5', '16.7.10'] },
};
const MODELS = {
  ios18: ['iPhone 16 Pro', 'iPhone 16', 'iPhone 15', 'iPhone 14', 'iPad Pro 13" (M4)', 'iPad Air (M2)'],
  ios17: ['iPhone 15', 'iPhone 14', 'iPhone 13', 'iPhone 12', 'iPad (10th gen)', 'iPad mini (6th gen)'],
  ios16: ['iPhone 8', 'iPhone X', 'iPhone SE (2nd gen)', 'iPad (5th gen)', 'iPad Pro 9.7"', 'iPad mini 4'],
};
const APP_VERSIONS = ['5.12.0', '5.12.1', '5.13.0'];
const PLAN_TIERS = ['basic', 'plus', 'pro'];
const OPTION_A_FLAG = { ios18: 'dark-mode-ios18', ios17: 'dark-mode-ios17', ios16: 'dark-mode-ios16' };
const REGIONS = {
  delhi:  { label: 'Delhi',  city: 'Delhi'  },
  jaipur: { label: 'Jaipur', city: 'Jaipur' },
  goa:    { label: 'Goa',    city: 'Goa'    },
};

// Disjoint key prefixes keep each population's rollout sample to itself.
const FAMILIES = [
  {
    id: 'one',
    label: 'One flag — dark-mode, released city by city',
    prefix: 'one',
    groups: REGIONS,
    pickGroup: () => pickRegion(),
    flagFor: () => 'dark-mode',
    isBuggy: (g) => g === cfg.buggyRegion,
  },
  {
    id: 'optiona',
    label: 'A flag per OS — dark-mode-ios18 / ios17 / ios16',
    prefix: 'optA',
    groups: COHORTS,
    pickGroup: () => pickCohort(),
    flagFor: (g) => OPTION_A_FLAG[g],
    isBuggy: (g) => g === cfg.buggyCohort,
  },
];
const active = FAMILIES.filter((f) => cfg.demoMode === 'both' || cfg.demoMode === f.id);

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function weighted(keys, mix) {
  const r = Math.random() * 100;
  let acc = 0;
  for (let i = 0; i < keys.length; i++) { acc += mix[i]; if (r < acc) return keys[i]; }
  return keys[keys.length - 1];
}
const pickCohort = () => weighted(['ios18', 'ios17', 'ios16'], cfg.osMix);
const pickRegion = () => weighted(['delhi', 'jaipur', 'goa'], cfg.regionMix);

// Fresh device key per session so distinct-device counts grow quickly;
// guarded rollouts need a minimum number of *contexts* per step.
function buildContext(family, group) {
  // The region population still runs on real devices, so pick an OS at random;
  // the OS just is not what the release is sequenced by.
  const cohort = family.id === 'one' ? pickCohort() : group;
  const user = {
    key: `${family.prefix}-usr-${crypto.randomUUID().slice(0, 8)}`,
    plan_tier: pick(PLAN_TIERS),
  };
  if (family.id === 'one') user.region = REGIONS[group].city;
  return {
    kind: 'multi',
    user,
    device: {
      key: `${family.prefix}-dev-${crypto.randomUUID().slice(0, 12)}`,
      operating_system: 'iOS',
      os_version: pick(COHORTS[cohort].versions),
      os_cohort: cohort,
      model: pick(MODELS[cohort]),
      app_version: pick(APP_VERSIONS),
    },
  };
}

// ---------- Stats ---------------------------------------------------------
function freshGroupStats(groups) {
  const s = {};
  for (const g of Object.keys(groups)) s[g] = { sessions: 0, dark: 0, errors: 0, loadTotal: 0, orders: 0, cancels: 0 };
  return s;
}
const stats = {};
for (const f of active) stats[f.id] = freshGroupStats(f.groups);
let totalSessions = 0;
const startedAt = Date.now();

// ---------- Session -------------------------------------------------------
async function renderPortfolio(client, family, group, ctx, s) {
  const flagKey = family.flagFor(group);
  const darkMode = await client.variation(flagKey, ctx, false);
  if (darkMode) s.dark++;

  // Simulate rendering the portfolio screen.
  const buggy = darkMode && family.isBuggy(group) && !cfg.fixApplied;
  const errorRate = buggy ? cfg.failureRate : cfg.baselineErrorRate;
  const jitter = (Math.random() - 0.5) * 80; // ±40ms

  // quote-experience is a device-capability experiment, so it runs in the
  // OS-cohort population and its cost lands on render time.
  let quotes = 'static', qePenalty = 0;
  if (family.id === 'optiona') {
    quotes = await client.variation('quote-experience', ctx, 'static');
    if (!cfg.qeLoad[quotes]) quotes = 'static';
    qePenalty = cfg.qeLoad[quotes][group] || 0;
  }

  const loadMs = Math.round(cfg.baselineLoadMs + jitter + qePenalty + (buggy ? cfg.buggyExtraLoadMs : 0));
  const error = Math.random() < errorRate;

  // Telemetry carries the cohort and the flag value, so every error, log and span
  // in LaunchDarkly can be sliced by OS cohort and by whether dark mode was on.
  const attrs = {
    'app.cohort': group,
    'app.os_version': ctx.device.os_version,
    'app.device_model': ctx.device.model,
    'app.app_version': ctx.device.app_version,
    'app.screen': 'portfolio',
    'feature.flag_key': flagKey,
    'feature.dark_mode': darkMode,
    'feature.demo_shape': family.id,
    'app.screen_load_ms': loadMs,
    'feature.quote_experience': quotes,
  };
  if (LDObserve) {
    try { LDObserve.setAttributes(attrs); } catch (_) { /* never break a session */ }
  }

  if (error) { s.errors++; client.track('render-error', ctx); }
  s.loadTotal += loadMs;
  client.track('screen-load-ms', ctx, undefined, loadMs);

  if (LDObserve) {
    try {
      if (error) {
        const err = new Error(
          `Portfolio screen failed to render on ${ctx.device.model} (iOS ${ctx.device.os_version}) with dark mode ${darkMode ? 'on' : 'off'}`);
        err.name = 'PortfolioRenderError';
        LDObserve.recordError(err, undefined, undefined, attrs);
        LDObserve.recordLog(
          `render failed: group=${group} dark_mode=${darkMode} load_ms=${loadMs}`, 'error',
          undefined, undefined, attrs);
      } else {
        LDObserve.recordLog(
          `portfolio rendered: group=${group} dark_mode=${darkMode} load_ms=${loadMs}`, 'info',
          undefined, undefined, attrs);
      }
      LDObserve.recordHistogram({ name: 'portfolio.screen_load_ms', value: loadMs, attributes: attrs });
    } catch (_) { /* telemetry must never break a session */ }
  }

  // The order-confirmation experiment rides on the OS-COHORT population, not the
  // region one: results are sliced by OS cohort, so every cohort needs traffic.
  // Deliberately not gated on dark mode, which would restrict it to shipped cohorts.
  if (family.id === 'optiona' && !error) {
    // order-confirm-flow's experiment is stopped; left unevaluated so it cannot
    // reappear as a confound. Re-enable if that experiment is restarted.
    // Completion is set by the quote experience for this cohort. order-confirm-flow
    // is no longer running, so its lift is not applied.
    const completion = Math.max(0.005, cfg.qeOrders[quotes][group] || cfg.orderRateBase);
    const pnl = await client.variation('pnl-display', ctx, 'percent');
    const tapRate = pnl === 'rupees' ? cfg.holdingTapRupees : cfg.holdingTapPercent;
    if (Math.random() < tapRate) client.track('holding-tapped', ctx);

    if (Math.random() < completion) {
      s.orders++;
      client.track('order-placed', ctx);
      // Mis-trade: the trader cancels shortly after placing. One tap makes an
      // accidental order easier, and more so on slower devices.
      const cancelRate = cfg.cancelTwoStep;
      if (Math.random() < cancelRate / completion) {
        s.cancels++;
        client.track('order-cancelled', ctx);
      }
    }
  }
}

async function runSession(client, family) {
  const group = family.pickGroup();
  const ctx = buildContext(family, group);
  const s = stats[family.id][group];
  s.sessions++; totalSessions++;

  if (!LDObserve) return renderPortfolio(client, family, group, ctx, s);
  // One span per simulated session, so Traces shows the render path per group.
  try {
    return await LDObserve.runWithHeaders('GET /portfolio', {},
      () => renderPortfolio(client, family, group, ctx, s));
  } catch (e) {
    return renderPortfolio(client, family, group, ctx, s);
  }
}

// ---------- Dashboard -----------------------------------------------------
const RED = '\x1b[31m', GREEN = '\x1b[32m', DIM = '\x1b[2m', BOLD = '\x1b[1m', RESET = '\x1b[0m';
// Non-TTY (container) logging cadence.
const LOG_EVERY_MS = num(process.env.LOG_EVERY_MS, 15000);
let lastLogAt = 0;
function pad(v, w, right) { v = String(v); return right ? v.padStart(w) : v.padEnd(w); }
function pct(n, d) { return d ? ((100 * n) / d).toFixed(1) + '%' : '-'; }

function render() {
  const upSec = Math.round((Date.now() - startedAt) / 1000);
  const rate = cfg.sessionsPerMinute * active.length;
  const lines = [];
  const obs = LDObserve ? 'observability on' : 'observability off';
  lines.push(`${BOLD}Brokerage app — device traffic simulator${RESET}   ${DIM}up ${upSec}s · ${rate}/min · buggy region=${cfg.buggyRegion} · buggy cohort=${cfg.buggyCohort} · fix=${cfg.fixApplied} · ${obs}${RESET}`);

  for (const f of active) {
    lines.push('');
    lines.push(`${BOLD}${f.label}${RESET}`);
    lines.push(`${BOLD}${pad(f.id === 'one' ? 'Region' : 'Cohort', 9)}${pad('Sessions', 10, true)}${pad('Dark mode', 11, true)}${pad('Render err', 12, true)}${pad('Avg load', 10, true)}${pad('Orders', 8, true)}${pad('Cancels', 9, true)}${RESET}`);
    lines.push('-'.repeat(69));
    for (const [key, meta] of Object.entries(f.groups)) {
      const s = stats[f.id][key];
      const errPct = s.sessions ? (100 * s.errors) / s.sessions : 0;
      const colour = errPct > cfg.errorThresholdPct ? RED : GREEN;
      const avgLoad = s.sessions ? Math.round(s.loadTotal / s.sessions) + 'ms' : '-';
      lines.push(`${colour}${pad(meta.label, 9)}${pad(s.sessions, 10, true)}${pad(pct(s.dark, s.sessions), 11, true)}${pad(pct(s.errors, s.sessions), 12, true)}${pad(avgLoad, 10, true)}${pad(s.orders, 8, true)}${pad(s.cancels, 9, true)}${RESET}`);
    }
    lines.push('-'.repeat(69));
  }
  lines.push(`${DIM}Total sessions: ${totalSessions}   ·   red row = render error % > ${cfg.errorThresholdPct}%   ·   Ctrl+C to stop (flushes events)${RESET}`);
  if (!process.stdout.isTTY) {
    // Container logs: a screen repaint every second is noise. One summary line
    // every LOG_EVERY_MS, which is what the Demo Depot portal tails.
    if (Date.now() - lastLogAt < LOG_EVERY_MS) return;
    lastLogAt = Date.now();
    const parts = [];
    for (const f of active) {
      for (const [key, meta] of Object.entries(f.groups)) {
        const s = stats[f.id][key];
        if (!s.sessions) continue;
        parts.push(`${meta.label}=${pct(s.dark, s.sessions)} dark/${pct(s.errors, s.sessions)} err`);
      }
    }
    console.log(`sessions=${totalSessions} ${parts.join('  ')}`);
    return;
  }
  process.stdout.write('\x1b[2J\x1b[H' + lines.join('\n') + '\n');
}

// ---------- Main ----------------------------------------------------------
async function main() {
  const options = {};
  if (Observability) {
    try {
      options.plugins = [new Observability({
        serviceName: 'brokerage-trading-api',
        serviceVersion: 'demo-5.13.0',
      })];
    } catch (e) {
      console.error('Could not construct Observability plugin, continuing without it:', e.message);
    }
  }
  const client = ld.init(cfg.sdkKey, options);
  try {
    await client.waitForInitialization({ timeout: 10 });
  } catch (e) {
    // Log and carry on. Every container in a Fargate task shares a lifecycle, so
    // exiting here would take the web container down with it. The SDK retries on
    // its own and variation() falls back to its default until a payload arrives.
    console.error('LaunchDarkly SDK not ready yet:', e.message, '- generating traffic anyway, will keep retrying');
  }

  const intervalMs = 60000 / cfg.sessionsPerMinute;
  const timers = active.map((f) =>
    setInterval(() => { runSession(client, f).catch((e) => console.error('session error', e)); }, intervalMs));
  const renderTimer = setInterval(render, cfg.refreshMs);
  render();

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return; shuttingDown = true;
    for (const t of timers) clearInterval(t);
    clearInterval(renderTimer);
    process.stdout.write('\nFlushing LaunchDarkly events...');
    try { await client.flush(); } catch (_) { /* best effort */ }
    if (LDObserve) { try { await LDObserve.flush(); } catch (_) { /* best effort */ } }
    await client.close();
    process.stdout.write(' done.\n');
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
