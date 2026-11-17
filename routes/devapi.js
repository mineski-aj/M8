// routes/devapi.js — GET /api/sub-info/
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const state   = require('../lib/state');
const { getApiMode, setApiMode, readUrlForMode, writeUrlForMode } = require('../lib/apiMode');
const { getTheme, setTheme } = require('../lib/theme');
const { normalizeGameFeed } = require('../lib/rawAdapter');
const feedDerived = require('../lib/feedDerived');
const { getGameRefreshMs, setGameRefreshMs, MIN_MS: GAME_REFRESH_MIN, MAX_MS: GAME_REFRESH_MAX } = require('../lib/gameRefresh');

// LIVE/DEBUG API mode — Settings page's "dangerous debug button". Every
// per-API URL setting below stores BOTH a live and a debug value; this
// flips which one every reader (these routes, lib/pollers.js, lib/hrmPoller.js)
// resolves to. See lib/apiMode.js.
router.get('/api/api-mode', (req, res) => {
  res.json({ mode: getApiMode() });
});

router.post('/api/api-mode', (req, res) => {
  const mode = setApiMode((req.body || {}).mode);
  res.json({ ok: true, mode });
});

// Broadcast theme — Settings page picker. One global value, applied by
// EVERY overlay page (html/js/theme-apply.js sets `data-theme` on
// <html>), same GET/POST/SSE-broadcast shape as heatmap_config/h2h_config
// below. A theme changes NOTHING by default — it only takes effect once a
// page's own CSS adds an opt-in `[data-theme="..."] #selector { ... }`
// override; see CLAUDE.md's "Theme system" section before adding one.
// Actual read/write lives in lib/theme.js — routes/overlayStyles.js's
// Edit-tab theme-scoping needs the same accessor.
router.get('/api/theme', (req, res) => {
  res.set('Cache-Control', 'no-store').json({ theme: getTheme() });
});

router.post('/api/theme', (req, res) => {
  const theme = setTheme((req.body || {}).theme);
  const cfg = { theme };
  // Live nudge — every open overlay page (mplfs/ENTVC/mpltag/Draft/
  // DraftIndex/mploverlay_v7/fights) applies the new theme immediately via
  // this event instead of only picking it up on next reload.
  state.overlayClients.forEach(c => {
    try { c.write('event: theme\ndata: ' + JSON.stringify(cfg) + '\n\n'); } catch {}
  });
  res.json({ ok: true, ...cfg });
});


// DEBUG-mode game feed for the M8 V2 branch: the RAW battle-feed sample. Point Settings ->
// Game API (DEBUG) at http://localhost:<port>/api/battledata-m8 — it goes through the same
// raw -> seat_N adapter as a live feed (lib/rawAdapter.js).
router.get('/api/battledata-m8', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').type('application/json')
       .send(fs.readFileSync(path.join(__dirname, '..', 'data', 'battledata_sample_m8.txt'), 'utf8'));
  } catch (e) { res.status(500).json({ error: 'battledata_sample_m8.txt not found' }); }
});


// Sponsor logos + categorization — logos live in /assets/sponsor/<SET>/, categorization
// (grouping, per-category loop duration, display order) is edited from the
// dashboard's Sponsors tab and persisted to sponsors_config.json.
// Four independent logo sets live in assets/sponsor/<SET>/ (each with its own white/ subfolder).
// Every sponsor route takes an optional ?set=MAIN|MY|PH|ID; default is MAIN.
// Categories (sponsors_config.json) are shared: a logo filename missing from a set is simply skipped.
const SPONSOR_SETS         = ['MAIN', 'MY', 'PH', 'ID'];
const DEFAULT_SPONSOR_SET  = 'MAIN';
const SPONSORS_ROOT        = path.join(__dirname, '..', 'assets', 'sponsor');
function sponsorSet(req) {
  const s = String((req && req.query && req.query.set) || '').toUpperCase();
  return SPONSOR_SETS.includes(s) ? s : DEFAULT_SPONSOR_SET;
}
const SPONSORS_CONFIG_FILE = path.join(__dirname, '..', 'data', 'sponsors_config.json');
const CONFIG_FILE          = path.join(__dirname, '..', 'data', 'config.json');

function getDashboardPassword() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).dashboard_password || '';
  } catch (e) {
    return '';
  }
}

