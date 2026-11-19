/* ── Level 15 debug buttons ── */
for (let i = 1; i <= 10; i++) {
  buildLvl15Overlay(i);
  const btn = document.createElement('button');
  btn.className = 'debug-btn'; btn.dataset.player = i; btn.textContent = `▶ P${i}`;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const data    = lastData || await fetchData();
      const r       = getPlayerArranged(data, i);
      const timeStr = r?.player?.level_eta || '--:--';
      const heroId  = r?.player?.heroid;
      triggerLvl15(i, timeStr, heroId);
    }
    catch { triggerLvl15(i, '--:--'); }
  });
  document.getElementById(i <= 5 ? 'team-left' : 'team-right').appendChild(btn);
}

/* ── Level 4 debug buttons ── */
for (let i = 1; i <= 10; i++) {
  buildLvl4Overlay(i);
  const btn = document.createElement('button');
  btn.className = 'debug-btn'; btn.dataset.lvl4 = i; btn.textContent = `▶ P${i}`;
  btn.addEventListener('click', async () => {
    try {
      const data = lastData || await fetchData();
      const r = getPlayerArranged(data, i);
      triggerLvl4(i, r?.player?.name || 'PLAYER');
    } catch { triggerLvl4(i, 'PLAYER'); }
  });
  document.getElementById(i <= 5 ? 'lvl4-team-left' : 'lvl4-team-right').appendChild(btn);
}

/* ── T3 item browser ── */
var t3BrowserBuilt = false;
function buildT3Browser() {
  if (t3BrowserBuilt) return;
  t3BrowserBuilt = true;
  const browser = document.getElementById('t3-browser');
  const savedId = localStorage.getItem('selectedT3Id') || Object.keys(T3_RECIPES)[0];
  Object.keys(T3_RECIPES).forEach(id => {
    const cell = document.createElement('div');
    cell.className = 't3-cell';
    cell.dataset.id = id;
    const img = document.createElement('img');
    img.src = `assets/game/items/${id}.png`;
    img.onerror = () => { img.onerror = null; img.src = `assets/game/items/99999.png`; };
    const lbl = document.createElement('span');
    lbl.textContent = id;
    cell.appendChild(img);
    cell.appendChild(lbl);
    cell.addEventListener('click', () => {
      if (selectedT3Cell) selectedT3Cell.classList.remove('selected');
      selectedT3Cell = cell;
      cell.classList.add('selected');
      localStorage.setItem('selectedT3Id', id);
    });
    if (id === savedId) {
      cell.classList.add('selected');
      selectedT3Cell = cell;
    }
    browser.appendChild(cell);
  });
}

for (let i = 1; i <= 10; i++) {
  buildItemOverlay(i);
  const btn = document.createElement('button');
  btn.className = 'debug-btn item-debug-btn';
  btn.dataset.player = i;
  btn.textContent = `▶ P${i}`;
  (function(pi) {
    btn.addEventListener('click', async () => {
      const selId  = selectedT3Cell?.dataset.id || Object.keys(T3_RECIPES)[0];
      let timeStr  = '--:--';
      try {
        const data = lastData || await fetchData();
        timeStr = formatTime(data.game_time || 0);
      } catch(e) {}
      const mode = (document.getElementById('item-dbg-p2') || {}).value || 'live';
      const fake = {
        faster: { status: 'early', time: 500, fastestTime: 533, difference: 33 },
        slower: { status: 'late',  time: 539, fastestTime: 527, difference: 12 },
        none:   null,
      };
      triggerItem(pi, selId, timeStr, mode === 'live' ? undefined : fake[mode]);
    });
  })(i);
  document.getElementById(i <= 5 ? 'item-team-left' : 'item-team-right').appendChild(btn);
}

