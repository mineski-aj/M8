// routes/overlay.js — SSE + all /overlay/* + /meter/*
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();
const state   = require('../lib/state');

// GET /api/player-photos — basenames with both FRONT and VICTORY photos available
const PHOTOS_DIR = path.join(__dirname, '..', 'assets', 'photo');
let _playerPhotoNames = null;
router.get('/api/player-photos', (req, res) => {
  if (!_playerPhotoNames) {
    try {
      const front = fs.readdirSync(path.join(PHOTOS_DIR, 'FRONT'))
        .filter(f => f.endsWith('_FRONT_resized.webp'))
        .map(f => f.slice(0, -'_FRONT_resized.webp'.length));
      const victorySet = new Set(
        fs.readdirSync(path.join(PHOTOS_DIR, 'VICTORY'))
          .filter(f => f.endsWith('_VICTORY_resized.webp'))
          .map(f => f.slice(0, -'_VICTORY_resized.webp'.length))
      );
      _playerPhotoNames = front.filter(n => victorySet.has(n));
    } catch (e) {
      _playerPhotoNames = [];
    }
  }
  res.set({ 'Cache-Control': 'no-store' }).json({ names: _playerPhotoNames });
});


// GET /overlay/force-reload — hard-reload every open overlay page (postgame.html,
// ENTVC.html, DraftIndex.html, Draft.html, mpltag.html, ingame.html) at
// once, so production browser sources don't need to be refreshed by hand
// after a dashboard Edit-tab save or any other change. Reuses the exact
// 'reload' SSE event routes/overlayStyles.js already broadcasts after a
// style save — every overlay page already listens for it, so no client-side
// changes were needed to wire this up. See dashboard.html's Settings page
// ("Overlay Pages" section) for the button that calls this.
router.get('/overlay/force-reload', (req, res) => {
  state.overlayClients.forEach(c => { try { c.write('event: reload\ndata: {}\n\n'); } catch {} });
  res.set({ 'Cache-Control': 'no-store' }).json({ ok: true, clients: state.overlayClients.length });
});



// ═══ Draft overlay (html/Draft.html): show/hide/state, player-photo mode, Map Detail v2 ═══
// GET /overlay/draft-photo-mode — current player-photo source ('live' | 'random')
router.get('/overlay/draft-photo-mode', (req, res) => {
  res.set({ 'Cache-Control': 'no-store' }).json({ mode: state.draftPhotoMode });
});

// GET /overlay/draft-photo-mode/:mode — set mode, broadcast to connected overlays
router.get('/overlay/draft-photo-mode/:mode', (req, res) => {
  const mode = req.params.mode;
  if (mode !== 'live' && mode !== 'random') {
    return res.status(400).json({ ok: false, error: 'unknown mode' });
  }
  state.draftPhotoMode = mode;
  const payload = JSON.stringify({ mode });
  state.overlayClients.forEach(c => { try { c.write(`event: draftphotomode\ndata: ${payload}\n\n`); } catch {} });
  res.set({ 'Cache-Control': 'no-store' }).json({ ok: true, mode });
});

// GET /overlay/draft-state — current shown/hidden state, so a
// freshly (re)loaded Draft.html can restore instead of guessing.
router.get('/overlay/draft-state', (req, res) => {
  res.set({ 'Cache-Control': 'no-store' }).json({ active: state.draftActive });
});

// Fullscreen.html scenes (REBROADCAST): 'waiting' (Waiting Screen), 'lobby' (Waiting Lobby). One on air at a time. SSE event 'fullscreen' {name, action}.
const FULLSCREENS = ['waiting', 'lobby'];
router.get('/overlay/fullscreen-state', (req, res) => {
  res.set({ 'Cache-Control': 'no-store' }).json(state.fullscreens || {});
});
['show', 'hide'].forEach(action => {
  router.get('/overlay/fullscreen/:name/' + action, (req, res) => {
    const name = req.params.name;
    if (!FULLSCREENS.includes(name)) return res.status(404).json({ ok: false, error: 'unknown fullscreen scene' });
    if (action === 'show') FULLSCREENS.forEach(k => {   // full-screen scenes replace each other: the other one plays out
      if (k !== name && state.fullscreens[k]) { state.fullscreens[k] = false; state.overlayClients.forEach(c => { try { c.write('event: fullscreen\ndata: ' + JSON.stringify({ name: k, action: 'hide' }) + '\n\n'); } catch {} }); }
    });
    state.fullscreens[name] = action === 'show';
    state.overlayClients.forEach(c => { try { c.write('event: fullscreen\ndata: ' + JSON.stringify({ name, action }) + '\n\n'); } catch {} });
    res.set({ 'Cache-Control': 'no-store' }).json({ ok: true, name, action });
  });
});

