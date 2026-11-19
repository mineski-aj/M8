/* ── Trinity "eventer" overlay — M8 art ──
   assets/overlay/M8/Ingame/m8_trinitybox.png (387x106): three item rings on the left, title on the right, flat edge on the right.
   Away players use it as-is (flush with the right screen edge); home players get the box mirrored (flat edge on the left) with the
   rings and title re-placed so nothing but the backing is flipped. Title art: m8_swift.png (138x61). Kinds that have no art yet
   show a text placeholder in the same spot — drop in assets/overlay/M8/Ingame/m8_<kind>.png and set `art` below.
   Opaque band y 6..98, so the card sits 7px above the player card (edges line up), covering it and sliding in from the outer edge. */
/* MCT (data-theme-name="mct"): mct_trinitybacker.png (388x90, rings baked in) is the HOME art (flat edge left); away = flipped. Title is two lines of
   text (kind name / "TRINITY") in Tandelle Bold, centred in the left 168px; the card sits exactly on the player-card slot (top 345 + 90n). */
const TRN_MCT = document.documentElement.getAttribute('data-theme-name') === 'mct';
const TRN_W = TRN_MCT ? 388 : 387, TRN_H = TRN_MCT ? 90 : 106, TRN_TOP_OFFSET = TRN_MCT ? 0 : 7, TRN_TOP_BASE = TRN_MCT ? 345 : 346;
const TRN_RING_CX = TRN_MCT ? [200, 269, 337] : [47.5, 115.5, 182.5];   /* the un-flipped art layout, measured off the art */
const TRN_RING_CY = TRN_MCT ? 44.5 : 56, TRN_ICON_D = 60;
const TRN_TITLE_LEFT = TRN_MCT ? 0 : 229, TRN_TITLE_W = TRN_MCT ? 168 : 138, TRN_TITLE_H = TRN_MCT ? 86 : 61, TRN_TITLE_TOP = TRN_MCT ? 2 : 22;
/* fit the two title lines (never measured while hidden — call after the clip is display:block) */
function trnFitMctTitle(ph) {
  ph.querySelectorAll('span').forEach(function (sp) {
    sp.style.fontSize = '';
    const w = sp.offsetWidth, max = 150;
    if (w > max) sp.style.fontSize = (44.5 * max / w) + 'px';
  });
}

/* Trinity kinds. A trinity fires when a player's owned Tier-3 items newly contain ALL THREE items of a kind. Anything else = no event. */
const TRINITY_KINDS = {
  swift:     { name: 'SWIFT',     items: ['2008', '2009', '2006'], art: 'm8_swift.png' },
  magic:     { name: 'MAGIC',     items: ['3110', '3102', '3101'], art: null },
  physical:  { name: 'PHYSICAL',  items: ['3009', '3001', '3008'], art: null },
  lifesteal: { name: 'LIFESTEAL', items: ['2013', '3004', '2208'], art: null },
  critical:  { name: 'CRITICAL',  items: ['3005', '3003', '3002'], art: null },
  hybrid:    { name: 'HYBRID',    items: ['2013', '2208', '3204'], art: null },
};
const TRINITY_KIND_ORDER = Object.keys(TRINITY_KINDS);