/* ── Trinity debug buttons — pick a trinity kind in the TRINITY tab, then press ▶ Pn ── */
function trinityDebugKind() { return (document.getElementById('trinity-dbg-kind') || {}).value || 'swift'; }
function detectTrinityKind(ownedT3) {   /* first kind whose three items are all owned, else null */
  const owned = new Set(ownedT3);
  return TRINITY_KIND_ORDER.find(k => TRINITY_KINDS[k].items.every(id => owned.has(id))) || null;
}
(function () {
  const sel = document.getElementById('trinity-dbg-kind');
  if (sel) TRINITY_KIND_ORDER.forEach(k => {
    const o = document.createElement('option');
    o.value = k; o.textContent = TRINITY_KINDS[k].name + ' TRINITY  (' + TRINITY_KINDS[k].items.join(' · ') + ')' + (TRINITY_KINDS[k].art ? '' : '  — placeholder art');
    sel.appendChild(o);
  });
})();
for (let i = 1; i <= 10; i++) {
  buildTrinityOverlay(i);
  const btn = document.createElement('button');
  btn.className = 'debug-btn trinity-debug-btn';
  btn.dataset.player = i;
  btn.textContent = `▶ P${i}`;
  btn.addEventListener('click', () => {
    const kind = trinityDebugKind();
    triggerTrinity(i, TRINITY_KINDS[kind].items, kind);
  });
  document.getElementById(i <= 5 ? 'trinity-team-left' : 'trinity-team-right').appendChild(btn);
}

/* Load game API URL from server */
/* The page polls the server's /api/gamedata-proxy (see overlay-core.js); the upstream Battledata URL is only
   shown here for reference. */
fetch('/api/game-url').then(r => r.json()).then(d => {
  document.getElementById('api-url-display').textContent = currentApiUrl + '  (upstream: ' + (d.url || '—') + ')';
}).catch(() => {
  document.getElementById('api-url-display').textContent = currentApiUrl;
});

/* ── Debug panel toggle (backtick key) ── */
document.addEventListener('keydown', e => {
  if (e.key === '`') document.getElementById('debug-area').classList.toggle('visible');
});

/* ── Tab switching ── */
document.getElementById('debug-tabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('visible'));
  btn.classList.add('active');
  document.getElementById(`tab-${btn.dataset.tab}`).classList.add('visible');
  if (btn.dataset.tab === 'items') buildT3Browser();
});

/* ── Conceal debug buttons ── */
buildConcealDebugButtons(4, 'left');
buildConcealDebugButtons(9, 'right');

/* ── Swap debug buttons ── */
const SWAP_DEBUG_BOUGHT = '3207';
for (let pi = 1; pi <= 10; pi++) {
  buildSwapOverlay(pi);
  (function(idx) {
    const btn = document.createElement('button');
    btn.className      = 'debug-btn swap-debug-btn';
    btn.dataset.player = idx;
    btn.textContent    = `▶ P${idx}`;
    btn.addEventListener('click', async () => {
      let soldId = '3001';
      try {
        const data = lastData || await fetchData();
        const r    = getPlayerArranged(data, idx);
        if (r) {
          const t3s = r.equipIds.filter(id => TIER3_IDS.has(id));
          if (t3s.length > 0) soldId = t3s[0];
        }
      } catch(e) {}
      triggerSwap(idx, soldId, SWAP_DEBUG_BOUGHT);
    });
    const teamDiv = idx <= 5 ? 'swap-team-left' : 'swap-team-right';
    document.getElementById(teamDiv).appendChild(btn);
  })(pi);
}