// Lower Thirds — one named lower third at a time per key (currently just 'headline'). SSE event 'lowerthird' {name, action}.
const audienceComment = require('../lib/audienceComment');   // Audience Comment lower third: rolls through the Community Responses sheet
const LOWER_THIRDS = ['headline', 'nametag1', 'nametag2', 'nametag3', 'audiencecomment', 'talentpredict', 'countdownbug'];   // nametag1 = panel host, 2 = casters 1+2, 3 = host + casters 1+2; talentpredict = casters' series picks; countdownbug = top-left countdown bug
// Quadrant rule (same idea as the Ingame quadrants below): lower thirds that share a screen quadrant never overlap — showing one first plays
// the quadrant's current one OUT (its own hide event, so every page + the dashboard toggle follow), then sends the new show after the exit.
const LT_QUADRANTS = { top: ['countdownbug'], bottom: ['headline', 'nametag1', 'nametag2', 'nametag3', 'audiencecomment', 'talentpredict'] };
const LT_EXIT_MS = 750;   // longest lower-third exit animation
function ltBroadcast(name, action) { state.overlayClients.forEach(c => { try { c.write('event: lowerthird\ndata: ' + JSON.stringify({ name, action }) + '\n\n'); } catch {} }); }
router.get('/overlay/lowerthird-state', (req, res) => {
  res.set({ 'Cache-Control': 'no-store' }).json(state.lowerThirds || {});
});
['show', 'hide'].forEach(action => {
  router.get('/overlay/lowerthird/:name/' + action, (req, res) => {
    const name = req.params.name;
    if (!LOWER_THIRDS.includes(name)) return res.status(404).json({ ok: false, error: 'unknown lower third' });
    let delay = 0;
    if (action === 'show') {
      const quad = Object.keys(LT_QUADRANTS).find(q => LT_QUADRANTS[q].includes(name));
      (LT_QUADRANTS[quad] || []).forEach(k => {
        if (k === name || !state.lowerThirds[k]) return;
        state.lowerThirds[k] = false;
        ltBroadcast(k, 'hide');
        if (k === 'audiencecomment') audienceComment.stop();
        delay = LT_EXIT_MS;
      });
    }
    state.lowerThirds[name] = action === 'show';
    const send = () => {
      if (action === 'show' && !state.lowerThirds[name]) return;   // hidden again during the wait
      ltBroadcast(name, action);
      if (name === 'audiencecomment') { if (action === 'show') audienceComment.start(); else audienceComment.stop(); }   // owns the rolling cursor while on air
    };
    if (delay) setTimeout(send, delay); else send();
    res.set({ 'Cache-Control': 'no-store' }).json({ ok: true, name, action });
  });
});
// Audience Comment settings (start line, seconds per comment) + the current line — GET to read, POST { startLine, seconds } to update.
router.get('/api/audience-comment', (req, res) => res.set({ 'Cache-Control': 'no-store' }).json(audienceComment.snapshot()));
router.post('/api/audience-comment', (req, res) => {
  audienceComment.setSettings(req.body || {});
  res.set({ 'Cache-Control': 'no-store' }).json(audienceComment.snapshot());
});

