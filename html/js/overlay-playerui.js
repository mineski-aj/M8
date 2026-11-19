/* ── [FEATURE: player-ui] — M8 card (168x90). Layout lives in the CSS block in
   mploverlay_v7.css; art in assets/overlay/M8/Ingame/. 5 cards per side, 90px pitch. */
let PUI_TOPS         = [346, 436, 526, 616, 706];   /* MCT: reference cards start at y345 (set below once PUI_MCT is known) */
/* MCT (data-theme-name="mct") has its own card layout: no hero / ult / death timer; spell + emblem sit in the backer's two circles,
   level is "LV.nn" top-right, plus a gold row. Layout in the MCT PLAYER UI block of mploverlay_v7.css. */
const PUI_MCT        = document.documentElement.getAttribute('data-theme-name') === 'mct';
const PUI_NAME_MAX_W = PUI_MCT ? 94 : 76;
if (PUI_MCT) PUI_TOPS = [345, 435, 525, 615, 705];
const PUI_ART        = 'assets/overlay/M8/Ingame/';
const PUI_SPELLS     = { 20020:'Retribution', 20030:'Inspire', 20040:'Sprint', 20050:'Revitalize', 20060:'Aegis', 20070:'Petrify',
                         20080:'Purify', 20100:'Flicker', 20140:'Flameshot', 20150:'Execute', 20160:'Arrival', 20190:'Vengeance' };

const puiRefs = {};

function puiSpellUrl(id) {
  return PUI_SPELLS[id] ? 'assets/game/spell/' + id + PUI_SPELLS[id] + '.png' : null;
}

function puiFitName(el) {
  el.style.fontSize = '12px';
  if (el.scrollWidth <= PUI_NAME_MAX_W) return;
  let lo = 7, hi = 12;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    el.style.fontSize = mid + 'px';
    if (el.scrollWidth <= PUI_NAME_MAX_W) lo = mid; else hi = mid;
  }
  el.style.fontSize = lo + 'px';
}