/* ── iframe test entry point (called by dashboard preview tester) ── */
window.iframeTest = async function(playerIdx, feature) {
  try {
    const data = lastData || await fetchData();
    if (!data) return;
    const r = getPlayerArranged(data, playerIdx);
    if (!r) return;
    const { player, equipIds } = r;
    const pName   = (player.name || '').toUpperCase();
    const seatNum = playerIdx <= 5 ? playerIdx : playerIdx - 5;
    const t3s     = equipIds.filter(id => TIER3_IDS.has(id));

    if (feature === 'lvl4') {
      triggerLvl4(playerIdx, player.name || 'PLAYER');
    } else if (feature === 'lvl15') {
      triggerLvl15(playerIdx, formatTime(data.game_time || 0), player.heroid);
    } else if (feature === 'item') {
      const itemId = t3s.length > 0 ? t3s[0] : Object.keys(T3_RECIPES)[0];
      triggerItem(playerIdx, itemId, formatTime(data.game_time || 0));
    } else if (feature === 'skypiercer') {
      triggerSkyPiercer(playerIdx, getSkyPiercerStack(player) || 3);
    } else if (feature === 'trinity') {
      triggerTrinity(playerIdx, TRINITY_KINDS.swift.items, 'swift');
    } else if (feature === 'swap') {
      const soldId = t3s.length > 0 ? t3s[0] : '3001';
      triggerSwap(playerIdx, soldId, SWAP_DEBUG_BOUGHT);
    } else if (feature === 'conceal') {
      const campId = playerIdx <= 5 ? 1 : 2;
      const side   = playerIdx <= 5 ? 'left' : 'right';
      const camp   = (data.camp_list || []).find(function(c) { return c.campid === campId; });
      triggerConceal(camp ? getCampRoamingCategory(camp) : 'default', side, formatTime(data.game_time || 0));
    }
  } catch(e) { console.warn('[iframeTest]', e); }
};

