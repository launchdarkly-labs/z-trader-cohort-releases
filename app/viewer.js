#!/usr/bin/env node
/**
 * Brokerage dark-mode cohort-release demo — live device wall.
 *
 * Renders a grid of phones per OS cohort. Each phone is a real LaunchDarkly
 * evaluation of `dark-mode` for its own user+device multi-context, re-evaluated
 * every second and pushed to the browser over SSE. As a guarded rollout ramps
 * 25 -> 50 -> 100 % you watch that share of a cohort's phones go dark; when
 * LaunchDarkly rolls the cohort back, they snap to light together.
 *
 * The render-error overlay mirrors simulator.js's fault model (buggy cohort only,
 * only while dark mode is on) and is deterministic per device so tiles don't flicker.
 *
 * Run alongside simulator.js:  node viewer.js   ->  http://localhost:8765
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const ld = require('@launchdarkly/node-server-sdk');

const PORT = Number(process.env.VIEWER_PORT || 8765);
const TILES = Number(process.env.VIEWER_TILES || 18);        // phones drawn per cohort
const POOL = Number(process.env.VIEWER_POOL || 150);         // stable devices sampled per cohort
const BUGGY = (process.env.BUGGY_COHORT || 'ios17').toLowerCase();
const FIX_APPLIED = /^true$/i.test(process.env.FIX_APPLIED || 'false');
const SDK_KEY = process.env.LD_SDK_KEY;

if (!SDK_KEY) { console.error('LD_SDK_KEY is not set. Fill in ../.env'); process.exit(1); }

const ONE_FLAG = 'dark-mode';
const COHORTS = [
  { key: 'ios18', label: 'iOS 18', version: '18.2', model: 'iPhone 16 Pro', optionA: 'dark-mode-ios18' },
  { key: 'ios17', label: 'iOS 17', version: '17.5', model: 'iPhone 14', optionA: 'dark-mode-ios17' },
  { key: 'ios16', label: 'iOS 16', version: '16.7.10', model: 'iPhone SE', optionA: 'dark-mode-ios16' },
];

const FAILURE_RATE = Number(process.env.FAILURE_RATE || 0.5);

// A FIXED pool of display devices, evaluated every tick.
//
// Two earlier designs were wrong. A pool the size of the tile count (18) is bucketed
// too lopsidedly by the rollout hash to represent the exposure (a real 50% rollout
// showed 2 of 12). Minting fresh keys each tick fixed the proportion but flooded the
// rollout with ~1000 metric-less devices a minute, which diluted the sample so badly
// that genuine regressions went undetected.
//
// So: a stable pool (no unbounded device growth, negligible sample impact) large
// enough for its dark share to track the real rollout percentage. The tiles then
// render that measured share, so they stay put instead of shuffling every second.
const POOLS = COHORTS.map((c) => ({
  cohort: c.key, label: c.label, optionA: c.optionA,
  devices: Array.from({ length: POOL }, (_, i) => ({
    kind: 'multi',
    user: { key: `disp-usr-${c.key}-${i}`, plan_tier: 'pro' },
    device: {
      key: `disp-dev-${c.key}-${i}`,
      operating_system: 'iOS',
      os_version: c.version,
      model: c.model,
      app_version: '5.13.0',
    },
  })),
}));

const client = ld.init(SDK_KEY);
let state = [];

async function refresh() {
  state = await Promise.all(POOLS.map(async (p) => {
    let one = 0, split = 0;
    for (const ctx of p.devices) {
      if (await client.variation(ONE_FLAG, ctx, false)) one++;
      if (await client.variation(p.optionA, ctx, false)) split++;
    }
    const broken = p.cohort === BUGGY && !FIX_APPLIED;
    const share = (n) => ({
      darkShare: n / p.devices.length,
      errorShare: broken ? (n / p.devices.length) * FAILURE_RATE : 0,
    });
    return {
      cohort: p.cohort, label: p.label, flagA: p.optionA, pool: p.devices.length, tiles: TILES,
      one: share(one), split: share(split),
    };
  }));
}

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Brokerage — live device wall</title><style>
*{box-sizing:border-box}
body{margin:0;background:#0b0e14;color:#e6e9ef;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{padding:18px 24px;border-bottom:1px solid #1e2430;display:flex;align-items:baseline;gap:16px}
h1{font-size:17px;margin:0;font-weight:600}
.sub{color:#7d8798;font-size:12px}
.wall{padding:20px 24px}
.fam{margin-bottom:22px}
.famhead{font-size:13px;font-weight:600;color:#c3cbd9;margin:0 0 10px 2px}
.famhead code{color:#8fa3c8;font-size:12px}
.wallrow{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.col{background:#111520;border:1px solid #1e2430;border-radius:12px;padding:16px}
.chead{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
.cname{font-weight:600;font-size:14px}
.cstat{font-size:12px;color:#7d8798}
.pill{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600}
.pill.dark{background:#1d4ed8;color:#fff}
.pill.light{background:#2a3140;color:#9aa4b6}
.pill.err{background:#b4232b;color:#fff}
.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:7px}
.phone{aspect-ratio:9/17;border-radius:10px;border:2px solid #2b3240;overflow:hidden;position:relative;
  background:#f7f8fa;transition:background .45s ease,border-color .45s ease}
.phone .notch{height:9%;display:flex;align-items:center;justify-content:center}
.phone .notch i{display:block;width:34%;height:3px;border-radius:2px;background:#c8ccd4}
.phone .body{padding:0 10%}
.row{height:5px;border-radius:2px;background:#d4d8e0;margin-bottom:5px;transition:background .45s ease}
.row.w70{width:70%}.row.w50{width:50%}.row.w85{width:85%}
.spark{height:22%;margin:6px 10% 0;border-radius:3px;background:linear-gradient(180deg,#cfe0ff,#eaf1ff);transition:background .45s}
.phone.on{background:#0e1117;border-color:#1d4ed8}
.phone.on .notch i{background:#2a3140}
.phone.on .row{background:#242c3a}
.phone.on .spark{background:linear-gradient(180deg,#16233d,#0e1117)}
.phone.err{background:#2a0e11;border-color:#b4232b}
.phone.err .row,.phone.err .spark{background:#4a1a1e}
.phone.err::after{content:"⚠";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:22px;color:#ff6b73}
.switch{margin-left:auto;display:flex;gap:6px;align-items:center}
.switch button{background:#161b27;color:#9aa4b6;border:1px solid #242c3a;padding:7px 13px;border-radius:8px;
  font:600 12px inherit;cursor:pointer;transition:all .15s}
.switch button:hover{color:#e6e9ef;border-color:#39435a}
.switch button.sel{background:#1d4ed8;border-color:#1d4ed8;color:#fff}
.count{font-size:11px;color:#7d8798;margin-left:10px}
.flagchip{display:inline-block;margin-top:4px;padding:2px 7px;border-radius:5px;background:#161b27;
  border:1px solid #242c3a;color:#8fa3c8;font:500 10px ui-monospace,SFMono-Regular,Menlo,monospace}
footer{padding:0 24px 24px;color:#5c657a;font-size:11px;line-height:1.7}
.note{margin-top:10px;padding:9px 12px;border-radius:8px;background:#161b27;border:1px solid #242c3a;
  color:#9aa4b6;font-size:11px;line-height:1.6}
.note code{color:#8fa3c8}
code{color:#8fa3c8}
</style></head><body>
<header><h1>Across the fleet — who has dark mode right now</h1>
<span class="sub">one phone = one device context · refreshes every second</span>
<span class="switch">
  <button id="m-both" class="sel" onclick="setMode('both')">Compare both</button>
  <button id="m-one" onclick="setMode('one')">One flag</button>
  <button id="m-split" onclick="setMode('split')">A flag per OS</button>
</span></header>
<div class="wall" id="wall"></div>
<footer>
Each cohort continuously evaluates a fixed pool of <strong>150 real device contexts</strong> against the live flag; the phones show what share of that pool is currently served <code>true</code>.
Red phones are the rendering fault that only occurs on the affected cohort while dark mode is on.
</footer>
<script>
const wall = document.getElementById('wall');
const order = ['ios18','ios17','ios16'];
const FAMILIES = [
  { id:'one',   title:'One flag for every group — <code>dark-mode</code>',
    note:'The groups live in LaunchDarkly as reusable audiences, so the app only ever asks one question. Adding a group is a targeting change, not an app release.' },
  { id:'split', title:'A separate flag per group — <code>dark-mode-ios18 / ios17 / ios16</code>',
    note:'The same outcome, three times the work: every group needs its own flag, its own rollout and its own rollback. The group name also ends up inside the flag name, so the app has to know which one to ask for.' }
];
let show = 'both', latest = [];
function setMode(m){
  show = m;
  for (const b of ['both','one','split'])
    document.getElementById('m-'+b).className = (b===m) ? 'sel' : '';
  render(latest);
}
function section(fam, items){
  const cols = order.map(c=>items.find(x=>x.cohort===c)).filter(Boolean).map(x=>{
    const m = x[fam.id];
    const n = x.tiles;
    const dark = Math.round(m.darkShare * n);
    const errs = Math.round(m.errorShare * n);
    const flagKey = fam.id==='one' ? 'dark-mode' : x.flagA;
    const pct = Math.round(100*m.darkShare);
    const pill = errs ? '<span class="pill err">'+errs+' screens failing</span>'
               : dark>=n ? '<span class="pill dark">fully rolled out</span>'
               : dark ? '<span class="pill dark">'+pct+'% rolled out</span>'
               : '<span class="pill light">not yet rolled out</span>';
    let tiles = '';
    for (let i=0;i<n;i++){
      const isDark = i < dark;
      const isErr  = isDark && i < errs;
      tiles += '<div class="phone '+(isErr?'err':(isDark?'on':''))+'">'
        + '<div class="notch"><i></i></div><div class="spark"></div>'
        + '<div class="body"><div class="row w85"></div><div class="row w50"></div><div class="row w70"></div><div class="row w50"></div></div>'
        + '</div>';
    }
    return '<div class="col"><div class="chead"><span class="cname">'+x.label+'</span>'+pill+'</div>'
      + '<div class="cstat">'+pct+'% of devices on dark mode <span style="opacity:.6">· '+x.pool+' sampled</span></div>'
      + '<div class="flagchip">'+flagKey+'</div><div class="grid" style="margin-top:12px">'+tiles+'</div></div>';
  }).join('');
  return '<div class="fam"><div class="famhead">'+fam.title+'</div><div class="wallrow">'+cols+'</div>'
       + '<div class="note">'+fam.note+'</div></div>';
}
function render(items){
  latest = items;
  if (!items || !items.length) return;
  const fams = FAMILIES.filter(f => show==='both' || show===f.id);
  wall.innerHTML = fams.map(f=>section(f, items)).join('');
}
new EventSource('/events').onmessage = e => render(JSON.parse(e.data));
setMode('both');
</script></body></html>`;

async function main() {
  try { await client.waitForInitialization({ timeout: 10 }); }
  catch (e) { console.error('LaunchDarkly SDK failed to initialise:', e.message); process.exit(1); }
  await refresh();

  const clients = new Set();
  setInterval(async () => {
    await refresh();
    const payload = `data: ${JSON.stringify(state)}\n\n`;
    for (const res of clients) res.write(payload);
  }, 1000);

  http.createServer((req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(state)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  }).listen(PORT, () => {
    console.log(`Device wall on http://localhost:${PORT}  (${TILES} tiles from a ${POOL}-device pool per cohort, buggy=${BUGGY}, fix=${FIX_APPLIED})`);
  });

  const bye = async () => { try { await client.flush(); } catch (_) {} await client.close(); process.exit(0); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
}
main();