function readSponsorFiles(set) {
  try {
    return fs.readdirSync(path.join(SPONSORS_ROOT, set || DEFAULT_SPONSOR_SET)).filter(f => /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f));
  } catch (e) {
    return [];
  }
}

function readSponsorsConfig() {
  try {
    const data = JSON.parse(fs.readFileSync(SPONSORS_CONFIG_FILE, 'utf8'));
    if (data && Array.isArray(data.categories)) {
      return {
        categories: data.categories,
        hiddenInIngame: Array.isArray(data.hiddenInIngame) ? data.hiddenInIngame : [],
        hiddenInSponsorsPage: Array.isArray(data.hiddenInSponsorsPage) ? data.hiddenInSponsorsPage : [],
      };
    }
  } catch (e) {}
  return { categories: [], hiddenInIngame: [], hiddenInSponsorsPage: [] };
}

// Public — overlays read this for the ordered, timed play list
// (category order → each category's logo order, dur in ms). Two independent
// opt-in filters, each its own query flag + config list, so hiding a logo
// from one loop never affects the other:
//   ?ingame=1       — the always-on scoreboard overlay (overlay-scoreboard.js),
//                     filtered against hiddenInIngame.
//   ?sponsorspage=1 — sponsors.html's own boxed + transparent in-game-style
//                     loops, filtered against hiddenInSponsorsPage.
// Every other loop (Waiting Lobby, Waiting Screen TVC, Today's/Tomorrow's
// Schedule, Draft, Credit Reel) passes neither flag and always shows everything.
router.get('/api/sponsors', (req, res) => {
  const set    = sponsorSet(req);
  const files  = new Set(readSponsorFiles(set));
  const config = readSponsorsConfig();
  const hiddenIngame = req.query.ingame ? new Set(config.hiddenInIngame) : null;
  const hiddenSponsorsPage = req.query.sponsorspage ? new Set(config.hiddenInSponsorsPage) : null;
  const sponsors = [];
  config.categories.forEach(cat => {
    const dur = Math.max(0.5, Number(cat.duration) || 3) * 1000;
    (cat.logos || []).forEach(f => {
      if (!files.has(f)) return;
      if (hiddenIngame && hiddenIngame.has(f)) return;
      if (hiddenSponsorsPage && hiddenSponsorsPage.has(f)) return;
      sponsors.push({ src: '/assets/sponsor/' + set + '/' + encodeURIComponent(f), dur, category: cat.name });
    });
  });
  res.set('Cache-Control', 'no-store').json(sponsors);
});

// Dashboard Sponsors tab — categorization + every available logo file
// (so the UI can show unassigned logos alongside categorized ones).
router.get('/api/sponsors-config', (req, res) => {
  const config = readSponsorsConfig();
  const set = sponsorSet(req);
  res.set('Cache-Control', 'no-store').json({
    set,
    sets: SPONSOR_SETS,
    base: '/assets/sponsor/' + set + '/',
    categories: config.categories,
    hiddenInIngame: config.hiddenInIngame,
    hiddenInSponsorsPage: config.hiddenInSponsorsPage,
    availableFiles: readSponsorFiles(set),
  });
});

router.post('/api/sponsors-config', (req, res) => {
  const body  = req.body || {};
  const token = body.token;
  if (!token || token !== getDashboardPassword()) return res.status(401).json({ error: 'Unauthorized' });
  const data = body.data;
  if (!data || !Array.isArray(data.categories)) {
    return res.status(400).json({ error: 'Payload must include a categories array' });
  }
  const hiddenInIngame = Array.isArray(data.hiddenInIngame) ? data.hiddenInIngame.filter(f => typeof f === 'string') : [];
  const hiddenInSponsorsPage = Array.isArray(data.hiddenInSponsorsPage) ? data.hiddenInSponsorsPage.filter(f => typeof f === 'string') : [];
  try {
    fs.writeFileSync(SPONSORS_CONFIG_FILE, JSON.stringify({ categories: data.categories, hiddenInIngame, hiddenInSponsorsPage }, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not write sponsors_config.json' });
  }
});

// Credit Reel content — plain text, edited from the dashboard's Edit tab
// (or by hand-editing this file / pasting into the textarea) and rendered
// by postgame.html's crParseText(). GET to read, POST { text } to update.
const CREDITS_TEXT_FILE = path.join(__dirname, '..', 'data', 'credits_reel.txt');

router.get('/api/credits-text', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').type('text/plain').send(fs.readFileSync(CREDITS_TEXT_FILE, 'utf8'));
  } catch (e) {
    res.set('Cache-Control', 'no-store').type('text/plain').send('');
  }
});