/* ── Unified poll handler ── */
registerPollHandler(function(data) {
  for (let pidx = 1; pidx <= 10; pidx++) {
    const result = getPlayerArranged(data, pidx);
    if (!result) continue;
    const { player, equipIds } = result;
    const prev    = prevEquipState[pidx];
    const pName   = (player.name || '').toUpperCase();
    const seatNum = pidx <= 5 ? pidx : pidx - 5;

    const dmg = parseInt(player.total_damage) || 0;
    if (prevTotalDamage[pidx] !== undefined) {
      const delta = dmg - prevTotalDamage[pidx];
      if (!combatHistory[pidx]) combatHistory[pidx] = [];
      combatHistory[pidx].push(delta > 0 ? delta : 0);
      if (combatHistory[pidx].length > 3) combatHistory[pidx].shift();
    }
    prevTotalDamage[pidx] = dmg;

    if (prev) {
      const currentT3 = equipIds.filter(id => TIER3_IDS.has(id));
      const prevT3    = prev.filter(id => TIER3_IDS.has(id));

      /* Trinity: fires when the owned T3 items newly contain all three items of a kind (TRINITY_KINDS) — once per kind per player. */
      if (featureEnabled.trinity) {
        const fired = (trinityFired[pidx] && typeof trinityFired[pidx] === 'object') ? trinityFired[pidx] : (trinityFired[pidx] = {});
        const ownedNow = new Set(currentT3), ownedPrev = new Set(prevT3);
        TRINITY_KIND_ORDER.forEach(kind => {
          const ids = TRINITY_KINDS[kind].items;
          if (fired[kind] || !ids.every(id => ownedNow.has(id)) || ids.every(id => ownedPrev.has(id))) return;
          fired[kind] = true;
          if (isAnyPlaying(pidx)) trinityQueue[pidx] = { t3ItemIds: ids, label: kind };
          else triggerTrinity(pidx, ids, kind);
        });
      }
      if (featureEnabled.items && currentT3.length === 1 && prevT3.length === 0) {
        for (let j = 0; j < 6; j++) {
          if (equipIds[j] !== prev[j] && TIER3_IDS.has(equipIds[j])) {
            const newItemId = equipIds[j];
            const timeStr   = formatTime(data.game_time || 0);
            if (isAnyPlaying(pidx)) {
              itemQueue[pidx] = { itemId: newItemId, timeStr };
            } else {
              triggerItem(pidx, newItemId, timeStr);
            }
            break;
          }
        }
      }

      const soldT3   = prevT3.filter(id => !currentT3.includes(id));
      const boughtT3 = currentT3.filter(id => !prevT3.includes(id));
      if (featureEnabled.swap && soldT3.length === 1 && boughtT3.length === 1) {
        const inCombat = combatHistory[pidx] && combatHistory[pidx].some(d => d > 0);
        if (inCombat) {
          if (isAnyPlaying(pidx)) {
            swapQueue[pidx] = { soldId: soldT3[0], boughtId: boughtT3[0] };
          } else {
            triggerSwap(pidx, soldT3[0], boughtT3[0]);
          }
        }
      }
    }
    checkSkyPiercer(pidx, player);
    prevEquipState[pidx] = [...equipIds];
  }

  for (let pidx = 1; pidx <= 10; pidx++) {
    const result = getPlayerArranged(data, pidx);
    if (!result) continue;
    const { player } = result;
    const lvl  = parseInt(player.level) || 0;
    const prev = prevLevel[pidx];
    if (featureEnabled.lvl15 && prev !== undefined && prev < 15 && lvl >= 15) {
      const timeStr = formatTime(data.game_time || 0);
      if (isAnyPlaying(pidx)) {
        lvl15Queue[pidx] = { timeStr, heroId: player.heroid };
      } else {
        triggerLvl15(pidx, timeStr, player.heroid);
      }
    }
    if (featureEnabled.lvl4 && prev !== undefined && prev < 4 && lvl >= 4) {
      if (isAnyPlaying(pidx)) {
        lvl4Queue[pidx] = { name: player.name };
      } else {
        triggerLvl4(pidx, player.name);
      }
    }
    prevLevel[pidx] = lvl;
  }

  [{ campId: 1, side: 'left', playerIdx: 4 }, { campId: 2, side: 'right', playerIdx: 9 }].forEach(({ campId, side, playerIdx }) => {
    const camp = (data.camp_list || []).find(c => c.campid === campId);
    if (!camp) return;
    const bg   = camp.blessing_gold || 0;
    const prev = prevBlessingGold[side];
    if (featureEnabled.conceal && prev !== undefined && prev < 1000 && bg >= 1000) {
      const cat     = getCampRoamingCategory(camp);
      const timeStr = formatTime(data.game_time || 0);
      if (isAnyPlaying(playerIdx)) { concealQueue[side] = { cat, timeStr }; }
      else { triggerConceal(cat, side, timeStr); }
    }
    prevBlessingGold[side] = bg;
  });
});

/* ── Kill events debug buttons ── */
const KILL_DEBUG_BTNS = [
  { label: 'FIRST BLOOD',  video: 'firstblood.webm',  priority: 1 },
  { label: 'DOUBLE KILL',  video: 'doublekill.webm',  priority: 2 },
  { label: 'TRIPLE KILL',  video: 'triplekill.webm',  priority: 3 },
  { label: 'MANIAC',       video: 'maniac.webm',      priority: 4 },
  { label: 'SAVAGE',       video: 'savage.webm',      priority: 5 },
  { label: 'LORD SLAIN',   video: 'lordslain.webm',   priority: 1 },
  { label: 'TURTLE SLAIN', video: 'turtleslain.webm', priority: 1 },
  { label: 'WIPE OUT',     video: 'wipedout.webm',    priority: 3 },
];
const killBtnRow = document.getElementById('kill-event-btns');
KILL_DEBUG_BTNS.forEach(({ label, video, priority }) => {
  const btn = document.createElement('button');
  btn.className = 'debug-btn';
  btn.textContent = `▶ ${label}`;
  btn.addEventListener('click', () => enqueueKillEvent(video, priority, null, null));
  killBtnRow.appendChild(btn);
});

