// server.js — Express app entry point
const express = require('express');
const path    = require('path');

const { PORT } = require('./lib/config');

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  // Event-log traffic (overlay pages reporting, dashboard Logs tab polling)
  // is constant background chatter — keep it out of the console.
  if (!req.url.startsWith('/api/event-log')) console.log('[REQ]', req.method, req.url);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  next();
});

// Match state — inline so no router indirection
const fs         = require('fs');
const matchState = require('./lib/matchState');
const teamLineups = require('./lib/teamLineups');

function getMatchPassword() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'config.json'), 'utf8')).dashboard_password || ''; }
  catch (e) { return ''; }
}

app.get('/match/state', function (req, res) {
  console.log('[match] GET /match/state');
  res.json(matchState.get());
});

app.get('/match/events', function (req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  matchState.addClient(res);
  req.on('close', function () { matchState.removeClient(res); });
});

app.post('/match/auth', function (req, res) {
  console.log('[match] POST /match/auth body:', req.body);
  var token = (req.body || {}).token;
  if (!token || token !== getMatchPassword()) return res.status(401).json({ ok: false });
  res.json({ ok: true });
});

app.post('/match/state', function (req, res) {
  var body  = req.body || {};
  var token = body.token;
  if (!token || token !== getMatchPassword()) return res.status(401).json({ error: 'Unauthorized' });
  delete body.token;
  matchState.set(body);
  res.json({ ok: true, state: matchState.get() });
});

// Waiting Screen TVC / Waiting Lobby countdown — server-authoritative so it
// keeps running (or stays paused) across overlay refreshes and reconnects.
app.post('/match/timer', function (req, res) {
  var body  = req.body || {};
  var token = body.token;
  if (!token || token !== getMatchPassword()) return res.status(401).json({ error: 'Unauthorized' });
  if      (body.action === 'start') matchState.startTimer();
  else if (body.action === 'pause') matchState.pauseTimer();
  else if (body.action === 'set')   matchState.setTimerRemaining(body.seconds);
  else return res.status(400).json({ error: 'Unknown action' });
  res.json({ ok: true, state: matchState.get() });
});

// Map Selection state — read-only now (its dashboard tab was removed with the Map Selection tag); the Post scenes still
// read /mapselection/state and fall back to the Match Board map when it is empty.
const mapSelectionState = require('./lib/mapSelectionState');

app.get('/mapselection/state', function (req, res) {
  res.json(mapSelectionState.get());
});

