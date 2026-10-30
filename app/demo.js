#!/usr/bin/env node
/**
 * Brokerage dark-mode demo — single page.
 *
 * Serves everything on one port:
 *   left   the trader web app  — real browser SDK + observability + session replay.
 *          In one-flag mode it is a trader in Delhi / Jaipur / Goa reading `dark-mode`.
 *          In flag-per-OS mode it is an iOS device reading `dark-mode-iosNN`, which is
 *          where the render fault lives.
 *   right  the fleet wall      — a fixed pool of real contexts per group, evaluated
 *          server-side every second and pushed over SSE, showing the share of each
 *          group currently served dark. Groups are regions for the one flag and OS
 *          OS versions for the flag-per-OS comparison.
 *
 * Replaces running viewer.js and trader.js separately. Those still work standalone.
 *
 *   node demo.js   ->  http://localhost:8765
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const { bootstrap } = require('./ld-bootstrap');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ld = require('@launchdarkly/node-server-sdk');

const PORT = Number(process.env.DEMO_PORT || process.env.VIEWER_PORT || 8765);
const TILES = Number(process.env.VIEWER_TILES || 18);
const POOL = Number(process.env.VIEWER_POOL || 150);
// Candidate devices the phone can adopt. A single fixed device is all-or-nothing:
// at a 25% rollout step it usually is not in the bucket, so the phone would sit
// there looking healthy through the whole release. The browser picks one of these
// that is genuinely in the rollout, so the screen on show is a real affected device.
const APP_POOL = Number(process.env.APP_POOL || 12);
const BUGGY = (process.env.BUGGY_COHORT || 'ios17').toLowerCase();
const BUGGY_REGION = (process.env.BUGGY_REGION || 'jaipur').toLowerCase();
const FIX_APPLIED = /^true$/i.test(process.env.FIX_APPLIED || 'false');
const FAILURE_RATE = Number(process.env.FAILURE_RATE || 0.5);
const SDK_KEY = process.env.LD_SDK_KEY;
const CLIENT_SIDE_ID = process.env.LD_CLIENT_SIDE_ID;

// Missing config must not stop the server coming up. Demo Depot's verifier
// launches a task and polls /healthz; exiting here means it never answers and
// the whole version fails verification. Log it, serve anyway, and let the page
// say it is not configured.
// false until the SDK has a payload. The page shows a banner; /healthz still
// answers 200, because neither depends on LaunchDarkly.
let ldReady = false;
const configProblems = [];
if (!SDK_KEY) configProblems.push('LD_SDK_KEY is not set');
if (!CLIENT_SIDE_ID) configProblems.push('LD_CLIENT_SIDE_ID is not set');
if (configProblems.length) {
  console.error('Config incomplete: ' + configProblems.join('; ') + '. Serving anyway; flags will fall back to their defaults.');
}

const ONE_FLAG = 'dark-mode';
const COHORTS = [
  { key: 'ios18', label: 'iOS 18', version: '18.2', model: 'iPhone 16 Pro', optionA: 'dark-mode-ios18' },
  { key: 'ios17', label: 'iOS 17', version: '17.5', model: 'iPhone 14', optionA: 'dark-mode-ios17' },
  { key: 'ios16', label: 'iOS 16', version: '16.7.10', model: 'iPhone SE', optionA: 'dark-mode-ios16' },
];
// dark-mode is sequenced by region, so the one-flag wall groups by city.
const REGIONS = [
  { key: 'delhi',  label: 'Delhi',  city: 'Delhi',  version: '18.2', model: 'iPhone 16 Pro' },
  { key: 'jaipur', label: 'Jaipur', city: 'Jaipur', version: '17.5', model: 'iPhone 14' },
  { key: 'goa',    label: 'Goa',    city: 'Goa',    version: '16.7.10', model: 'iPhone SE' },
];

function ctxFor(prefix, grp, i, region) {
  const user = { key: `${prefix}-usr-${grp.key}-${i}`, plan_tier: 'pro' };
  if (region) user.region = grp.city;
  return {
    kind: 'multi',
    user,
    device: {
      key: `${prefix}-dev-${grp.key}-${i}`,
      operating_system: 'iOS',
      os_version: grp.version,
      model: grp.model,
      app_version: '5.13.0',
    },
  };
}

// Each family has its own grouping and its own fixed context pools. Pools are
// large enough that their dark share tracks the real rollout percentage, stable
// so tiles do not shuffle, and bounded so they do not flood a rollout with
// metric-free contexts. appDevices are the candidate identities the phone adopts.
const FAMILIES = [
  {
    id: 'one',
    title: 'One flag, released city by city — <code>dark-mode</code>',
    region: true,
    groups: REGIONS,
    flagFor: () => ONE_FLAG,
    isBuggy: (k) => k === BUGGY_REGION,
  },
  {
    id: 'split',
    title: 'A separate flag for every OS version — <code>dark-mode-ios18 / ios17 / ios16</code>',
    region: false,
    groups: COHORTS,
    flagFor: (g) => g.optionA,
    isBuggy: (k) => k === BUGGY,
  },
];

for (const fam of FAMILIES) {
  fam.pools = fam.groups.map((g) => ({
    key: g.key, label: g.label, flagKey: fam.flagFor(g),
    devices: Array.from({ length: POOL }, (_, i) => ctxFor(`${fam.id}-disp`, g, i, fam.region)),
    appDevices: Array.from({ length: APP_POOL }, (_, i) => ctxFor(`${fam.id}-app`, g, i, fam.region)),
  }));
}

// ld.init throws synchronously on an empty key, which would crash the process
// at module load — before the server exists to answer /healthz. A stand-in that
// serves defaults keeps the contract: boot, serve, and say you are unconfigured.
const client = SDK_KEY ? ld.init(SDK_KEY) : {
  variation: async (_key, _ctx, dflt) => dflt,
  track: () => {},
  flush: async () => {},
  close: async () => {},
  initialized: () => false,
  waitForInitialization: async () => { throw new Error('no SDK key configured'); },
};
let state = [];

async function refresh() {
  state = await Promise.all(FAMILIES.map(async (fam) => ({
    family: fam.id,
    title: fam.title,
    groups: await Promise.all(fam.pools.map(async (p) => {
      let dark = 0;
      for (const ctx of p.devices) {
        if (await client.variation(p.flagKey, ctx, false)) dark++;
      }
      const appDark = [];
      for (let i = 0; i < p.appDevices.length; i++) {
        if (await client.variation(p.flagKey, p.appDevices[i], false)) appDark.push(i);
      }
      const broken = fam.isBuggy(p.key) && !FIX_APPLIED;
      const darkShare = dark / p.devices.length;
      return {
        key: p.key, label: p.label, flagKey: p.flagKey,
        pool: p.devices.length, tiles: TILES,
        darkShare,
        errorShare: broken ? darkShare * FAILURE_RATE : 0,
        appPool: p.appDevices.length, appDark,
      };
    })),
  })));
}

const template = fs.readFileSync(path.join(__dirname, 'demo.html'), 'utf8');
const cfg = {
  clientSideId: CLIENT_SIDE_ID,
  buggyCohort: FIX_APPLIED ? null : BUGGY,
  buggyRegion: FIX_APPLIED ? null : BUGGY_REGION,
};
const page = template.replace('__CFG__', JSON.stringify(cfg));

async function main() {
  // The HTTP server comes up before the SDK does, on purpose. Demo Depot polls
  // /healthz on a fresh task and expects 200 within seconds; waiting on
  // LaunchDarkly first meant an SDK blip took the whole container down.
  const clients = new Set();

  http.createServer((req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(state)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    // The browser SDK bundles, served from the app rather than a CDN. See
    // app/vendor/README.md: when esm.sh started 500ing on these packages the
    // page rendered an empty shell, and there is no fixing that mid-demo.
    if (req.url.startsWith('/vendor/')) {
      const name = path.basename(req.url);              // no traversal
      const file = path.join(__dirname, 'vendor', name);
      if (!/^[a-z0-9.-]+\.js$/i.test(name) || !fs.existsSync(file)) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      });
      fs.createReadStream(file).pipe(res);
      return;
    }
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // ok:true regardless of ldReady — the container is serving, which is what
      // the health check is asking. ldReady is for humans reading the output.
      res.end(JSON.stringify({ ok: true, ldReady, configProblems, buggyCohort: cfg.buggyCohort,
        buggyRegion: cfg.buggyRegion, pool: POOL, tiles: TILES, appPool: APP_POOL }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(page);
  }).listen(PORT, () => {
    console.log(`Demo on http://localhost:${PORT}  (trader app + fleet wall; ${TILES} tiles from a ${POOL}-context pool per group; buggy region=${cfg.buggyRegion || 'none'}, buggy cohort=${cfg.buggyCohort || 'none'})`);
  });

  // Create the metrics and segments the seed importer cannot (no-op locally,
  // and no-op without a project-writer token). Deliberately not awaited: it
  // must never delay the health route.
  bootstrap();

  // Now connect. A failure here is logged, not fatal: the SDK keeps retrying on
  // its own and every variation() call falls back to its default until it is up.
  try {
    await client.waitForInitialization({ timeout: 10 });
    ldReady = true;
    console.log('LaunchDarkly SDK ready');
  } catch (e) {
    console.error('LaunchDarkly SDK not ready yet:', e.message, '- serving anyway, will keep retrying');
  }
  await refresh();

  setInterval(async () => {
    if (!ldReady) {
      // Cheap readiness poll: initialized() flips once a payload arrives.
      try { ldReady = client.initialized(); } catch (_) { /* older SDKs */ }
      if (ldReady) console.log('LaunchDarkly SDK ready');
    }
    await refresh();
    const payload = `data: ${JSON.stringify(state)}\n\n`;
    for (const res of clients) res.write(payload);
  }, 1000);

  const bye = async () => { try { await client.flush(); } catch (_) {} await client.close(); process.exit(0); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
}
main();