/* ── Objective spawn debug buttons ── */
const OBJ_SPAWN_DEBUG_BTNS = [
  { label: 'LORD SPAWN',   kind: 'lord'   },
  { label: 'TURTLE SPAWN', kind: 'turtle' },
];
const objSpawnBtnRow = document.getElementById('objectivespawn-btns');
OBJ_SPAWN_DEBUG_BTNS.forEach(({ label, kind }) => {
  const btn = document.createElement('button');
  btn.className = 'debug-btn';
  btn.textContent = `▶ ${label}`;
  btn.addEventListener('click', () => objSpawnEnqueue(kind));
  objSpawnBtnRow.appendChild(btn);
});

/* ── Stolen gold debug buttons ── */
document.getElementById('stolengold-show-btn').addEventListener('click', () => sgAnimateIn());
document.getElementById('stolengold-hide-btn').addEventListener('click', () => sgAnimateOut());

/* ── Start polling ── */
/* Game API refresh rate (Settings -> Game API Refresh Rate, default 150ms) — see html/js/game-refresh.js */
if (window.GameRefresh) GameRefresh.loop(masterPoll); else { setInterval(masterPoll, 1000); masterPoll(); }

/* ── SSE — fight show/hide (instant) + debugoff ── */
(function() {
  // Backed by the shared SharedWorker (html/js/overlay-shared-worker.js) —
  // this page opens zero real connections of its own now, so having
  // several overlay browser sources/tabs open at once no longer eats into
  // the browser's shared connection pool per page. ingame.html must
  // load html/js/overlay-sse-shim.js before this file for createOverlaySSE
  // to exist.
  var sse = createOverlaySSE();
  sse.addEventListener('theme', function(ev) { applyTheme(JSON.parse(ev.data).theme); });

  /* Fired by routes/overlayStyles.js after any Edit-tab Save — force a
     hard reload so new position/size overrides apply immediately (see
     postgame.html's connectSSE() for the identical pattern). */
  sse.addEventListener('reload', function() { window.location.reload(); });

  sse.addEventListener('fights', function(e) {
    try {
      var d = JSON.parse(e.data);
      if (!featureEnabled.fights) return;
      if (d.action === 'show') {
        if (allFights.length) { debugIdx = allFights.length - 1; renderFight(allFights[debugIdx], feedData); }
        fightAnimateIn();
      }
      if (d.action === 'hide') fightAnimateOut();
    } catch {}
  });
  sse.addEventListener('killevent', function(e) {
    try {
      var d = JSON.parse(e.data);
      if (d.video) enqueueKillEvent(d.video, d.priority, d.playerIdx, d.playerName, d.role, d.camp, d.teamTricode);
    } catch {}
  });
  sse.addEventListener('featuretoggle', function(e) {
    try {
      var d = JSON.parse(e.data);
      if (d.feature in featureEnabled) featureEnabled[d.feature] = !!d.enabled;
    } catch {}
  });
  // Dashboard "Arrangement" tab (routes/devapi.js's /api/seat-arrangement)
  // — updates currentArrangement (overlay-core.js) live, then re-baselines
  // Level 15/Item Pickup/Trinity/Quick Swap so the very next poll doesn't
  // misread "a different player is now at slot i" as a real trigger. See
  // resetReactiveBaselines()'s own comment in overlay-core.js.
  sse.addEventListener('seat_arrangement', function(e) {
    try {
      var d = JSON.parse(e.data);
      if (d && d.camp1 && d.camp2) currentArrangement = d;
      resetReactiveBaselines();
    } catch {}
  });
  sse.addEventListener('scoreboard', function(e) {
    try {
      var d = JSON.parse(e.data);
      if (typeof sbHandleToggle === 'function') sbHandleToggle(d.action === 'show');
    } catch {}
  });
  sse.addEventListener('playerui', function(e) {
    try {
      var d = JSON.parse(e.data);
      if (typeof puiHandleToggle === 'function') puiHandleToggle(d.action === 'show');
    } catch {}
  });
  sse.addEventListener('debugoff', function() {
    var area = document.getElementById('debug-area');
    if (area) area.classList.remove('visible');
  });
  sse.addEventListener('itemcheck', function(e) {
    try {
      var d = JSON.parse(e.data);
      if (d.action === 'show') icAnimateIn();
      if (d.action === 'hide') icAnimateOut();
    } catch {}
  });
  sse.addEventListener('teamfightcheck', function(e) {
    try {
      var d = JSON.parse(e.data);
      if (d.action === 'show') tfcAnimateIn();
      if (d.action === 'hide') tfcAnimateOut();
    } catch {}
  });
  sse.addEventListener('stolengold', function(e) {
    try {
      var d = JSON.parse(e.data);
      if (d.action === 'show') sgAnimateIn();
      if (d.action === 'hide') sgAnimateOut();
    } catch {}
  });
  sse.addEventListener('emblemcheck', function(e) {
    try {
      var d = JSON.parse(e.data);
      if (d.action === 'show') eccAnimateIn();
      if (d.action === 'hide') eccAnimateOut();
    } catch {}
  });
  sse.addEventListener('golddiffcheck', function(e) {
    try {
      var d = JSON.parse(e.data);
      if (d.action === 'show') gdcAnimateIn();
      if (d.action === 'hide') gdcAnimateOut();
    } catch {}
  });
  sse.addEventListener('goldgraphcheck', function(e) {
    try {
      var d = JSON.parse(e.data);
      if (d.action === 'show') ggcAnimateIn();
      if (d.action === 'hide') ggcAnimateOut();
    } catch {}
  });
  sse.addEventListener('livewinrate', function(e) {
    try {
      var d = JSON.parse(e.data);
      if (d.action === 'show') lwrAnimateIn();
      if (d.action === 'hide') lwrAnimateOut();
    } catch {}
  });
  sse.addEventListener('bpmmeter', function(e) {
    try {
      var d = JSON.parse(e.data);
      if (d.action === 'show') bpmmeterAnimateIn();
      if (d.action === 'hide') bpmmeterAnimateOut();
    } catch {}
  });
  // BPM meter level nudges — separate from the show/hide event above,
  // kept as the pre-existing /meter/plus|minus|clear routes/event.
  sse.addEventListener('meter', function(e) {
    try {
      var d = JSON.parse(e.data);
      if (d.cmd === 'plus')  bpmmeterPressPlus();
      if (d.cmd === 'minus') bpmmeterPressMinus();
      if (d.cmd === 'clear') bpmmeterPressClear();
    } catch {}
  });
  /* Shared by every "side *check" ranking panel — one SSE event
     ('sidecheck') carries a `check` field naming which panel, instead
     of a dedicated event per panel. Add new side-checks here. */
  var SIDE_CHECK_HANDLERS = {
    sideexpcheck:    { in: function () { secAnimateIn(); }, out: function () { secAnimateOut(); } },
    sidetakencheck:  { in: function () { stcAnimateIn(); }, out: function () { stcAnimateOut(); } },
    sidedamagecheck: { in: function () { sdcAnimateIn(); }, out: function () { sdcAnimateOut(); } },
    sidegoldcheck:   { in: function () { sgcAnimateIn(); }, out: function () { sgcAnimateOut(); } },
    sidegolddistricheck: { in: function () { sgdcAnimateIn(); }, out: function () { sgdcAnimateOut(); } },
    sidekdadistricheck:  { in: function () { skdcAnimateIn(); }, out: function () { skdcAnimateOut(); } },
  };
  sse.addEventListener('sidecheck', function(e) {
    try {
      var d = JSON.parse(e.data);
      var h = SIDE_CHECK_HANDLERS[d.check];
      if (!h) return;
      if (d.action === 'show') h.in();
      if (d.action === 'hide') h.out();
    } catch {}
  });
})();