// Team roster — mainroster.json. Reads go through the existing static
// file serving (GET /mainroster.json, already no-cache'd below); this is
// just the write side, same dashboard password as match/standings state.
app.post('/api/roster', function (req, res) {
  var body  = req.body || {};
  var token = body.token;
  if (!token || token !== getMatchPassword()) return res.status(401).json({ error: 'Unauthorized' });
  var data = body.data;
  if (!data || typeof data !== 'object' || !data.teams || !data.players) {
    return res.status(400).json({ error: 'Payload must include teams and players' });
  }
  try {
    fs.writeFileSync(path.join(__dirname, 'data', 'mainroster.json'), JSON.stringify(data, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not write mainroster.json' });
  }
});

// Last-used per-team role assignment (bench swaps) — restored the next time
// that team is picked instead of resetting to mainroster.json's role-sorted
// default. Public read (the dashboard needs it right after picking a team),
// same dashboard password as match/standings state for the write.
app.get('/match/team-lineups', function (req, res) {
  res.json(teamLineups.getAll());
});

app.post('/match/team-lineups', function (req, res) {
  var body  = req.body || {};
  var token = body.token;
  if (!token || token !== getMatchPassword()) return res.status(401).json({ error: 'Unauthorized' });
  teamLineups.set(body.teamId, body.lineup);
  res.json({ ok: true });
});

// Short per-country links for browser sources: /ingame/ID -> the Ingame page for the ID sponsor set (same for /postgame/<SET>).
// Plain /ingame and /postgame mean the MAIN set. The page itself reads ?set= (html/js/sponsor-set.js).
['ingame', 'postgame'].forEach(function (page) {
  const file = page === 'ingame' ? 'mploverlay_v7.html' : 'postgame.html';
  app.get(['/' + page, '/' + page + '/:set'], function (req, res) {
    const set = String(req.params.set || 'MAIN').toUpperCase().replace(/[^A-Z]/g, '');
    res.redirect('/html/' + file + '?set=' + (['MAIN', 'ID', 'MY', 'PH'].includes(set) ? set : 'MAIN'));
  });
});

// Browsers ask for /favicon.ico on their own — serve the M8 logo (same file the pages link to).
app.get('/favicon.ico', function (req, res) {
  res.sendFile(path.join(__dirname, 'assets', 'common', 'favicon.ico'));
});

// Static assets — HTML files served fresh, other assets cached for 1 day
app.use(express.static(path.join(__dirname), {
  maxAge: '1d',
  index: false,
  setHeaders: function(res, filePath) {
    const p = filePath.split(path.sep).join('/'); // normalize Windows backslashes for the checks below
    if (p.endsWith('.html') || p.endsWith('.css') || p.includes('/html/js/') || p.endsWith('mainroster.json') || p.includes('/assets/team/logos/') || p.includes('/assets/overlay/ingame/') || p.includes('/anniversary/')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// Routes
app.use(require('./routes/feed'));
// Before ./routes/overlay — its middleware timestamps /overlay/<key>/show|hide.
app.use(require('./routes/eventLog'));
app.use(require('./routes/overlay'));
app.use(require('./routes/fights'));
app.use(require('./routes/positions'));
app.use(require('./routes/postgame'));
app.use(require('./routes/dashboard'));
app.use(require('./routes/overlayStyles'));
app.use(require('./routes/devapi'));

// Debug: log unmatched routes
app.use(function (req, res, next) {
  console.log('[404]', req.method, req.url);
  next();
});

// Start pollers (kicks off setInterval loops + initial polls)
require('./lib/pollers');

app.listen(PORT, '0.0.0.0', () => {
  require('./lib/eventLog').add({ level: 'success', page: 'server', kind: 'server', msg: 'Overlay server started on :' + PORT });
  console.log("================================================");
  console.log(`  Overlay Server running on :${PORT}`);
  console.log(`  Dashboard  → http://localhost:${PORT}/`);
  console.log(`  Feed       → http://localhost:${PORT}/feed`);
  console.log(`  Camp Feed  → http://localhost:${PORT}/feed/order`);
  console.log(`  Postgame   → http://localhost:${PORT}/postgame`);
  console.log(`  League     → http://localhost:${PORT}/stats/league`);
  console.log(`  Overlay    → GET  http://localhost:${PORT}/overlay/slot1  (show)`);
  console.log(`             → GET  http://localhost:${PORT}/overlay/hide   (hide)`);
  console.log(`  Fights OL  → GET  http://localhost:${PORT}/overlay/fights/show`);
  console.log(`             → GET  http://localhost:${PORT}/overlay/fights/hide`);
  console.log(`  Positions  → GET  http://localhost:${PORT}/positions`);
  console.log(`  Fights     → GET  http://localhost:${PORT}/fights`);
  console.log(`             →      ?last=N  for last N fights`);
  console.log(`             →      ?camp=1&seat=2&from=0&to=600`);
  console.log(`             →      camp 1|2  seat 1-5  from/to in seconds`);
  console.log(`  Match      → GET  http://localhost:${PORT}/match/state`);
  console.log(`             → POST http://localhost:${PORT}/match/state  (auth)`);
  console.log(`             → GET  http://localhost:${PORT}/match/events  (SSE)`);
  console.log(`  Timer      → POST http://localhost:${PORT}/match/timer  { action: start|pause|set, seconds }`);
  console.log(`  Lineups    → GET  http://localhost:${PORT}/match/team-lineups`);
  console.log(`             → POST http://localhost:${PORT}/match/team-lineups  (auth)`);
  console.log(`  Sponsors   → GET  http://localhost:${PORT}/api/sponsors`);
  console.log(`             → GET  http://localhost:${PORT}/api/sponsors-config`);
  console.log(`             → POST http://localhost:${PORT}/api/sponsors-config  (auth)`);
  console.log(`  Game API   → GET  http://localhost:${PORT}/api/game-url`);
  console.log(`             → POST http://localhost:${PORT}/api/game-url  { url }`)
  console.log("================================================");
});