// GET /overlay/draft/show
router.get('/overlay/draft/show', (req, res) => {
  state.draftActive = true;
  state.overlayClients.forEach(c => { try { c.write('event: draft\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/draft/hide
router.get('/overlay/draft/hide', (req, res) => {
  state.draftActive = false;
  state.overlayClients.forEach(c => { try { c.write('event: draft\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// Draft.html — Map Detail. No `type` param — the TEXT shown is driven by
// whatever map Draft.html's own /match/state poll has as the currently
// selected map (Flying Cloud / Golden Turret / Healing Turtle / Revealing
// Wisp); for any other map, 'show' is a no-op client-side. Server side is
// just a plain show/hide.

// Map Detail v2 — the map bug itself expands to reveal the description
// (Draft.html's #mapdetail2-plate).
router.get('/overlay/mapdetailv2/show', (req, res) => {
  state.mapDetailV2 = { visible: true };
  state.overlayClients.forEach(c => { try { c.write('event: mapdetailv2\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});
router.get('/overlay/mapdetailv2/hide', (req, res) => {
  state.mapDetailV2 = { visible: false };
  state.overlayClients.forEach(c => { try { c.write('event: mapdetailv2\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});
router.get('/overlay/mapdetailv2-state', (req, res) => {
  res.set({ "Cache-Control": "no-store" }).json(state.mapDetailV2);
});



// SSE heartbeat
setInterval(() => {
  state.overlayClients.forEach(c => { try { c.write(': heartbeat\n\n'); } catch {} });
}, 15000);

// GET /overlay/events — SSE stream
router.get('/overlay/events', (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.writeHead(200);
  res.write(': connected\n\n');
  state.overlayClients.push(res);
  req.on("close", () => {
    const i = state.overlayClients.indexOf(res);
    if (i !== -1) state.overlayClients.splice(i, 1);
  });
});

// GET /meter/plus|minus|clear — BPM meter level nudges (mploverlay_v7's
// overlay-bpmmeter.js). Show/hide moved to the standard checkOverlays
// pattern below (/overlay/bpmmeter/show|hide) so the dashboard's toggle
// button gets real showing/hidden state instead of this being fire-and-forget.
router.get('/meter/:cmd', (req, res) => {
  const cmd = req.params.cmd;
  if (["plus", "minus", "clear"].includes(cmd)) {
    state.overlayClients.forEach(c => { try { c.write(`event: meter\ndata: {"cmd":"${cmd}"}\n\n`); } catch {} });
    res.set({ "Cache-Control": "no-store" }).json({ ok: true, cmd });
  } else {
    res.status(404).json({ error: "unknown meter command" });
  }
});

// GET /overlay/bpmmeter/show
router.get('/overlay/bpmmeter/show', (req, res) => {
  state.checkOverlays.bpmmeter = true;
  state.overlayClients.forEach(c => { try { c.write('event: bpmmeter\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/bpmmeter/hide
router.get('/overlay/bpmmeter/hide', (req, res) => {
  state.checkOverlays.bpmmeter = false;
  state.overlayClients.forEach(c => { try { c.write('event: bpmmeter\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});










// GET /overlay/fights/show
router.get('/overlay/fights/show', (req, res) => {
  state.fightsPendingAction = { action: "show", ts: Date.now() };
  state.overlayClients.forEach(c => { try { c.write('event: fights\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/fights/hide
router.get('/overlay/fights/hide', (req, res) => {
  state.fightsPendingAction = { action: "hide", ts: Date.now() };
  state.overlayClients.forEach(c => { try { c.write('event: fights\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});


// ── Postgame: chosen MVP + scene-background toggle ───────────────────────
// MVP pick (MCT MVP scene): which of the 10 players the dashboard chose — { camp: 1|2, seat: 1..5 }, persisted. Read at scene-show time.
const MVP_PICK_FILE = path.join(__dirname, '..', 'data', 'mvp_pick.json');
// two independent picks: 'mvp' and 'potm' (Player of the Match). debug = show the built-in sample player (no game / no photos needed)
let picks = { mvp: { camp: 1, seat: 1, debug: false }, potm: { camp: 1, seat: 1, debug: false } };
try {
  const j = JSON.parse(fs.readFileSync(MVP_PICK_FILE, 'utf8'));
  const ok = x => x && (x.camp === 1 || x.camp === 2) && x.seat >= 1 && x.seat <= 5;
  if (ok(j)) picks.mvp = { camp: j.camp, seat: j.seat, debug: !!j.debug };                 // old single-pick file
  ['mvp', 'potm'].forEach(k => { if (ok(j[k])) picks[k] = { camp: j[k].camp, seat: j[k].seat, debug: !!j[k].debug }; });
} catch (e) {}
const pickKind = req => ((req.query && req.query.kind) || (req.body && req.body.kind)) === 'potm' ? 'potm' : 'mvp';
router.get('/api/mvp-pick', (req, res) => res.set('Cache-Control', 'no-store').json(picks[pickKind(req)]));
router.post('/api/mvp-pick', (req, res) => {
  const k = pickKind(req), cur = picks[k];
  const b = req.body || {}, camp = b.camp != null ? parseInt(b.camp, 10) : cur.camp, seat = b.seat != null ? parseInt(b.seat, 10) : cur.seat;
  if (!(camp === 1 || camp === 2) || !(seat >= 1 && seat <= 5)) return res.status(400).json({ ok: false, error: 'camp 1|2, seat 1-5' });
  picks[k] = { camp, seat, debug: b.debug != null ? !!b.debug : cur.debug };
  try { fs.writeFileSync(MVP_PICK_FILE, JSON.stringify(picks)); } catch (e) {}
  res.set('Cache-Control', 'no-store').json({ ok: true, pick: picks[k] });
});
// Scene background: true = each postgame scene's installed background (loop video etc.), false = transparent. Same for M8 and MCT.
const FS_BG_FILE = path.join(__dirname, '..', 'data', 'fs_background.json');
let fsBackground = true;
try { fsBackground = JSON.parse(fs.readFileSync(FS_BG_FILE, 'utf8')).on !== false; } catch (e) {}
router.get('/api/fs-bg', (req, res) => res.set('Cache-Control', 'no-store').json({ on: fsBackground }));
['on', 'off'].forEach(v => router.get('/overlay/fs-bg/' + v, (req, res) => {
  fsBackground = v === 'on';
  try { fs.writeFileSync(FS_BG_FILE, JSON.stringify({ on: fsBackground })); } catch (e) {}
  const line = 'event: fsbg\ndata: ' + JSON.stringify({ on: fsBackground }) + '\n\n';
  state.overlayClients.forEach(c => { try { c.write(line); } catch {} });
  res.set('Cache-Control', 'no-store').json({ ok: true, on: fsBackground });
}));

// GET /overlay/check-overlays — current shown/hidden state of the
// sliding "check" overlays, so the dashboard toggle can restore its
// position on load instead of guessing.
router.get('/overlay/check-overlays', (req, res) => {
  res.set({ 'Cache-Control': 'no-store' }).json(state.checkOverlays);
});

// ── Ingame quadrants ─────────────────────────────────────────────────────
// Panels that share a quadrant of the Ingame screen must never overlap: showing one first plays the quadrant's current panel OUT
// (its own normal hide event, so every page + the dashboard toggle follow), then sends the new panel's show after the exit animation.
// Player UI (spans every quadrant), the scoreboard (alone in the top quadrant) and the automatic effects (kill events, Trinity, Level 4 ...)
// are not part of this. Keys not listed here are unaffected.
const QUADRANTS = {
  bottom: ['itemcheck', 'emblemcheck', 'goldgraphcheck', 'golddiffcheck', 'livewinrate', 'teamfightcheck'],
  right:  ['sideexpcheck', 'sidetakencheck', 'sidedamagecheck', 'sidegoldcheck', 'sidegolddistricheck', 'sidekdadistricheck'],
};
const QUADRANT_EXIT_MS = 800;   // longest panel exit animation (MCT item/emblem hide timer is 750 ms)
function broadcastCheck(key, action) {
  const sideKey = QUADRANTS.right.includes(key);
  const line = sideKey
    ? 'event: sidecheck\ndata: ' + JSON.stringify({ check: key, action }) + '\n\n'
    : 'event: ' + key + '\ndata: {"action":"' + action + '"}\n\n';
  state.overlayClients.forEach(c => { try { c.write(line); } catch {} });
}
// Mark `key` shown and broadcast its show — after exiting whatever else is up in the same quadrant.
function quadrantShow(key) {
  let delay = 0;
  Object.keys(QUADRANTS).forEach(q => {
    if (!QUADRANTS[q].includes(key)) return;
    QUADRANTS[q].forEach(k => {
      if (k !== key && state.checkOverlays[k]) { state.checkOverlays[k] = false; broadcastCheck(k, 'hide'); delay = QUADRANT_EXIT_MS; }
    });
  });
  state.checkOverlays[key] = true;
  if (!delay) { broadcastCheck(key, 'show'); return; }
  setTimeout(() => { if (state.checkOverlays[key]) broadcastCheck(key, 'show'); }, delay);   // skipped if it was hidden again meanwhile
}

// GET /overlay/itemcheck/show
router.get('/overlay/itemcheck/show', (req, res) => {
  quadrantShow('itemcheck');
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/itemcheck/hide
router.get('/overlay/itemcheck/hide', (req, res) => {
  state.checkOverlays.itemcheck = false;
  state.overlayClients.forEach(c => { try { c.write('event: itemcheck\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/teamfightcheck/show — Live Team Fight damage bar (mploverlay_v7)
router.get('/overlay/teamfightcheck/show', (req, res) => {
  quadrantShow('teamfightcheck');
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/teamfightcheck/hide
router.get('/overlay/teamfightcheck/hide', (req, res) => {
  state.checkOverlays.teamfightcheck = false;
  state.overlayClients.forEach(c => { try { c.write('event: teamfightcheck\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/emblemcheck/show
router.get('/overlay/emblemcheck/show', (req, res) => {
  quadrantShow('emblemcheck');
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/emblemcheck/hide
router.get('/overlay/emblemcheck/hide', (req, res) => {
  state.checkOverlays.emblemcheck = false;
  state.overlayClients.forEach(c => { try { c.write('event: emblemcheck\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/golddiffcheck/show
router.get('/overlay/golddiffcheck/show', (req, res) => {
  quadrantShow('golddiffcheck');
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/golddiffcheck/hide
router.get('/overlay/golddiffcheck/hide', (req, res) => {
  state.checkOverlays.golddiffcheck = false;
  state.overlayClients.forEach(c => { try { c.write('event: golddiffcheck\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});


// GET /overlay/livewinrate/show
router.get('/overlay/livewinrate/show', (req, res) => {
  quadrantShow('livewinrate');
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/livewinrate/hide
router.get('/overlay/livewinrate/hide', (req, res) => {
  state.checkOverlays.livewinrate = false;
  state.overlayClients.forEach(c => { try { c.write('event: livewinrate\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/goldgraphcheck/show
router.get('/overlay/goldgraphcheck/show', (req, res) => {
  quadrantShow('goldgraphcheck');
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/goldgraphcheck/hide
router.get('/overlay/goldgraphcheck/hide', (req, res) => {
  state.checkOverlays.goldgraphcheck = false;
  state.overlayClients.forEach(c => { try { c.write('event: goldgraphcheck\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});










// GET /overlay/scoreboard/show
router.get('/overlay/scoreboard/show', (req, res) => {
  state.checkOverlays.scoreboard = true;
  state.overlayClients.forEach(c => { try { c.write('event: scoreboard\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/scoreboard/hide
router.get('/overlay/scoreboard/hide', (req, res) => {
  state.checkOverlays.scoreboard = false;
  state.overlayClients.forEach(c => { try { c.write('event: scoreboard\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/playerui/show
router.get('/overlay/playerui/show', (req, res) => {
  state.checkOverlays.playerui = true;
  state.overlayClients.forEach(c => { try { c.write('event: playerui\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/playerui/hide
router.get('/overlay/playerui/hide', (req, res) => {
  state.checkOverlays.playerui = false;
  state.overlayClients.forEach(c => { try { c.write('event: playerui\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});







// GET /overlay/hrm-state — current per-player heart-rate meter on/off
// state (ingame_red.html / ingame_blue.html), so any page (dashboard,
// ingame overlays on a different browser/machine, vMix) can poll the
// same source of truth instead of relying on each browser's own
// localStorage, which never syncs across separate machines.
router.get('/overlay/hrm-state', (req, res) => {
  res.set({ 'Cache-Control': 'no-store' }).json(state.hrmOff);
});

// GET /overlay/hrm/:slot/show — turn the BPM meter back on (LIVE) for one player
router.get('/overlay/hrm/:slot/show', (req, res) => {
  const slot = req.params.slot;
  if (!(slot in state.hrmOff)) return res.status(400).json({ ok: false, error: 'unknown slot' });
  state.hrmOff[slot] = false;
  const payload = JSON.stringify({ slot, isOff: false });
  state.overlayClients.forEach(c => { try { c.write(`event: hrm\ndata: ${payload}\n\n`); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, slot, isOff: false });
});

// GET /overlay/hrm/:slot/hide — turn the BPM meter off (swap to KDA + Gold) for one player
router.get('/overlay/hrm/:slot/hide', (req, res) => {
  const slot = req.params.slot;
  if (!(slot in state.hrmOff)) return res.status(400).json({ ok: false, error: 'unknown slot' });
  state.hrmOff[slot] = true;
  const payload = JSON.stringify({ slot, isOff: true });
  state.overlayClients.forEach(c => { try { c.write(`event: hrm\ndata: ${payload}\n\n`); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, slot, isOff: true });
});

// "Side *check" ranking panels (exp, damage taken, and future ones)
// all broadcast over ONE shared SSE event — 'sidecheck' — with a
// `check` field identifying which panel, instead of a separate named
// event per panel. Keeps the client down to one listener and keeps
// adding a new side-check down to one array entry.
const SIDE_CHECK_KEYS = ['sideexpcheck', 'sidetakencheck', 'sidedamagecheck', 'sidegoldcheck', 'sidegolddistricheck', 'sidekdadistricheck'];
SIDE_CHECK_KEYS.forEach((key) => {
  router.get(`/overlay/${key}/show`, (req, res) => {
    quadrantShow(key);
    res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
  });

  router.get(`/overlay/${key}/hide`, (req, res) => {
    state.checkOverlays[key] = false;
    const payload = JSON.stringify({ check: key, action: 'hide' });
    state.overlayClients.forEach(c => { try { c.write(`event: sidecheck\ndata: ${payload}\n\n`); } catch {} });
    res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
  });
});

// GET /overlay/sideoverlays/hide — universal hide for every "side *check"
// ranking panel at once (side EXP/taken/damage/gold). Reuses the same
// shared 'sidecheck' SSE event each panel already listens for, so no
// client-side changes were needed to wire this up.
router.get('/overlay/sideoverlays/hide', (req, res) => {
  SIDE_CHECK_KEYS.forEach((key) => {
    state.checkOverlays[key] = false;
    const payload = JSON.stringify({ check: key, action: 'hide' });
    state.overlayClients.forEach(c => { try { c.write(`event: sidecheck\ndata: ${payload}\n\n`); } catch {} });
  });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true });
});

// GET /overlay/bottomoverlays/hide — universal hide for every "bottom"
// panel at once (item check, emblem check, gold-diff check, fight
// recap). Reuses the same named SSE events each panel already listens
// for, so no client-side changes were needed to wire this up.
router.get('/overlay/bottomoverlays/hide', (req, res) => {
  state.checkOverlays.itemcheck      = false;
  state.checkOverlays.emblemcheck    = false;
  state.checkOverlays.golddiffcheck  = false;
  state.checkOverlays.goldgraphcheck = false;
  state.checkOverlays.livewinrate    = false;
  state.checkOverlays.teamfightcheck = false;
  state.fightsPendingAction = { action: "hide", ts: Date.now() };
  state.overlayClients.forEach(c => {
    try {
      c.write('event: itemcheck\ndata: {"action":"hide"}\n\n');
      c.write('event: emblemcheck\ndata: {"action":"hide"}\n\n');
      c.write('event: golddiffcheck\ndata: {"action":"hide"}\n\n');
      c.write('event: goldgraphcheck\ndata: {"action":"hide"}\n\n');
      c.write('event: livewinrate\ndata: {"action":"hide"}\n\n');
      c.write('event: teamfightcheck\ndata: {"action":"hide"}\n\n');
      c.write('event: fights\ndata: {"action":"hide"}\n\n');
    } catch {}
  });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true });
});

// GET /overlay/fights/pending
router.get('/overlay/fights/pending', (req, res) => {
  const p = state.fightsPendingAction;
  state.fightsPendingAction = null;
  res.set({ "Cache-Control": "no-store" }).json(p || { action: null });
});

// GET /overlay/post_hearts/show
router.get('/overlay/post_hearts/show', (req, res) => {
  state.mplfsScene.matchboard = true;
  state.mplfsScene.middleboard = true;
  state.mplfsScene.playerboard = true;
  state.mplfsScene.activeFeature = 'hearts';
  state.overlayClients.forEach(c => {
    try {
      c.write('event: matchboard\ndata: {"action":"show"}\n\n');
      c.write('event: middleboard\ndata: {"action":"show"}\n\n');
      c.write('event: playerboard\ndata: {"action":"show"}\n\n');
      c.write('event: post_hearts\ndata: {"action":"show"}\n\n');
    } catch {}
  });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/post_hearts/hide
router.get('/overlay/post_hearts/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: post_hearts\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/post_richguy/show
router.get('/overlay/post_richguy/show', (req, res) => {
  state.mplfsScene.activeFeature = 'richguy';
  state.overlayClients.forEach(c => { try { c.write('event: post_richguy\ndata: {"action":"show","data":{}}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/post_richguy/hide
router.get('/overlay/post_richguy/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: post_richguy\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});







// GET /overlay/highlights/show
router.get('/overlay/highlights/show', (req, res) => {
  state.mplfsScene.activeFeature = 'highlights';
  state.overlayClients.forEach(c => { try { c.write('event: highlights\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/highlights/hide
router.get('/overlay/highlights/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: highlights\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/mvp/show
router.get('/overlay/mvp/show', (req, res) => {
  state.mplfsScene.activeFeature = 'mvp';
  state.overlayClients.forEach(c => { try { c.write('event: mvp\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/mvp/hide
router.get('/overlay/mvp/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: mvp\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/potm/show — Player of the Match (same scene as the MCT MVP, POTM title)
router.get('/overlay/potm/show', (req, res) => {
  state.mplfsScene.activeFeature = 'potm';
  state.overlayClients.forEach(c => { try { c.write('event: potm\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/potm/hide
router.get('/overlay/potm/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: potm\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/credits/show
router.get('/overlay/credits/show', (req, res) => {
  state.mplfsScene.activeFeature = 'credits';
  state.overlayClients.forEach(c => { try { c.write('event: credits\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/credits/hide
router.get('/overlay/credits/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: credits\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});









// GET /overlay/tomorrow_schedule/show
router.get('/overlay/tomorrow_schedule/show', (req, res) => {
  state.mplfsScene.activeFeature = 'tomorrow';
  state.overlayClients.forEach(c => { try { c.write('event: tomorrow_schedule\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/tomorrow_schedule/hide
router.get('/overlay/tomorrow_schedule/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: tomorrow_schedule\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});



// GET /overlay/fs/debugoff
router.get('/overlay/fs/debugoff', (req, res) => {
  state.overlayClients.forEach(c => { try { c.write('event: fs_debugoff\ndata: {}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true });
});

// GET /overlay/matchboard/show
router.get('/overlay/matchboard/show', (req, res) => {
  state.mplfsScene.matchboard = true;
  state.overlayClients.forEach(c => { try { c.write('event: matchboard\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/matchboard/hide
router.get('/overlay/matchboard/hide', (req, res) => {
  state.mplfsScene.matchboard = false;
  state.overlayClients.forEach(c => { try { c.write('event: matchboard\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/playerboard/show
router.get('/overlay/playerboard/show', (req, res) => {
  state.mplfsScene.playerboard = true;
  state.overlayClients.forEach(c => { try { c.write('event: playerboard\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/playerboard/hide
router.get('/overlay/playerboard/hide', (req, res) => {
  state.mplfsScene.playerboard = false;
  state.overlayClients.forEach(c => { try { c.write('event: playerboard\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/middleboard/show
router.get('/overlay/middleboard/show', (req, res) => {
  state.mplfsScene.middleboard = true;
  state.overlayClients.forEach(c => { try { c.write('event: middleboard\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/middleboard/hide
router.get('/overlay/middleboard/hide', (req, res) => {
  state.mplfsScene.middleboard = false;
  state.overlayClients.forEach(c => { try { c.write('event: middleboard\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/fs/hide
router.get('/overlay/fs/hide', (req, res) => {
  state.mplfsScene = { matchboard: false, middleboard: false, playerboard: false, activeFeature: null };
  state.overlayClients.forEach(c => {
    try {
      c.write('event: matchboard\ndata: {"action":"hide"}\n\n');
      c.write('event: middleboard\ndata: {"action":"hide"}\n\n');
      c.write('event: playerboard\ndata: {"action":"hide"}\n\n');
      c.write('event: fs_hide\ndata: {}\n\n');
    } catch {}
  });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true });
});

// GET /overlay/mplfs-scene — current mplfs display state for restore-on-load
router.get('/overlay/mplfs-scene', (req, res) => {
  res.set({ 'Cache-Control': 'no-store' }).json(state.mplfsScene);
});

// GET /overlay/post_itemline/itemin
router.get('/overlay/post_itemline/itemin', (req, res) => {
  state.overlayClients.forEach(c => { try { c.write('event: post_itemline_itemin\ndata: {}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true });
});

// GET /overlay/post_itemline/itemout
router.get('/overlay/post_itemline/itemout', (req, res) => {
  state.overlayClients.forEach(c => { try { c.write('event: post_itemline_itemout\ndata: {}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true });
});

// GET /overlay/post_itemline/show
router.get('/overlay/post_itemline/show', (req, res) => {
  state.mplfsScene.matchboard = true;
  state.mplfsScene.activeFeature = 'itemline';
  state.overlayClients.forEach(c => {
    try {
      c.write('event: matchboard\ndata: {"action":"show"}\n\n');
      c.write('event: post_itemline\ndata: {"action":"show"}\n\n');
    } catch {}
  });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/post_itemline/hide
router.get('/overlay/post_itemline/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: post_itemline\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/post_emblems/show
router.get('/overlay/post_emblems/show', (req, res) => {
  // MCT theme: Post Emblem is "Post Game Emblem" on its own top bar — no Matchboard/Middleboard/Playerboard (broadcasting them made the
  // M8 boards flash in for a moment before the MCT scene's teardown hid them again).
  const mct = require('../lib/theme').getTheme() === 'mct';
  if (!mct) {
    state.mplfsScene.matchboard = true;
    state.mplfsScene.middleboard = true;
    state.mplfsScene.playerboard = true;
  }
  state.mplfsScene.activeFeature = 'emblems';
  state.overlayClients.forEach(c => {
    try {
      if (!mct) {
        c.write('event: matchboard\ndata: {"action":"show"}\n\n');
        c.write('event: middleboard\ndata: {"action":"show"}\n\n');
        c.write('event: playerboard\ndata: {"action":"show"}\n\n');
      }
      c.write('event: post_emblems\ndata: {"action":"show"}\n\n');
    } catch {}
  });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/post_emblems/hide
router.get('/overlay/post_emblems/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: post_emblems\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/post_items/show
router.get('/overlay/post_items/show', (req, res) => {
  state.mplfsScene.matchboard = true;
  state.mplfsScene.middleboard = true;
  state.mplfsScene.playerboard = true;
  state.mplfsScene.activeFeature = 'items';
  state.overlayClients.forEach(c => {
    try {
      c.write('event: matchboard\ndata: {"action":"show"}\n\n');
      c.write('event: middleboard\ndata: {"action":"show"}\n\n');
      c.write('event: playerboard\ndata: {"action":"show"}\n\n');
      c.write('event: post_items\ndata: {"action":"show"}\n\n');
    } catch {}
  });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/post_items/hide
router.get('/overlay/post_items/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: post_items\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/post_stats/show
router.get('/overlay/post_stats/show', (req, res) => {
  const mct = require('../lib/theme').getTheme() === 'mct';   // MCT: "Post Game Stats" on its own top bar — no boards (see post_emblems)
  if (!mct) {
    state.mplfsScene.matchboard = true;
    state.mplfsScene.middleboard = true;
    state.mplfsScene.playerboard = true;
  }
  state.mplfsScene.activeFeature = 'stats';
  state.overlayClients.forEach(c => {
    try {
      if (!mct) {
        c.write('event: matchboard\ndata: {"action":"show"}\n\n');
        c.write('event: middleboard\ndata: {"action":"show"}\n\n');
        c.write('event: playerboard\ndata: {"action":"show"}\n\n');
      }
      c.write('event: post_stats\ndata: {"action":"show"}\n\n');
    } catch {}
  });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/post_stats/hide
router.get('/overlay/post_stats/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: post_stats\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/post_heatmap/show
router.get('/overlay/post_heatmap/show', (req, res) => {
  state.mplfsScene.activeFeature = 'heatmap';
  // Post Heatmap is now an MVP-Highlights-style full-screen scene (its own
  // plaque/photo layout, not a Post-family board scene) — no matchboard,
  // same as highlights/show above. postgame.html's own transitionTo() no
  // longer has 'heatmap' in POST_FEATURES, so its transitionToImpl 'else'
  // branch actively hides matchboard/middleboard/playerboard on the
  // client side; this route must not fight that by forcing matchboard
  // back on server-side.
  state.overlayClients.forEach(c => {
    try { c.write('event: post_heatmap\ndata: {"action":"show"}\n\n'); } catch {}
  });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/post_heatmap/hide
router.get('/overlay/post_heatmap/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: post_heatmap\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/post_h2h/show
router.get('/overlay/post_h2h/show', (req, res) => {
  state.mplfsScene.activeFeature = 'post_h2h';
  // Post H2H is its own full-bleed two-card scene (own header/sponsor
  // loop, no shared middleboard/playerboard) — postgame.html's transitionTo()
  // special-cases 'post_h2h' the same way it does 'post4key', actively
  // hiding matchboard/middleboard/playerboard client-side, so this route
  // must not force any of them back on server-side.
  state.overlayClients.forEach(c => {
    try { c.write('event: post_h2h\ndata: {"action":"show"}\n\n'); } catch {}
  });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/post_h2h/hide
router.get('/overlay/post_h2h/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: post_h2h\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/post_carry/show
router.get('/overlay/post_carry/show', (req, res) => {
  state.mplfsScene.activeFeature = 'post_carry';
  // Post Carry is its own full-bleed Visa-branded card+donut scene (own
  // player card, own header banner) — same deal as post_heatmap/highlights
  // above, NOT a Post-family board scene. postgame.html's transitionTo() does
  // not have 'post_carry' in POST_FEATURES, so its transitionToImpl 'else'
  // branch actively hides matchboard/middleboard/playerboard client-side;
  // this route must not fight that by forcing any of them back on here.
  state.overlayClients.forEach(c => {
    try { c.write('event: post_carry\ndata: {"action":"show"}\n\n'); } catch {}
  });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/post_carry/hide
router.get('/overlay/post_carry/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: post_carry\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/consolidated_post/show
router.get('/overlay/consolidated_post/show', (req, res) => {
  state.mplfsScene.matchboard = true;
  state.mplfsScene.activeFeature = 'consolidated_post';
  // Deliberately do NOT also broadcast a standalone 'matchboard' event here.
  // postgame.html has its own independent 'matchboard' SSE listener (for the
  // Control tab's standalone Matchboard toggle) that calls showMatchBoard()
  // directly with no idea cp-compact is about to be applied — broadcasting
  // it here raced against showConsolidatedPost()'s own properly-sequenced
  // internal showMatchBoard() call, so the board would animate in at its
  // normal (non-compact) position first, then jump 36px once
  // showConsolidatedPost() finally added cp-compact. The dashboard's own
  // Matchboard toggle indicator still stays in sync without this broadcast:
  // it refetches the full /overlay/mplfs-scene snapshot (which includes
  // this matchboard flag) off the 'consolidated_post' event alone.
  state.overlayClients.forEach(c => {
    try {
      c.write('event: consolidated_post\ndata: {"action":"show"}\n\n');
    } catch {}
  });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/consolidated_post/hide
router.get('/overlay/consolidated_post/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: consolidated_post\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/consolidated_post_2/show
router.get('/overlay/consolidated_post_2/show', (req, res) => {
  state.mplfsScene.matchboard = true;
  state.mplfsScene.activeFeature = 'consolidated_post_2';
  // Same reasoning as consolidated_post/show above: no standalone
  // 'matchboard' broadcast — showConsolidatedPost2() sequences the
  // cp-compact class itself before its own showMatchBoard() call.
  state.overlayClients.forEach(c => {
    try { c.write('event: consolidated_post_2\ndata: {"action":"show"}\n\n'); } catch {}
  });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/consolidated_post_2/hide
router.get('/overlay/consolidated_post_2/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: consolidated_post_2\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/cp2-page — current page (1, 2 or 3) for restore-on-load, same
// idea as /overlay/check-overlays.
router.get('/overlay/cp2-page', (req, res) => {
  res.set({ 'Cache-Control': 'no-store' }).json({ page: state.cp2Page });
});

// GET /overlay/p2hpage/1 and /2 — flip Post H2H between its role stats (1)
// and the gold-distribution page (2). GET /overlay/p2hpage (no arg) reads it.
router.get('/overlay/p2hpage', (req, res) => {
  res.set({ 'Cache-Control': 'no-store' }).json({ page: state.p2hPage });
});
router.get('/overlay/p2hpage/:page', (req, res) => {
  const page = req.params.page === '2' ? 2 : 1;
  state.p2hPage = page;
  state.overlayClients.forEach(c => { try { c.write(`event: p2hpage\ndata: {"page":${page}}\n\n`); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, page });
});

// GET /overlay/cp2page/1, /2 and /3 — flip Consolidated Post 2 between
// Runes/Items (1), Damage Dealt/Taken (2) and Average/Peak/Clash BPM (3),
// scene-wide across all 10 rows.
router.get('/overlay/cp2page/:page', (req, res) => {
  const page = req.params.page === '2' ? 2 : req.params.page === '3' ? 3 : 1;
  state.cp2Page = page;
  state.overlayClients.forEach(c => { try { c.write(`event: cp2page\ndata: {"page":${page}}\n\n`); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, page });
});

// GET /overlay/post4key/show
router.get('/overlay/post4key/show', (req, res) => {
  state.mplfsScene.matchboard = true;
  state.mplfsScene.activeFeature = 'post4key';
  // Same reasoning as consolidated_post/show above: no standalone
  // 'matchboard' broadcast — postgame.html's own transitionTo() already
  // calls showMatchBoard() internally, and the dashboard's Matchboard
  // toggle stays in sync via the /overlay/mplfs-scene refetch triggered
  // off the 'post4key' event alone.
  state.overlayClients.forEach(c => {
    try { c.write('event: post4key\ndata: {"action":"show"}\n\n'); } catch {}
  });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/post4key/hide
router.get('/overlay/post4key/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: post4key\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/post_golddistri/show — Post Gold Distribution (postgame.html).
// Same board handling as post4key: matchboard shows, middle/player boards are
// hidden client-side by transitionTo().
router.get('/overlay/post_golddistri/show', (req, res) => {
  state.mplfsScene.matchboard = true;
  state.mplfsScene.activeFeature = 'golddistri';
  state.overlayClients.forEach(c => {
    try { c.write('event: post_golddistri\ndata: {"action":"show"}\n\n'); } catch {}
  });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/post_golddistri/hide
router.get('/overlay/post_golddistri/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: post_golddistri\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/post_goldgraph/show — Post Gold Graph (postgame.html): full-screen gold curve + both teams' summaries
// (its own header, no matchboard — same board handling as post_heatmap: the page's transitionTo() hides the boards).
router.get('/overlay/post_goldgraph/show', (req, res) => {
  state.mplfsScene.activeFeature = 'goldgraph';
  state.overlayClients.forEach(c => {
    try { c.write('event: post_goldgraph\ndata: {"action":"show"}\n\n'); } catch {}
  });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/post_goldgraph/hide
router.get('/overlay/post_goldgraph/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: post_goldgraph\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/post_killevents/show — Post Kill Events (postgame.html). Same board
// handling as post4key / post_golddistri.
router.get('/overlay/post_killevents/show', (req, res) => {
  state.mplfsScene.matchboard = true;
  state.mplfsScene.activeFeature = 'killevents';
  state.overlayClients.forEach(c => {
    try { c.write('event: post_killevents\ndata: {"action":"show"}\n\n'); } catch {}
  });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/post_killevents/hide
router.get('/overlay/post_killevents/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: post_killevents\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});



// Draft.html — Map Detail. No `type` param — the TEXT shown is driven by
// whatever map Draft.html's own /match/state poll has as the currently
// selected map (Flying Cloud / Golden Turret / Healing Turtle / Revealing
// Wisp); for any other map, 'show' is a no-op client-side. Server side is
// just a plain show/hide.


// GET /overlay/debugoff — hide debug bars on all overlays
router.get('/overlay/debugoff', (req, res) => {
  state.overlayClients.forEach(c => { try { c.write('event: debugoff\ndata: {}\n\n'); } catch {} });
  res.set({ 'Cache-Control': 'no-store' }).json({ ok: true });
});

// Server mode (MAIN / REBROADCAST) — persisted by lib/serverMode.js.
const serverMode = require('../lib/serverMode');
router.get('/api/server-mode', (req, res) => {
  res.set({ 'Cache-Control': 'no-store' }).json({ mode: serverMode.getMode(), modes: serverMode.MODES });
});
router.post('/api/server-mode', (req, res) => {
  const mode = serverMode.setMode((req.body || {}).mode);
  if (!mode) return res.status(400).json({ ok: false, error: 'mode must be MAIN or REBROADCAST' });
  res.set({ 'Cache-Control': 'no-store' }).json({ ok: true, mode });
});

// GET /overlay/features — return current feature toggle states
router.get('/overlay/features', (req, res) => {
  res.set({ 'Cache-Control': 'no-store' }).json(state.featureToggles);
});

// GET /overlay/feature/:feature/enable|disable
// Feature toggles survive a server restart: loaded from data/feature_toggles.json at startup (merged over the defaults in
// lib/state.js — only known keys, so a removed feature can't linger) and rewritten on every change.
const FEATURE_TOGGLES_FILE = require('path').join(__dirname, '..', 'data', 'feature_toggles.json');
try {
  const saved = JSON.parse(require('fs').readFileSync(FEATURE_TOGGLES_FILE, 'utf8'));
  for (const k of Object.keys(state.featureToggles)) if (typeof saved[k] === 'boolean') state.featureToggles[k] = saved[k];
} catch (e) { /* no saved file yet — defaults */ }
function saveFeatureToggles() {
  try { require('fs').writeFileSync(FEATURE_TOGGLES_FILE, JSON.stringify(state.featureToggles, null, 2)); } catch (e) { console.warn('[feature toggles] save failed:', e.message); }
}
const VALID_FEATURES = ['killevents','items','skypiercer','lordadv','trinity','swap','lvl15','lvl4','conceal','fights','objectivespawn','stolengold','debugphotos','credits_v2','mvp_v2','hl_v2','ggc_v2'];
router.get('/overlay/feature/:feature/:action', (req, res) => {
  const { feature, action } = req.params;
  if (!VALID_FEATURES.includes(feature) || !['enable','disable'].includes(action)) {
    return res.status(400).json({ ok: false, error: 'unknown feature or action' });
  }
  const enabled = action === 'enable';
  state.featureToggles[feature] = enabled;
  saveFeatureToggles();
  const payload = JSON.stringify({ feature, enabled });
  state.overlayClients.forEach(c => { try { c.write(`event: featuretoggle\ndata: ${payload}\n\n`); } catch {} });
  res.set({ 'Cache-Control': 'no-store' }).json({ ok: true, feature, enabled });
});

// GET /overlay/stolengold/show
router.get('/overlay/stolengold/show', (req, res) => {
  state.checkOverlays.stolengold = true;
  state.overlayClients.forEach(c => { try { c.write('event: stolengold\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/stolengold/hide
router.get('/overlay/stolengold/hide', (req, res) => {
  state.checkOverlays.stolengold = false;
  state.overlayClients.forEach(c => { try { c.write('event: stolengold\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/killevent — broadcast a kill event video to all overlays
const KILL_EVENT_PRIORITIES = {
  'firstblood.webm': 1, 'doublekill.webm': 2, 'triplekill.webm': 3,
  'maniac.webm': 4, 'savage.webm': 5,
  'lordslain.webm': 1, 'turtleslain.webm': 1, 'wipedout.webm': 3,
  'lordsteal.webm': 1, 'turtlesteal.webm': 1, 'perfectturtle.webm': 1, 'perfectlord.webm': 1,
};
router.get('/overlay/killevent', (req, res) => {
  const video = req.query.video;
  if (!video || !KILL_EVENT_PRIORITIES[video]) {
    return res.status(400).json({ ok: false, error: 'unknown video' });
  }
  const priority = KILL_EVENT_PRIORITIES[video];
  const playerName = req.query.playerName ? String(req.query.playerName) : null;
  const roleNum = parseInt(req.query.role, 10);
  const role = roleNum >= 1 && roleNum <= 5 ? roleNum : null;
  const camp = req.query.camp === 'red' || req.query.camp === 'blue' ? req.query.camp : null;
  // Manual-test-only override for Wipe Out's team logo (10th Anniversary) —
  // lets the dashboard's Random Test pick any team's tricode directly,
  // instead of being limited to whichever two teams the live match data
  // (camp_list) currently has loaded. Real live-detected wipeouts (see
  // broadcastKillEvent in lib/pollers.js) never send this — they resolve
  // the logo from the live camp on the overlay page itself.
  const teamTricode = req.query.teamTricode ? String(req.query.teamTricode).toUpperCase().trim() : null;
  const payload = JSON.stringify({ video, priority, playerIdx: null, playerName, role, camp, teamTricode });
  state.overlayClients.forEach(c => { try { c.write(`event: killevent\ndata: ${payload}\n\n`); } catch {} });
  res.set({ 'Cache-Control': 'no-store' }).json({ ok: true, video, playerName, role, camp, teamTricode });
});





// GET/POST /overlay/:slot — generic show/hide slot handler (must be LAST)
router.all('/overlay/:slot', (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const slot = req.params.slot.replace(/\/+$/, '');
  if (slot === "hide") {
    state.overlayClients.forEach(c => { try { c.write('event: hide\ndata: {}\n\n'); } catch {} });
  } else {
    const msg = `event: show\ndata: ${JSON.stringify({ slot })}\n\n`;
    state.overlayClients.forEach(c => { try { c.write(msg); } catch {} });
  }
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: slot === "hide" ? "hide" : "show", slot });
});

module.exports = router;
