/* ── [FEATURE: emblem-check] ──────────────────────────────────────
   Coordinates below are measured directly off
   assets/overlay/ingame/emblemback.png (1920×286) — see the CSS block in
   mploverlay_v7.css for the full measurement notes.

   Slot 1-5 role resolution (seat_N isn't reliably lane-ordered) is
   handled by the shared getPlayerByRole() in overlay-core.js. */
const ECC_STEP         = 160.5;
const ECC_HOME_FIRST_X = 27;
const ECC_AWAY_FIRST_X = 1749;
const ECC_NAME_MAX_W   = 105;

let eccShouldShow = false;
let eccOutTimer   = null;
const eccRefs     = {};

function eccFitName(el) {
  el.style.fontSize = '13px';
  if (el.scrollWidth <= ECC_NAME_MAX_W) return;
  let lo = 8, hi = 13;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    el.style.fontSize = mid + 'px';
    if (el.scrollWidth <= ECC_NAME_MAX_W) lo = mid; else hi = mid;
  }
  el.style.fontSize = lo + 'px';
}

function eccBuildCard(i) {
  const side    = i <= 5 ? 'home' : 'away';
  const slotIdx = i <= 5 ? i : i - 5;
  const left    = side === 'home'
    ? ECC_HOME_FIRST_X + (slotIdx - 1) * ECC_STEP
    : ECC_AWAY_FIRST_X - (slotIdx - 1) * ECC_STEP;

  const portrait = document.createElement('img');
  portrait.className = 'ecc-portrait';
  portrait.style.left = left + 'px';
  portrait.style.top  = '29px';
  portrait.alt = '';
  portrait.onerror = () => { portrait.onerror = null; portrait.removeAttribute('src'); };

  const roleIcon = document.createElement('img');
  roleIcon.className = 'ecc-role-icon';
  /* Sits near the card's own inner edge in the banner row — home
     close to the portrait's left edge (left+6), away mirrored,
     close to the portrait's right edge (left+127). */
  roleIcon.style.left = (side === 'home' ? left + 6 : left + 127) + 'px';
  roleIcon.style.top  = '118px';
  roleIcon.alt = '';
  roleIcon.src = ROLE_ICONS[slotIdx];

  const nameOuter = document.createElement('div');
  nameOuter.className = 'ecc-name ' + (side === 'home' ? 'ecc-name-home' : 'ecc-name-away');
  nameOuter.style.left = (side === 'home' ? left + 33 : left) + 'px';
  nameOuter.style.top  = '118px';
  const nameInner = document.createElement('span');
  nameOuter.appendChild(nameInner);

  const mainRune = document.createElement('img');
  mainRune.className = 'ecc-mainrune';
  mainRune.style.left = (left + 50) + 'px';
  mainRune.style.top  = '160px';
  mainRune.alt = '';
  mainRune.onerror = () => { mainRune.onerror = null; mainRune.removeAttribute('src'); };

  const SUB_X = [8, 55, 102];
  const subRunes = SUB_X.map(x => {
    const sub = document.createElement('img');
    sub.className = 'ecc-subrune';
    sub.style.left = (left + x) + 'px';
    sub.style.top  = '223px';
    sub.alt = '';
    sub.onerror = () => { sub.onerror = null; sub.removeAttribute('src'); };
    return sub;
  });

  eccRefs[i] = { portrait, nameInner, mainRune, subRunes };
  return [portrait, roleIcon, nameOuter, mainRune, ...subRunes];
}


/* ── MCT theme: Emblem panel (mct_emblembacker.png sliced into 5 rows + mct_emblemvisa.png title) ──────────
   Same construction and animation language as the MCT Item Build panel (overlay-itemcheck.js): the combined
   812x264 backer is sliced into five 812x52 rows (pitch 53) so each row animates on its own, the post hero shows
   through the backer's pure-black holes via a mask derived from the art, and only opacity/transform ever animate. */
const ECC_MCT        = document.documentElement.getAttribute('data-theme-name') === 'mct';
const ECC_MCT_DIR    = '/assets/overlay/M8/Ingame/';
const ECC_MCT_BACKER = ECC_MCT_DIR + 'mct_emblembacker.png';
const ECC_MCT_ROW_TOP = 32, ECC_MCT_ROW_PITCH = 53, ECC_MCT_W = 812, ECC_MCT_H = 264;
const ECC_MCT_CY = 26, ECC_MCT_RUNE = 40;
/* circle centres, home side; the away side is the mirror (812 - x). Order outer→inner: talents 1,2,3 then the main emblem. */
const ECC_MCT_HOME_CX = { sub: [106, 154.5, 203], main: 270 };
const ECC_MCT_PUSH = 32;                                        /* hero shift toward the outer side, see IC_MCT_HERO_PUSH */
const ECC_MCT_HERO = { home: { x: 292, w: 87 + ECC_MCT_PUSH }, away: { x: 433 - ECC_MCT_PUSH, w: 87 + ECC_MCT_PUSH } };

