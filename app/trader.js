#!/usr/bin/env node
/**
 * Brokerage dark-mode demo — trader web app.
 *
 * Serves a single-page portfolio screen that uses the LaunchDarkly BROWSER SDK
 * with the observability and session-replay plugins. It evaluates `dark-mode`
 * for a user+device multi-context, themes itself from the result, and — on the
 * affected OS cohort while dark mode is on — hits a genuine JavaScript exception
 * while building the holdings table.
 *
 * That gives LaunchDarkly Observability real browser data for the demo:
 *   Errors   a thrown exception with a stack, tagged with cohort and flag value
 *   Logs     render/order events at info, render failures at error
 *   Traces   a render.portfolio span per paint
 *   Sessions a replayable recording of the screen going dark and breaking
 *
 * Run alongside simulator.js and viewer.js:  node trader.js  ->  http://localhost:8766
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.TRADER_PORT || 8766);
const CLIENT_SIDE_ID = process.env.LD_CLIENT_SIDE_ID;
const BUGGY = (process.env.BUGGY_COHORT || 'ios17').toLowerCase();
const FIX_APPLIED = /^true$/i.test(process.env.FIX_APPLIED || 'false');

if (!CLIENT_SIDE_ID) {
  console.error('LD_CLIENT_SIDE_ID is not set. Add it to ../.env (Environments settings -> Production -> client-side ID).');
  process.exit(1);
}

const template = fs.readFileSync(path.join(__dirname, 'trader.html'), 'utf8');
// FIX_APPLIED=true clears the fault, matching the simulator's fix-forward beat.
const cfg = { clientSideId: CLIENT_SIDE_ID, buggyCohort: FIX_APPLIED ? null : BUGGY };
const page = template.replace('__CFG__', JSON.stringify(cfg));

http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, buggyCohort: cfg.buggyCohort }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(page);
}).listen(PORT, () => {
  console.log(`Trader app on http://localhost:${PORT}  (buggy=${cfg.buggyCohort || 'none (fix applied)'})`);
});