router.post('/api/credits-text', (req, res) => {
  const text = (req.body || {}).text || '';
  fs.writeFileSync(CREDITS_TEXT_FILE, text);
  res.json({ ok: true });
});

// Credit Reel scroll speed, in px/sec — GET to read, POST { speed } to update
const CREDITS_SPEED_FILE = path.join(__dirname, '..', 'data', 'credits_speed.json');

router.get('/api/credits-speed', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json(JSON.parse(fs.readFileSync(CREDITS_SPEED_FILE, 'utf8')));
  } catch (e) {
    res.set('Cache-Control', 'no-store').json({ speed: 90 });
  }
});

router.post('/api/credits-speed', (req, res) => {
  const speed = Math.max(10, Math.min(1000, Number((req.body || {}).speed) || 90));
  fs.writeFileSync(CREDITS_SPEED_FILE, JSON.stringify({ speed }));
  res.json({ ok: true, speed });
});

// Jungle Resource Stolen banner — how long the AUTO pop-up (2/5/8/12min
// game_time) stays on screen once shown, in seconds. GET to read, POST
// { duration } to update. Fetched fresh (no caching) by
// overlay-stolengold.js every time the banner is about to auto-show,
// same pattern as credits-speed above. Does not affect the manual
// show/hide toggle, which stays up until explicitly hidden.
const STOLENGOLD_DURATION_FILE = path.join(__dirname, '..', 'data', 'stolengold_duration.json');

router.get('/api/stolengold-duration', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json(JSON.parse(fs.readFileSync(STOLENGOLD_DURATION_FILE, 'utf8')));
  } catch (e) {
    res.set('Cache-Control', 'no-store').json({ duration: 8 });
  }
});

router.post('/api/stolengold-duration', (req, res) => {
  const duration = Math.max(1, Math.min(30, Number((req.body || {}).duration) || 8));
  fs.writeFileSync(STOLENGOLD_DURATION_FILE, JSON.stringify({ duration }));
  res.json({ ok: true, duration });
});

// Post Heatmap tunables (time window / playback speed / player-focus
// selection) — GET to read, POST partial-update. Both the dashboard's
// Control-tab box and postgame.html's showPostHeatmap() fetch this fresh (no
// caching), so tuning it from the dashboard affects the next time the scene
// is shown, same pattern as credits-speed above.
const HEATMAP_CONFIG_FILE = path.join(__dirname, '..', 'data', 'heatmap_config.json');
const HEATMAP_CONFIG_DEFAULT = { camp: null, seat: 1, from: 0, to: 600, playbackSec: 15, photoOffsetX: 0, mapBrightness: 0.25 };

router.get('/api/heatmap-config', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json(JSON.parse(fs.readFileSync(HEATMAP_CONFIG_FILE, 'utf8')));
  } catch (e) {
    res.set('Cache-Control', 'no-store').json(HEATMAP_CONFIG_DEFAULT);
  }
});

router.post('/api/heatmap-config', (req, res) => {
  const b = req.body || {};
  const clampCampSeat = (v, max) => (v === null || v === '' || v === undefined) ? null : Math.max(1, Math.min(max, parseInt(v) || 1));
  const cfg = {
    camp:        clampCampSeat(b.camp, 2),
    seat:        clampCampSeat(b.seat, 5) || 1, // player-focus card always needs a concrete seat
    from:        Math.max(0, parseInt(b.from) || 0),
    to:          Math.max(1, parseInt(b.to) || 600),
    playbackSec: Math.max(1, Math.min(300, parseInt(b.playbackSec) || 15)),
    photoOffsetX: Math.max(-400, Math.min(400, parseInt(b.photoOffsetX) || 0)),
    mapBrightness: Math.max(0.1, Math.min(1.5, Number(b.mapBrightness) || 0.25)),
  };
  fs.writeFileSync(HEATMAP_CONFIG_FILE, JSON.stringify(cfg));
  // Live nudge — if Post Heatmap is already showing on some connected
  // client, it should pick up the new window/focus immediately rather
  // than only on the next Show. Every postgame.html tab listens for this and
  // silently no-ops unless it's actually the heatmap scene right now.
  state.overlayClients.forEach(c => {
    try { c.write('event: heatmap_config\ndata: {}\n\n'); } catch {}
  });
  res.json({ ok: true, ...cfg });
});