function buildTrinityOverlay(i) {
  const side = i <= 5 ? 'home' : 'away';
  const pos  = i <= 5 ? i - 1 : i - 6;
  const flip = TRN_MCT ? side === 'away' : side === 'home';

  const clip = document.createElement('div');
  clip.className = 'trn2-clip ' + side;
  clip.id = `trinity-evt-${i}`;
  clip.style.left = (side === 'home' ? 0 : 1920 - TRN_W) + 'px';
  clip.style.top  = (TRN_TOP_BASE + pos * 90 - TRN_TOP_OFFSET) + 'px';

  const card = document.createElement('div');
  card.className = 'trn2-card';

  const bg = document.createElement('img');
  bg.className = 'trn2-bg' + (flip ? ' flip' : '');
  bg.src = 'assets/overlay/M8/Ingame/' + (TRN_MCT ? 'mct_trinitybacker.png' : 'm8_trinitybox.png');
  bg.alt = '';
  card.appendChild(bg);

  const titleLeft = flip ? TRN_W - TRN_TITLE_LEFT - TRN_TITLE_W : TRN_TITLE_LEFT;
  const titleImg = document.createElement('img');
  titleImg.className = 'trn2-title-img';
  titleImg.alt = '';
  titleImg.style.cssText = `left:${titleLeft}px;top:${TRN_TITLE_TOP}px;width:${TRN_TITLE_W}px;height:${TRN_TITLE_H}px;`;
  card.appendChild(titleImg);

  /* placeholder for kinds without art */
  const ph = document.createElement('div');
  ph.className = 'trn2-title-ph';
  ph.style.cssText = `left:${titleLeft}px;top:${TRN_TITLE_TOP}px;width:${TRN_TITLE_W}px;height:${TRN_TITLE_H}px;`;
  const phKind = document.createElement('span'); phKind.className = 'trn2-ph-kind';
  const phSub  = document.createElement('span'); phSub.className = 'trn2-ph-sub'; phSub.textContent = 'TRINITY';
  ph.appendChild(phKind); ph.appendChild(phSub);
  card.appendChild(ph);

  const items = TRN_RING_CX.map((cx, idx) => {
    /* reading order is always left -> right: home is mirrored, so its first item takes the mirrored LAST ring */
    const centre = flip ? TRN_W - TRN_RING_CX[TRN_RING_CX.length - 1 - idx] : cx;
    const itemBox = document.createElement('div');
    itemBox.className = 'trn2-item';
    itemBox.style.left = (centre - TRN_ICON_D / 2) + 'px';
    itemBox.style.top  = (TRN_RING_CY - TRN_ICON_D / 2) + 'px';
    const itemIcon = document.createElement('img');
    itemIcon.className = 'trn2-icon';
    itemIcon.alt = '';
    const sheen = document.createElement('div');
    sheen.className = 'evt-sheen';
    itemBox.appendChild(itemIcon);
    itemBox.appendChild(sheen);
    card.appendChild(itemBox);
    return { itemIcon, sheen };
  });

  clip.appendChild(card);
  document.getElementById('scene').insertBefore(clip, document.getElementById('player-ui-overlay'));

  trinityRefs[i] = { clip, items, titleImg, ph, phKind };
}

function resetTrinity(i) {
  const { clip, items } = trinityRefs[i];
  clip.classList.remove('trn2-in');
  items.forEach(({ sheen }) => sheen.classList.remove('sweep'));
}

/* core_item = { difference, fastestTime, status: 'late'|'no_data'|..., time, item_1..3 } from the game feed
   (player.extra_param.core_item or player.core_item). Returns the phase-2 view model or null (no data). */
function getCoreItem(player) {
  return (player && ((player.extra_param && player.extra_param.core_item) || player.core_item)) || null;
}
function coreItemPhase2(core) {
  if (!core || core.status === 'no_data') return null;
  const time = parseInt(core.time) || 0, fastest = parseInt(core.fastestTime) || 0;
  let diff = Math.abs(parseInt(core.difference) || 0);
  if (!time || !fastest) return null;
  if (!diff) diff = Math.abs(time - fastest);
  if (!diff) return null;
  const slower = core.status === 'late' ? true : (time > fastest);
  const m = Math.floor(time / 60), s = time % 60;
  return { timeStr: m + ':' + String(s).padStart(2, '0'), slower, text: diff + 's ' + (slower ? 'SLOWER' : 'FASTER') };
}

/* kind = key of TRINITY_KINDS. t3ItemIds = the three item ids to show (left -> right). */
function triggerTrinity(i, t3ItemIds, kind) {
  const def = TRINITY_KINDS[kind];
  if (!def) return;                              /* unknown kind -> never trigger */
  if (isPlayingTrinity[i]) return;
  isPlayingTrinity[i] = true;
  const btn = document.querySelector(`.trinity-debug-btn[data-player="${i}"]`);
  if (btn) btn.disabled = true;
  const { clip, items, titleImg, ph, phKind } = trinityRefs[i];

  let outerGuard;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(outerGuard);
    resetTrinity(i);
    clip.style.display  = 'none';
    isPlayingTrinity[i]  = false;
    if (btn) btn.disabled = false;
    playNextQueued(i);
  };
  outerGuard = setTimeout(cleanup, 4500);

  if (def.art && !TRN_MCT) { titleImg.src = 'assets/overlay/M8/Ingame/' + def.art; titleImg.style.display = ''; ph.style.display = 'none'; }
  else         { titleImg.removeAttribute('src'); titleImg.style.display = 'none'; phKind.textContent = def.name; ph.style.display = 'flex'; }

  items.forEach(({ itemIcon }, idx) => {
    itemIcon.src = t3ItemIds[idx] ? `assets/game/items/${t3ItemIds[idx]}.png` : '';
  });
  resetTrinity(i);
  clip.style.display = 'block';
  if (TRN_MCT) trnFitMctTitle(ph);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    clip.classList.add('trn2-in');
  }));

  items.forEach(({ sheen }, idx) => {
    setTimeout(() => { sheen.classList.add('sweep'); }, 400 + idx * 120);
  });

  setTimeout(() => {
    if (cleanedUp) return;
    clip.classList.remove('trn2-in');
    setTimeout(cleanup, 350);
  }, 2400);
}