function eccMctBuildRow(r, maskUrl) {
  const row = document.createElement('div');
  row.className = 'ecc-mrow';
  row.style.top = (ECC_MCT_ROW_TOP + r * ECC_MCT_ROW_PITCH) + 'px';
  row.style.setProperty('--d',  (160 + r * 90) + 'ms');
  row.style.setProperty('--xd', (r * 45) + 'ms');                 /* exit: top row first */

  const bg = document.createElement('div');
  bg.className = 'ecc-mbg';
  bg.style.backgroundImage = 'url(' + ECC_MCT_BACKER + ')';
  bg.style.backgroundPosition = '0 ' + (-r * ECC_MCT_ROW_PITCH) + 'px';
  row.appendChild(bg);

  const heroBox = document.createElement('div');
  heroBox.className = 'ecc-mhero';
  heroBox.style.webkitMaskPosition = heroBox.style.maskPosition = '0 ' + (-r * ECC_MCT_ROW_PITCH) + 'px';
  if (maskUrl) heroBox.style.webkitMaskImage = heroBox.style.maskImage = 'url(' + maskUrl + ')';
  else heroBox.style.visibility = 'hidden';                       /* no mask → never show an unmasked rectangle */
  const heroes = {};
  ['home', 'away'].forEach(side => {
    const h = document.createElement('img');
    h.className = 'ecc-mhero-img ecc-mhero-' + side;
    h.style.left = ECC_MCT_HERO[side].x + 'px';
    h.style.width = ECC_MCT_HERO[side].w + 'px';
    h.alt = '';
    h.onerror = () => { h.onerror = null; h.removeAttribute('src'); };
    heroBox.appendChild(h);
    heroes[side] = h;
  });
  row.appendChild(heroBox);

  const refs = { heroes, home: {}, away: {} };
  ['home', 'away'].forEach(side => {
    const mir = x => side === 'home' ? x : ECC_MCT_W - x;
    const mk = (cx, delay) => {
      const im = document.createElement('img');
      im.className = 'ecc-mrune';
      im.style.left = (mir(cx) - ECC_MCT_RUNE / 2) + 'px';
      im.style.top  = (ECC_MCT_CY - ECC_MCT_RUNE / 2) + 'px';
      im.style.setProperty('--id', delay + 'ms');
      im.alt = '';
      im.onerror = () => { im.onerror = null; im.removeAttribute('src'); };
      row.appendChild(im);
      return im;
    };
    refs[side].main = mk(ECC_MCT_HOME_CX.main, 300);              /* nearest the hero first, then outward */
    refs[side].subs = [mk(ECC_MCT_HOME_CX.sub[0], 435), mk(ECC_MCT_HOME_CX.sub[1], 390), mk(ECC_MCT_HOME_CX.sub[2], 345)];
  });
  return { row, refs };
}

function eccMctBuildPanel(overlay) {
  const title = document.createElement('div');
  title.className = 'ecc-mtitle';
  const timg = document.createElement('img');
  timg.src = ECC_MCT_DIR + 'mct_emblemvisa.png';
  timg.alt = '';
  title.appendChild(timg);
  overlay.appendChild(title);

  /* one mask for the whole backer; each row offsets into it */
  const probe = new Image();
  const rows = [];
  for (let r = 0; r < 5; r++) {
    const b = eccMctBuildRow(r, null);
    overlay.appendChild(b.row);
    eccRefs['m' + r] = b.refs;
    rows.push(b.row);
  }
  probe.onload = () => {
    const m = icMctMask(probe);
    if (!m) return;
    rows.forEach(row => {
      const hb = row.querySelector('.ecc-mhero');
      hb.style.webkitMaskImage = hb.style.maskImage = 'url(' + m + ')';
      hb.style.visibility = '';
    });
  };
  probe.src = ECC_MCT_BACKER;
}

function eccMctUpdate(data) {
  for (let i = 1; i <= 10; i++) {
    const campId = i <= 5 ? 1 : 2, slotIdx = i <= 5 ? i : i - 5;
    const side = i <= 5 ? 'home' : 'away';
    const seat = getPlayerByRole(data, campId, slotIdx);
    const ref = eccRefs['m' + (slotIdx - 1)];
    if (!seat || !ref) continue;
    const set = (img, url) => {
      if (url) { if (img.dataset.u !== url) { img.dataset.u = url; img.src = url; } img.style.visibility = ''; }
      else { img.removeAttribute('src'); delete img.dataset.u; img.style.visibility = 'hidden'; }
    };
    const hero = ref.heroes[side];
    const hu = seat.heroid ? 'assets/hero/post/' + seat.heroid + '_POST_HERO.webp' : null;
    if (hu) { if (hero.dataset.u !== hu) { hero.dataset.u = hu; hero.src = hu; } } else { hero.removeAttribute('src'); delete hero.dataset.u; }
    set(ref[side].main, eccRuneUrl(seat.rune_id));
    const rm = seat.rune_map || {};
    [seat.rune_map_1 || rm['1'], seat.rune_map_2 || rm['2'], seat.rune_map_3 || rm['3']]
      .forEach((id, k) => set(ref[side].subs[k], eccRuneUrl(id)));
  }
}