// Post H2H role selection (which role's head-to-head comparison is shown)
// — GET to read, POST { role } to update. postgame.html's showPostH2H() and
// p2hLiveRefresh() fetch this fresh (no caching) each time, same pattern
// as heatmap_config above; tuning it from the dashboard's role selector
// affects an already-showing Post H2H scene immediately via the
// 'h2h_config' SSE broadcast below, and the next Show either way.
const H2H_CONFIG_FILE = path.join(__dirname, '..', 'data', 'h2h_config.json');
const H2H_CONFIG_DEFAULT = { role: 'gold_laner' };
const H2H_VALID_ROLES = ['jungler', 'gold_laner', 'exp_laner', 'mid_laner', 'roamer'];

router.get('/api/h2h-config', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json(JSON.parse(fs.readFileSync(H2H_CONFIG_FILE, 'utf8')));
  } catch (e) {
    res.set('Cache-Control', 'no-store').json(H2H_CONFIG_DEFAULT);
  }
});

router.post('/api/h2h-config', (req, res) => {
  const b = req.body || {};
  const role = H2H_VALID_ROLES.includes(b.role) ? b.role : H2H_CONFIG_DEFAULT.role;
  const cfg = { role };
  fs.writeFileSync(H2H_CONFIG_FILE, JSON.stringify(cfg));
  // Live nudge — same reasoning as heatmap_config above: if Post H2H is
  // already showing on some connected client, it should pick up the new
  // role immediately rather than only on the next Show.
  state.overlayClients.forEach(c => {
    try { c.write('event: h2h_config\ndata: ' + JSON.stringify(cfg) + '\n\n'); } catch {}
  });
  res.json({ ok: true, ...cfg });
});

// Credit Reel font sizes, in px — GET to read, POST { headingSize, bodySize } to update
const CREDITS_STYLE_FILE = path.join(__dirname, '..', 'data', 'credits_style.json');

router.get('/api/credits-style', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json(JSON.parse(fs.readFileSync(CREDITS_STYLE_FILE, 'utf8')));
  } catch (e) {
    res.set('Cache-Control', 'no-store').json({ headingSize: 40, bodySize: 24 });
  }
});

router.post('/api/credits-style', (req, res) => {
  const headingSize = Math.max(8, Math.min(200, Number((req.body || {}).headingSize) || 40));
  const bodySize     = Math.max(8, Math.min(200, Number((req.body || {}).bodySize) || 24));
  fs.writeFileSync(CREDITS_STYLE_FILE, JSON.stringify({ headingSize, bodySize }));
  res.json({ ok: true, headingSize, bodySize });
});

// Item Check panel layout tuning (mploverlay_v7's item-check panel) —
// goldGap is the vertical space between gold-amount rows (px added on top
// of each row's own 31px height); homeOffsetX/Y and awayOffsetY/Y shift
// every element on that side (portraits, items, gold) together, so the
// whole blue/red half can be nudged in one edit instead of repositioning
// each row by hand. GET to read, POST the full object to update.
const ITEMCHECK_LAYOUT_FILE = path.join(__dirname, '..', 'data', 'itemcheck_layout.json');
const ITEMCHECK_LAYOUT_DEFAULTS = { goldGap: 26, homeOffsetX: 0, homeOffsetY: 0, awayOffsetX: 0, awayOffsetY: 0 };

router.get('/api/itemcheck-layout', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json(JSON.parse(fs.readFileSync(ITEMCHECK_LAYOUT_FILE, 'utf8')));
  } catch (e) {
    res.set('Cache-Control', 'no-store').json(ITEMCHECK_LAYOUT_DEFAULTS);
  }
});

router.post('/api/itemcheck-layout', (req, res) => {
  const b = req.body || {};
  const clampNum = (v, d, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || d));
  const layout = {
    goldGap:     clampNum(b.goldGap,     26, 0,    200),
    homeOffsetX: clampNum(b.homeOffsetX, 0,  -400, 400),
    homeOffsetY: clampNum(b.homeOffsetY, 0,  -400, 400),
    awayOffsetX: clampNum(b.awayOffsetX, 0,  -400, 400),
    awayOffsetY: clampNum(b.awayOffsetY, 0,  -400, 400),
  };
  fs.writeFileSync(ITEMCHECK_LAYOUT_FILE, JSON.stringify(layout));
  res.json({ ok: true, ...layout });
});