function puiEl(tag, cls, parent) {
  const e = document.createElement(tag);
  e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

/* icon circle: fill (image or level text) + the outline ring on top */
function puiBuildIc(card, kind, fillTag) {
  const wrap = puiEl('div', 'pui-e pui-ic pui-ic-' + kind, card);
  const fill = puiEl(fillTag, 'pui-ic-fill', wrap);
  if (fillTag === 'img') fill.alt = '';
  if (kind === 'spell') puiEl('div', 'pui-cd', wrap).appendChild(document.createElement('span'));   /* cooldown shade + seconds */
  const ring = puiEl('img', 'pui-ic-ring', wrap);
  ring.src = PUI_ART + 'm8_uioutline.png';
  ring.alt = '';
  return fill;
}

function puiBuildCard(i) {
  const side    = i <= 5 ? 'home' : 'away';
  const seatIdx = i <= 5 ? i - 1 : i - 6;

  const card = puiEl('div', 'pui-card pui-' + side);
  card.style.top = PUI_TOPS[seatIdx] + 'px';

  const bg = puiEl('img', 'pui-bg', card);
  bg.src = PUI_ART + (PUI_MCT ? 'mct_uibacker.png' : 'm8_uiblue_main.png');
  bg.alt = '';

  const hero = puiEl('img', 'pui-e pui-hero', card);
  hero.alt = '';
  hero.style.visibility = 'hidden';
  hero.onload = function () { this.style.visibility = ''; };
  hero.onerror = function () { this.style.visibility = 'hidden'; };

  const rv = puiEl('div', 'pui-e pui-rv', card);          /* respawn timer over the greyed hero */
  rv.appendChild(document.createElement('span'));

  const ulti = puiEl('div', 'pui-e pui-ulti', card);
  const ultiLocked = puiEl('div', 'pui-ulti-locked', ulti);
  const ultiPie    = puiEl('div', 'pui-ulti-pie', ulti);
  const ultiReady  = puiEl('div', 'pui-ulti-ready', ulti);
  const ultiRing   = puiEl('img', 'pui-ulti-ring', ulti);
  ultiRing.src = PUI_ART + 'm8_ultioutline.png';
  ultiRing.alt = '';

  const nameOuter = puiEl('div', 'pui-e pui-name', card);
  const nameInner = document.createElement('span');
  nameOuter.appendChild(nameInner);

  const kda = puiEl('div', 'pui-e pui-kda', card);

  /* MCT only (hidden by CSS elsewhere): coin + total gold */
  const goldWrap = puiEl('div', 'pui-e pui-gold', card);
  const goldIcon = puiEl('img', 'pui-gold-icon', goldWrap);
  goldIcon.src = PUI_ART + 'mct_goldicon.png'; goldIcon.alt = '';
  const goldVal = puiEl('span', 'pui-gold-val', goldWrap);

  const emblem = puiBuildIc(card, 'emblem', 'img');
  const spell  = puiBuildIc(card, 'spell',  'img');
  const spellCd = spell.parentNode.querySelector('.pui-cd');
  const level  = puiBuildIc(card, 'level',  'div');

  const hpWrap  = puiEl('div', 'pui-e pui-hp', card);
  const hpGhost = puiEl('div', 'pui-hp-ghost', hpWrap);
  const hpFill  = puiEl('div', 'pui-hp-fill', hpWrap);

  puiRefs[i] = { goldVal, hero, rv, rvVal: -1, level, nameInner, kda, emblem, spell, spellCd, spellCdVal: -1, ultiLocked, ultiPie, ultiReady,
                 hpFill, hpGhost, hpCur: 1, hpGhostVal: 1, hpTimer: null, hpInit: false, heroId: null };
  return card;
}

/* Health bar with "ghost" damage (same behaviour as led_overlay.html's setHP): on a hit the live fill
   drops instantly, the red ghost stays at the old value, then eases down after 550ms. Heals just
   move both. scaleX(frac) on a full-width bar; origin is the outer edge (CSS). */
function puiSetHP(ref, frac) {
  frac = Math.max(0, Math.min(1, frac));
  if (ref.hpInit && Math.abs(frac - ref.hpCur) <= 0.001) return;
  ref.hpInit = true;
  if (frac < ref.hpCur - 0.001) {
    ref.hpGhostVal = Math.max(ref.hpGhostVal, ref.hpCur);
    ref.hpCur = frac;
    ref.hpFill.style.transition  = 'none';
    ref.hpFill.style.transform   = 'scaleX(' + frac + ')';
    ref.hpGhost.style.transition = 'none';
    ref.hpGhost.style.transform  = 'scaleX(' + ref.hpGhostVal + ')';
    clearTimeout(ref.hpTimer);
    ref.hpTimer = setTimeout(function () {
      ref.hpGhost.style.transition = 'transform 0.45s ease-in';
      ref.hpGhost.style.transform  = 'scaleX(' + ref.hpCur + ')';
      ref.hpGhostVal = ref.hpCur;
    }, 550);
  } else {
    ref.hpCur = ref.hpGhostVal = frac;
    clearTimeout(ref.hpTimer);
    ref.hpFill.style.transition = ref.hpGhost.style.transition = 'none';
    ref.hpFill.style.transform  = ref.hpGhost.style.transform  = 'scaleX(' + frac + ')';
  }
}

/* Ultimate cooldown max, per player index — captured the first time major_left_time is seen going
   from 0 (or unknown) to a nonzero value, or jumping above the current max. */
const puiUltiState = {};

function puiUpdateUlti(i, ref, p) {
  const level = p.level || 0;
  const mlt   = p.major_left_time;
  const st    = puiUltiState[i] || (puiUltiState[i] = { prev: null, max: null });

  if (mlt != null) {
    if (mlt > 0 && (st.prev === 0 || st.prev == null || mlt > (st.max || 0))) st.max = mlt;
    st.prev = mlt;
  }

  const isLocked = level < 4;
  const isTiming = !isLocked && mlt > 0;
  const isReady  = !isLocked && !isTiming;

  ref.ultiLocked.classList.toggle('on', isLocked);
  ref.ultiPie.classList.toggle('on', isTiming);
  ref.ultiReady.classList.toggle('on', isReady);

  if (isTiming) {
    const max = st.max || mlt;
    const remaining = max > 0 ? Math.min(1, Math.max(0, mlt / max)) : 1;
    /* dark wedge = cooldown still left (drains clockwise from 12 o'clock), green = recharged */
    const deg = remaining * 360;
    ref.ultiPie.style.background = 'conic-gradient(#171717 0deg ' + deg + 'deg, transparent ' + deg + 'deg 360deg), linear-gradient(90deg, #4cb848, #68d453)';
  }
}


/* ── Battle-spell cooldown smoothing ──
   The feed's skill_left_time is whole seconds and arrives in bursts, so showing it raw stutters. Each card keeps a local end
   time: feed value N means ~N-0.5s left, so on every feed change we aim the end time there — slewed gently (10%) when within
   1.6s, snapped beyond that; N=0 clears it at once. While the scoreboard clock is paused (game paused) the countdown freezes. */
function puiSteerSpellCd(ref, n, key) {
  key = key || 'cd';
  const st = ref[key] || (ref[key] = { end: 0, last: -1, tick: Date.now() });
  if (n === st.last) return;
  st.last = n;
  const now = Date.now();
  if (n <= 0) { st.end = 0; return; }
  const target = now + (n - 0.5) * 1000;
  if (st.end <= now) st.end = target;
  else { const err = target - st.end; st.end = Math.abs(err) > 1600 ? target : st.end + err * 0.1; }
}
function puiTickCd(ref, key, now, paused) {
  const st = ref[key] || (ref[key] = { end: 0, last: -1, tick: now });
  const dt = now - st.tick; st.tick = now;
  if (st.end && paused) st.end += dt;                       /* freeze while the game clock is paused */
  return st.end ? Math.max(1, Math.ceil((st.end - now) / 1000)) : 0;
}
setInterval(function () {
  const now = Date.now();
  const paused = typeof _sb !== 'undefined' && !_sb.running && _sb.prevApi >= 0;
  for (let i = 1; i <= 10; i++) {
    const ref = puiRefs[i];
    if (!ref || !ref.spellCd) continue;
    const secs = puiTickCd(ref, 'cd', now, paused);
    if (secs !== ref.spellCdVal) {
      ref.spellCdVal = secs;
      ref.spellCd.classList.toggle('on', secs > 0);
      ref.spellCd.firstChild.textContent = secs > 0 ? secs : '';
    }
    const rs = puiTickCd(ref, 'rv', now, paused);
    if (rs !== ref.rvVal) {
      ref.rvVal = rs;
      ref.rv.classList.toggle('on', rs > 0);
      ref.hero.classList.toggle('pui-dead', rs > 0 || ref.deadNow);
      ref.rv.firstChild.textContent = rs > 0 ? rs : '';
    }
  }
}, 100);

function puiBuildPanel() {
  const overlay = document.getElementById('player-ui-overlay');
  if (!overlay) return;
  for (let i = 1; i <= 10; i++) overlay.appendChild(puiBuildCard(i));
}
puiBuildPanel();

/* ── Show/hide with animation — cards slide in from off-screen, home
   side from the left, away side from the right (reversed to hide).
   The overlay container itself is always rendered; only the per-card
   transform (driven by the .pui-hidden class on the parent, see
   mploverlay_v7.css) moves them on/off canvas. Base CSS state (no
   class) is SHOWN, so this defaults on with no flash before the fetch
   below resolves — .pui-hidden is only added once we're told to hide. */
let puiShouldShow = true;

function puiSetShown(shown) {
  puiShouldShow = shown;
  const overlay = document.getElementById('player-ui-overlay');
  if (overlay) overlay.classList.toggle('pui-hidden', !shown);
}

/* Called from overlay-debug.js's SSE 'playerui' handler. */
function puiHandleToggle(shown) {
  puiSetShown(shown);
  if (shown && lastData) puiUpdate(lastData);
}

/* Apply real server-side shown/hidden state on load, so a (re)loaded
   overlay restores instead of guessing (see checkOverlays.playerui). */
fetch('/overlay/check-overlays').then(r => r.json()).then(d => {
  puiSetShown(!(d && d.playerui === false));
}).catch(() => puiSetShown(true));

function puiUpdate(data) {
  if (!puiShouldShow) return;
  for (let i = 1; i <= 10; i++) {
    const r   = getPlayerArranged(data, i);
    const ref = puiRefs[i];
    if (!r || !r.player || !ref) continue;
    const p = r.player;

    ref.level.textContent = p.level != null ? p.level : '';
    puiUpdateUlti(i, ref, p);

    if (PUI_MCT) ref.goldVal.textContent = p.gold != null ? Math.round(p.gold) : '';

    if (!PUI_MCT && p.heroid && ref.heroId !== p.heroid) { ref.heroId = p.heroid; ref.hero.src = heroWebUrl(p.heroid); }

    ref.nameInner.textContent = p.name || '';
    puiFitName(ref.nameInner);

    ref.kda.textContent = `${p.kill_num || 0}/${p.dead_num || 0}/${p.assist_num || 0}`;

    const frac = p.max_health_point > 0 ? (p.cur_health_point || 0) / p.max_health_point
               : (p.health_percent != null ? p.health_percent / 100 : 1);
    puiSetHP(ref, p.dead ? 0 : frac);
    ref.deadNow = !!p.dead;
    puiSteerSpellCd(ref, p.dead ? Math.max(0, Math.ceil(Number(p.revive_left_time) || 0)) : 0, 'rv');
    ref.hero.classList.toggle('pui-dead', !!p.dead || ref.rvVal > 0);

    const emblemUrl = eccRuneUrl(p.rune_map_3 || (p.rune_map || {})['3']);
    if (emblemUrl) ref.emblem.src = emblemUrl; else ref.emblem.removeAttribute('src');
    /* battle spell cooldown (feed: skill_left_time, whole seconds). Smoothed like the scoreboard clock: a local countdown
       free-runs and the feed only steers it (see puiSteerSpellCd / puiSpellCdTick). */
    puiSteerSpellCd(ref, Math.max(0, Math.ceil(Number(p.skill_left_time) || 0)));
    const spellUrl = puiSpellUrl(p.skillid);
    if (spellUrl) ref.spell.src = spellUrl; else ref.spell.removeAttribute('src');
  }
}
registerPollHandler(puiUpdate);