function eccBuildPanel() {
  const overlay = document.getElementById('emblem-check-overlay');
  if (!overlay) return;
  if (ECC_MCT) { eccMctBuildPanel(overlay); return; }

  const isAnniv = document.documentElement.getAttribute('data-theme') === '10th_anniversary';
  const eccAssetDir = isAnniv ? 'assets/overlay/ingame/anniversary/' : document.documentElement.getAttribute('data-theme') === 'playoffs' ? 'assets/overlay/ingame/playoffs/' : 'assets/overlay/ingame/';

  const bg = document.createElement('img');
  bg.className = 'ecc-bg';
  bg.src = eccAssetDir + 'emblemback.png';
  bg.alt = '';
  overlay.appendChild(bg);

  const middle = document.createElement('img');
  middle.className = 'ecc-middle';
  middle.src = eccAssetDir + 'emblemmiddle.png';
  middle.alt = '';
  overlay.appendChild(middle);
  eccRefs.middle = middle;

  for (let i = 1; i <= 10; i++) {
    eccBuildCard(i).forEach(el => overlay.appendChild(el));
  }
}
eccBuildPanel();

function eccRuneUrl(id) {
  return id ? `assets/game/emblem/square_${id}_RUNES.png` : null;
}

function eccUpdate(data) {
  if (!eccShouldShow) return;
  if (ECC_MCT) { eccMctUpdate(data); return; }
  for (let i = 1; i <= 10; i++) {
    const campId  = i <= 5 ? 1 : 2;
    const slotIdx = i <= 5 ? i : i - 5;
    const seat    = getPlayerByRole(data, campId, slotIdx);
    const ref     = eccRefs[i];
    if (!seat || !ref) continue;

    if (seat.heroid) ref.portrait.src = `assets/hero/post/${seat.heroid}_POST_HERO.webp`;
    else              ref.portrait.removeAttribute('src');

    ref.nameInner.textContent = (seat.name || '').toUpperCase();
    eccFitName(ref.nameInner);

    const mainUrl = eccRuneUrl(seat.rune_id);
    if (mainUrl) ref.mainRune.src = mainUrl;
    else         ref.mainRune.removeAttribute('src');

    const rm  = seat.rune_map || {};
    const subs = [
      seat.rune_map_1 || rm['1'],
      seat.rune_map_2 || rm['2'],
      seat.rune_map_3 || rm['3'],
    ];
    subs.forEach((id, s) => {
      const url = eccRuneUrl(id);
      if (url) ref.subRunes[s].src = url;
      else     ref.subRunes[s].removeAttribute('src');
    });
  }
}
registerPollHandler(eccUpdate);

async function eccAnimateIn() {
  eccShouldShow = true;
  clearTimeout(eccOutTimer);
  const clip    = document.getElementById('emblem-check-clip');
  const overlay = document.getElementById('emblem-check-overlay');
  if (ECC_MCT) {   /* fill + decode every image first so nothing hitches mid-animation (same as icAnimateIn) */
    if (lastData) eccUpdate(lastData);
    await icPreloadImages(overlay, 900);
    if (!eccShouldShow) return;
  }
  clip.style.display = 'block';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    overlay.classList.add('ecc-in');
  }));

  if (ECC_MCT) return;   /* MCT's centre emblems are part of the backer art — no bounce */
  if (lastData) eccUpdate(lastData);

  setTimeout(() => {
    if (!eccShouldShow) return;
    eccRefs.middle.classList.remove('ecc-bounce');
    void eccRefs.middle.offsetWidth;
    eccRefs.middle.classList.add('ecc-bounce');
  }, 350);
}

function eccAnimateOut() {
  eccShouldShow = false;
  const clip    = document.getElementById('emblem-check-clip');
  const overlay = document.getElementById('emblem-check-overlay');
  overlay.classList.remove('ecc-in');
  clearTimeout(eccOutTimer);
  eccOutTimer = setTimeout(() => {
    clip.style.display = 'none';
  }, ECC_MCT ? 750 : 350);
  /* Resume any kill events that queued up while this panel was blocking
     them (see killEventsBlocked() in overlay-killevents.js). */
  playNextKillEvent();
}