// Seat arrangement — { camp1: [1..5 perm], camp2: [1..5 perm] }. Deliberately
// NOT applied to /api/gamedata-proxy or anything server-side (see
// lib/seatArrangement.js's own header comment for why) — this route only
// persists the permutation and pushes it live to mploverlay_v7.html pages,
// which apply it themselves via getPlayerArranged() in overlay-core.js.
const seatArrangement = require('../lib/seatArrangement');

router.get('/api/seat-arrangement', (req, res) => {
  res.set('Cache-Control', 'no-store').json(seatArrangement.readArrangement());
});

router.post('/api/seat-arrangement', (req, res) => {
  const saved = seatArrangement.writeArrangement(req.body || {});
  // Broadcast over the shared /overlay/events stream — every open
  // mploverlay_v7.html tab/OBS browser source picks this up instantly via
  // its 'seat_arrangement' SSE listener (overlay-debug.js), no reload
  // needed. Same fan-out shape as the 'featuretoggle' event.
  const payload = JSON.stringify(saved);
  state.overlayClients.forEach(c => { try { c.write(`event: seat_arrangement\ndata: ${payload}\n\n`); } catch {} });
  res.json({ ok: true, ...saved });
});

// Game API base URL — GET to read, POST { url } to update
const GAME_URL_FILE = path.join(__dirname, '..', 'data', 'game_api_url.json');

router.get('/api/game-url', (req, res) => {
  res.json({ url: readUrlForMode(GAME_URL_FILE, '') });
});

router.post('/api/game-url', (req, res) => {
  const url = ((req.body || {}).url || '').trim().replace(/\/$/, '');
  writeUrlForMode(GAME_URL_FILE, url);
  res.json({ ok: true, url });
});




// Player photo manifest — returns available filenames per pose for client-side lookup
const PHOTOS_DIR = path.join(__dirname, '..', 'assets', 'photo');

// GET /api/signature-photos — player names (igns) with a SIGNATURE cutout
// available in assets/photo/SIGNATURE/, e.g. for the kill-event photo popup.
// Filename convention: <ign>_SIGNATURE_resized.png
router.get('/api/signature-photos', (req, res) => {
  try {
    const names = fs.readdirSync(path.join(PHOTOS_DIR, 'SIGNATURE'))
      .filter(f => f.endsWith('_SIGNATURE_resized.webp'))
      .map(f => f.slice(0, -'_SIGNATURE_resized.webp'.length));
    res.set('Cache-Control', 'no-store').json({ names });
  } catch (e) {
    res.status(500).json({ names: [] });
  }
});

// GET /api/team-logos — tricodes with a logo available in logos/, e.g. for
// the dashboard's Wipe Out Random Test (see keTrigger in dashboard.html).
const LOGOS_DIR = path.join(__dirname, '..', 'assets', 'team', 'logos');
router.get('/api/team-logos', (req, res) => {
  try {
    const tricodes = fs.readdirSync(LOGOS_DIR)
      .filter(f => f.endsWith('.png'))
      .map(f => f.slice(0, -'.png'.length));
    res.set('Cache-Control', 'no-store').json({ tricodes });
  } catch (e) {
    res.status(500).json({ tricodes: [] });
  }
});

router.get('/api/photo-manifest', (req, res) => {
  try {
    const poses = ['VICTORY', 'DEFEAT'];
    const manifest = {};
    for (const pose of poses) {
      const dir = path.join(PHOTOS_DIR, pose);
      try {
        manifest[pose] = fs.readdirSync(dir).filter(f => /\.webp$/i.test(f));
      } catch { manifest[pose] = []; }
    }
    res.set('Cache-Control', 'no-store').json(manifest);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});





// Server-side proxy — serves the game API payload lib/pollers.js already
// polls every second (state.lastGameData), so every postgame.html board reads
// an in-memory cache instead of each one triggering its own live round-trip
// to the upstream game API. Falls back to a direct fetch only if the poller
// hasn't landed a payload yet (e.g. right at server startup).
//
// ?fresh=1 skips state.lastGameData and always does a live fetch to the
// upstream game API right then — for boards that need the API's current
// value at the exact moment they read it (Player Board, Post Emblems, Post
// Items, Post Stats, and now arrangement-dashboard.html's 2s poll) rather
// than whatever the once-a-second poll last caught. Still goes through
// this server, not the browser, so it works the same everywhere the
// cached path already works (no new CORS/reachability requirements on
// whatever machine renders postgame.html).
//
// Two protections lib/pollers.js's httpGet() already has that this path
// was missing until arrangement-dashboard.html started hitting it every
// 2s from a static, always-mounted dashboard iframe (so it now runs
// continuously for the life of any open dashboard tab, not just when a
// Post board happens to show): a hard timeout, and in-flight coalescing.
// Plain fetch() has no default timeout — a stalled upstream would hang
// this request forever — and with no coalescing, a slow upstream plus a
// setInterval-driven caller piles up one more overlapping live fetch to
// the SAME upstream URL every 2s indefinitely, exactly the kind of thing
// that reads as "everything got slow" (see HTTP_GET_TIMEOUT_MS's comment
// in lib/pollers.js for the same lesson learned there).
const GAMEDATA_FRESH_TIMEOUT_MS = 8000;
let gamedataFreshInFlight = null;
function fetchGamedataFresh(gameUrl) {
  if (gamedataFreshInFlight) return gamedataFreshInFlight;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GAMEDATA_FRESH_TIMEOUT_MS);
  gamedataFreshInFlight = fetch(gameUrl, { signal: controller.signal })
    .then(async (r) => {
      if (!r.ok) throw new Error(`upstream ${r.status}`);
      return normalizeGameFeed(await r.json());   // raw M8 feed -> seat_N shape
    })
    .finally(() => {
      clearTimeout(timer);
      gamedataFreshInFlight = null;
    });
  return gamedataFreshInFlight;
}

// Game API refresh rate (ms) — Settings -> "Game API Refresh Rate". GET { ms, min, max }, POST { ms }.
router.get('/api/game-refresh', (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ms: getGameRefreshMs(), min: GAME_REFRESH_MIN, max: GAME_REFRESH_MAX });
});
router.post('/api/game-refresh', (req, res) => {
  try { res.json({ ok: true, ms: setGameRefreshMs((req.body || {}).ms), min: GAME_REFRESH_MIN, max: GAME_REFRESH_MAX }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/api/gamedata-proxy', async (req, res) => {
  // ?fresh=1 used to force a live upstream read. The poller now refreshes every game-refresh interval
  // (150ms default), so a cache that recent IS fresh — serve it instead of hitting the upstream once per
  // caller. Falls through to a live fetch only if the cache is missing or stale (poller stalled).
  const freshEnough = state.lastGameData && state.lastGameDataAt && (Date.now() - state.lastGameDataAt) <= Math.max(1500, getGameRefreshMs() * 4);
  if (state.lastGameData && (req.query.fresh !== '1' || freshEnough)) {
    return res.set('Cache-Control', 'no-store').json(state.lastGameData);
  }
  try {
    const gameUrl = readUrlForMode(GAME_URL_FILE, '').trim();
    if (!gameUrl) return res.status(404).json({ error: 'no game URL configured' });
    const data = await fetchGamedataFresh(gameUrl);
    res.set('Cache-Control', 'no-store').json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Post-Info API base URL — GET to read, POST { url } to update. Separate
// feed from the main Game API: the live sub-info feed has no orange/purple
// jungle-buff counts, but this one does, in camp_list[].enemy_area_get
// (an array of per-time-window deltas — sum them for a running total, see
// postgame.html's fetchCmbData/fetchMiddleBoardData).
const POST_INFO_URL_FILE    = path.join(__dirname, '..', 'data', 'post_info_api_url.json');
const POST_INFO_URL_DEFAULT = 'http://10.88.120.60:5001/api/post-info/';

router.get('/api/post-info-url', (req, res) => {
  res.json({ url: readUrlForMode(POST_INFO_URL_FILE, POST_INFO_URL_DEFAULT) });
});

router.post('/api/post-info-url', (req, res) => {
  const url = ((req.body || {}).url || '').trim();
  writeUrlForMode(POST_INFO_URL_FILE, url);
  res.json({ ok: true, url });
});

// Winrate API base URL — GET to read, POST { url } to update. Same
// { live, web, debug } file shape as every other per-API URL; all three
// modes start on the same endpoint. Setting only for now (no consumer yet).
const WINRATE_URL_FILE    = path.join(__dirname, '..', 'data', 'winrate_api_url.json');
const WINRATE_URL_DEFAULT = 'https://mlbb.mrf5.net/api/winrate/';

router.get('/api/winrate-url', (req, res) => {
  res.json({ url: readUrlForMode(WINRATE_URL_FILE, WINRATE_URL_DEFAULT) });
});

router.post('/api/winrate-url', (req, res) => {
  const url = ((req.body || {}).url || '').trim();
  writeUrlForMode(WINRATE_URL_FILE, url);
  res.json({ ok: true, url });
});







// Gold Info API base URL (Gold Graph Check V2) — GET to read, POST { url } to update.
// Same { live, web, debug } file shape as every other per-API URL.
const GOLDINFO_URL_FILE    = path.join(__dirname, '..', 'data', 'goldinfo_api_url.json');
const GOLDINFO_URL_DEFAULT = 'https://mlbb.mrf5.net/api/gold-info/';

router.get('/api/goldinfo-url', (req, res) => {
  res.json({ url: readUrlForMode(GOLDINFO_URL_FILE, GOLDINFO_URL_DEFAULT) });
});

router.post('/api/goldinfo-url', (req, res) => {
  const url = ((req.body || {}).url || '').trim();
  writeUrlForMode(GOLDINFO_URL_FILE, url);
  res.json({ ok: true, url });
});

// Proxy for Gold Graph Check V2 — 1s cache + shared in-flight fetch (same shape as /api/winrate-proxy).
let goldinfoCache = { t: 0, body: null };
let goldinfoInFlight = null;
router.get('/api/goldinfo-proxy', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (goldinfoCache.body && Date.now() - goldinfoCache.t < 1000) return res.json(goldinfoCache.body);
  try {
    const url = readUrlForMode(GOLDINFO_URL_FILE, GOLDINFO_URL_DEFAULT).trim();
    if (!url) return res.status(404).json({ error: 'no gold-info URL configured' });
    if (!goldinfoInFlight) {
      goldinfoInFlight = fetch(url, { signal: AbortSignal.timeout(2500) })
        .then(async r => {
          if (!r.ok) throw new Error('upstream HTTP ' + r.status);
          goldinfoCache = { t: Date.now(), body: await r.json() };
        })
        .finally(() => { goldinfoInFlight = null; });
    }
    await goldinfoInFlight;
    res.json(goldinfoCache.body);
  } catch (e) {
    // Only serve a stale copy briefly — past that, 502 so Gold Graph Check falls back to V1.
    if (goldinfoCache.body && Date.now() - goldinfoCache.t < 5000) return res.json(goldinfoCache.body);
    res.status(502).json({ error: e.message });
  }
});

// Server-side proxy for the Live Win Rate overlay (mploverlay_v7) — fetches
// the Winrate API above ({ camp1: [%...], camp2: [%...], time: [s...] }, one
// sample per 10s of game time) with a 1s in-memory cache so several open
// overlay pages don't each hit the upstream.
// The upstream can take several seconds, so concurrent requests share one
// in-flight fetch (winrateInFlight) instead of stacking up.
let winrateCache = { t: 0, body: null };
let winrateInFlight = null;
router.get('/api/winrate-proxy', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (winrateCache.body && Date.now() - winrateCache.t < 1000) return res.json(winrateCache.body);
  try {
    const url = readUrlForMode(WINRATE_URL_FILE, WINRATE_URL_DEFAULT).trim();
    if (!url) return res.status(404).json({ error: 'no winrate URL configured' });
    if (!winrateInFlight) {
      winrateInFlight = fetch(url, { signal: AbortSignal.timeout(9500) })
        .then(async r => {
          if (!r.ok) throw new Error('upstream HTTP ' + r.status);
          winrateCache = { t: Date.now(), body: await r.json() };
        })
        .finally(() => { winrateInFlight = null; });
    }
    await winrateInFlight;
    res.json(winrateCache.body);
  } catch (e) {
    if (winrateCache.body) return res.json(winrateCache.body); // stale beats blank
    res.status(502).json({ error: e.message });
  }
});

// Server-side proxy — serves the post-info payload lib/pollers.js polls
// (state.lastPostInfoData), same caching pattern as /api/gamedata-proxy.
router.get('/api/postinfo-proxy', async (req, res) => {
  if (state.lastPostInfoData) {
    return res.set('Cache-Control', 'no-store').json(state.lastPostInfoData);
  }
  try {
    const url = readUrlForMode(POST_INFO_URL_FILE, POST_INFO_URL_DEFAULT).trim();
    if (!url) return res.status(404).json({ error: 'no post-info URL configured' });
    // Same reasoning as /api/lineuprate-data below — an unreachable upstream
    // (e.g. the game-client PC off the network) would otherwise hang this
    // request indefinitely. postgame.html's middleboard polls this every 3s
    // whenever visible, uncached, with no dedup across tabs, so a hung
    // upstream here piles up hung connections fast once a few overlay tabs
    // are open — fail fast instead.
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return res.status(502).json({ error: `upstream ${r.status}` });
    const data = await r.json();
    res.set('Cache-Control', 'no-store').json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// HRM Server (heartrate ingestion) base URL — GET to read, POST { url } to update
const HRM_URL_FILE    = path.join(__dirname, '..', 'data', 'hrm_api_url.json');
const HRM_URL_DEFAULT = 'http://<HRM-SERVER-IP>:5055';

router.get('/api/hrm-url', (req, res) => {
  res.json({ url: readUrlForMode(HRM_URL_FILE, HRM_URL_DEFAULT) });
});

router.post('/api/hrm-url', (req, res) => {
  const url = ((req.body || {}).url || '').trim().replace(/\/$/, '');
  writeUrlForMode(HRM_URL_FILE, url);
  res.json({ ok: true, url });
});












// Server-side proxy — fetches the Gold vs Gold Sector API and returns JSON, avoids browser CORS issues
router.get('/api/golddistri-data', (req, res) => {
  // Built from the raw battle feed (lib/feedDerived.js) — no external Gold Distribution API.
  if (!feedDerived.hasRawFeed()) return res.status(503).json({ error: 'no battle feed yet' });
  res.set('Cache-Control', 'no-store').json(feedDerived.goldDistri());
});

// Dashboard selectors for the two derived panels above (lib/feedDerived.js). Fire-and-forget GETs so they
// work as dashboard buttons and as copyable routes; the panels pick the change up on their next poll.
router.get('/overlay/distri/gold-role/:role', (req, res) => {
  try { res.set('Cache-Control', 'no-store').json({ ok: true, role: feedDerived.setDistriRole(req.params.role) }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.get('/overlay/distri/kda/:camp/:role', (req, res) => {
  try { res.set('Cache-Control', 'no-store').json(Object.assign({ ok: true }, feedDerived.setKdaSelection(req.params.camp, req.params.role))); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.get('/api/distri-selection', (req, res) => res.set('Cache-Control', 'no-store').json(feedDerived.getSelection()));




// Server-side proxy — fetches the Get Selection API and returns JSON, avoids browser CORS issues
router.get('/api/kdadistri-data', (req, res) => {
  // Built from the raw battle feed (lib/feedDerived.js) — no external Get Selection API.
  if (!feedDerived.hasRawFeed()) return res.status(503).json({ error: 'no battle feed yet' });
  res.set('Cache-Control', 'no-store').json(feedDerived.kdaDistri());
});

// MVP Highlights (game-mvp/view) API base URL — GET to read, POST { url } to update
const HIGHLIGHTS_URL_FILE    = path.join(__dirname, '..', 'data', 'highlights_api_url.json');
const HIGHLIGHTS_URL_DEFAULT = 'https://theapi.dpdns.org/api/game-mvp/view/';

router.get('/api/highlights-url', (req, res) => {
  res.json({ url: readUrlForMode(HIGHLIGHTS_URL_FILE, HIGHLIGHTS_URL_DEFAULT) });
});

router.post('/api/highlights-url', (req, res) => {
  const url = ((req.body || {}).url || '').trim();
  writeUrlForMode(HIGHLIGHTS_URL_FILE, url);
  res.json({ ok: true, url });
});

// Server-side proxy — fetches the MVP Highlights API and returns JSON, avoids browser CORS issues
router.get('/api/highlights-data', async (req, res) => {
  try {
    const url = readUrlForMode(HIGHLIGHTS_URL_FILE, HIGHLIGHTS_URL_DEFAULT).trim();
    // Same reasoning as /api/lineuprate-data below — fail fast instead of
    // hanging indefinitely on an unreachable upstream.
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return res.status(502).json({ error: `upstream ${r.status}` });
    const data = await r.json();
    res.set('Cache-Control', 'no-store').json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});














module.exports = router;
