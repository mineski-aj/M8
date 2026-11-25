/* ── [FEATURE: item-check] ──────────────────────────────────────
   Coordinates below are measured directly off
   assets/overlay/ingame/ingameitemback2.png (887×282) — see the CSS block
   in mploverlay_v7.css for the full measurement notes. */
const IC_ROW_TOPS       = [8, 64, 120, 176, 232];
const IC_GOLD_TOP_FIRST = 25;   /* first row's gold top; rest follow gap-based pitch */
const IC_GOLD_HEIGHT    = 31;
const IC_HOME_ITEM_X    = [223, 180, 137, 94, 51, 8]; /* index 0 = closest to portrait */
const IC_AWAY_ITEM_X    = [624, 667, 710, 753, 796, 839];
const IC_HOME_PORTRAIT_X = 326;
const IC_AWAY_PORTRAIT_X = 521;
const IC_HOME_GOLD_X     = 262;
const IC_AWAY_GOLD_X     = 561;
/* .ic-bg sits 42px down inside #item-check-overlay (the label banner
   rides above it) — every row coordinate above is relative to the bg
   image itself, so add this offset when positioning row elements. */
const IC_BG_TOP_OFFSET  = 42;

/* Dashboard Edit tab → Item Check Layout (itemcheck_layout.json,
   routes/devapi.js's /api/itemcheck-layout) — goldGap is the space
   between gold rows (added to IC_GOLD_HEIGHT for the row-to-row pitch);
   home/awayOffsetX/Y shift every element on that side together, so the
   whole blue/red half can be nudged in one edit. Defaults here match
   the server's fallback; icAnimateIn() fetches the real saved values
   fresh every time the panel is shown (same pattern as Credit Reel's
   speed/style tunables). */
let icLayout = { goldGap: 26, homeOffsetX: 0, homeOffsetY: 0, awayOffsetX: 0, awayOffsetY: 0 };

function icRowGeometry(side, seatIdx, layout) {
  const ox = side === 'home' ? layout.homeOffsetX : layout.awayOffsetX;
  const oy = side === 'home' ? layout.homeOffsetY : layout.awayOffsetY;
  return {
    top:      IC_ROW_TOPS[seatIdx] + IC_BG_TOP_OFFSET + oy,
    goldTop:  IC_GOLD_TOP_FIRST + seatIdx * (IC_GOLD_HEIGHT + layout.goldGap) + IC_BG_TOP_OFFSET + oy,
    portraitX: (side === 'home' ? IC_HOME_PORTRAIT_X : IC_AWAY_PORTRAIT_X) + ox,
    itemXs:    (side === 'home' ? IC_HOME_ITEM_X : IC_AWAY_ITEM_X).map(x => x + ox),
    goldX:     (side === 'home' ? IC_HOME_GOLD_X : IC_AWAY_GOLD_X) + ox,
  };
}

let icShouldShow = false;
let icOutTimer   = null;
const icRefs     = {};

function icFormatGold(g) {
  return ((g || 0) / 1000).toFixed(1) + 'K';
}

function icBuildRow(i) {
  const side    = i <= 5 ? 'home' : 'away';
  const seatIdx = i <= 5 ? i - 1 : i - 6;
  const g = icRowGeometry(side, seatIdx, icLayout);

  const portrait = document.createElement('img');
  portrait.className = 'ic-portrait';
  portrait.style.left = g.portraitX + 'px';
  portrait.style.top  = g.top + 'px';
  portrait.alt = '';
  portrait.onerror = () => { portrait.onerror = null; portrait.removeAttribute('src'); };

  const gold = document.createElement('div');
  gold.className = 'ic-gold';
  gold.style.left = g.goldX + 'px';
  gold.style.top  = g.goldTop + 'px';

  const text = document.createElement('span');
  text.className = 'ic-gold-text';
  text.textContent = '0.0K';
  gold.appendChild(text);

  const items = [];
  for (let s = 0; s < 6; s++) {
    const item = document.createElement('img');
    item.className = 'ic-item-slot';
    item.style.left = g.itemXs[s] + 'px';
    item.style.top  = g.top + 'px';
    item.alt = '';
    item.onerror = () => { item.onerror = null; item.src = 'assets/game/items/99999.png'; };
    items.push(item);
  }

  icRefs[i] = { portrait, gold, goldText: text, items };
  return [portrait, gold, ...items];
}

/* Re-applies icLayout to every already-built row — called after a fresh
   fetch in icAnimateIn() so a layout change (gold gap / side offsets)
   saved from the dashboard takes effect the next time the panel shows,
   without rebuilding any elements. */
function icApplyLayout() {
  if (IC_MCT) return;   /* MCT geometry is fixed to the art */
  for (let i = 1; i <= 10; i++) {
    const ref = icRefs[i];
    if (!ref) continue;
    const side    = i <= 5 ? 'home' : 'away';
    const seatIdx = i <= 5 ? i - 1 : i - 6;
    const g = icRowGeometry(side, seatIdx, icLayout);
    ref.portrait.style.left = g.portraitX + 'px';
    ref.portrait.style.top  = g.top + 'px';
    ref.gold.style.left = g.goldX + 'px';
    ref.gold.style.top  = g.goldTop + 'px';
    ref.items.forEach((item, s) => {
      item.style.left = g.itemXs[s] + 'px';
      item.style.top  = g.top + 'px';
    });
  }
}

function icFetchLayout() {
  return fetch('/api/itemcheck-layout', { cache: 'no-store' })
    .then(r => r.json())
    .then(layout => { icLayout = layout; icApplyLayout(); })
    .catch(() => {});
}

/* Called from dashboard.html's Item Check Layout panel while
   typing/dragging any of its five fields — same cross-frame-call
   pattern as sidecheckSetNameFontCeiling() in overlay-sidecheck-
   core.js. Applies instantly for live preview without writing
   itemcheck_layout.json; Save is what persists it. */
window.icPreviewLayout = function(partial) {
  icLayout = Object.assign({}, icLayout, partial);
  icApplyLayout();
};


/* ── MCT theme: Item Build panel (mct_item<lane>.png rows, mct_itemvisa.png title) ─────────────
   Everything is scoped to data-theme-name="mct"; other themes keep the code above. Row art is
   1084x52 per lane (exp, jungle, mid, roam, gold = seats 1..5); the hero shows through the
   pure-black "mask" hole on each side (a mask is derived from the art's own black pixels, so a
   replaced asset needs no re-measuring). Coordinates are relative to the 1084-wide panel. */
const IC_MCT        = document.documentElement.getAttribute('data-theme-name') === 'mct';
const IC_MCT_DIR    = '/assets/overlay/M8/Ingame/';
const IC_MCT_LANES  = ['exp', 'jungle', 'mid', 'roam', 'gold'];
const IC_MCT_ROW_TOP   = 32;  /* title is 31px tall, rows start 1px below it */
const IC_MCT_ROW_PITCH = 53;
const IC_MCT_HOME_ITEM_CX = [335, 287, 239, 191, 143, 95];     /* slot 0 = nearest the hero */
const IC_MCT_AWAY_ITEM_CX = [748, 796, 844, 892, 940, 988];
const IC_MCT_ITEM = 38, IC_MCT_ITEM_CY = 25.5;
/* hole bounding boxes (home 353..446, away 638..731); the art is drawn IC_MCT_HERO_PUSH px wider and hangs past the hole's
   centre-facing side, which the mask hides — that shifts the hero toward the outer side so more of the head shows */
const IC_MCT_HERO_PUSH = 32;
const IC_MCT_HERO = { home: { x: 353, w: 93 + IC_MCT_HERO_PUSH }, away: { x: 638 - IC_MCT_HERO_PUSH, w: 93 + IC_MCT_HERO_PUSH } };
const IC_MCT_GOLD_CX = { home: 481, away: 602.5 };

/* Derives a mask PNG (data URL) from the row art: opaque where the art is pure black. */
function icMctMask(img) {
  try {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height), px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      const m = Math.max(px[i], px[i + 1], px[i + 2]);
      const a = px[i + 3] < 200 ? 0 : m <= 2 ? 255 : m < 30 ? Math.round((30 - m) / 28 * 255) : 0;
      px[i] = px[i + 1] = px[i + 2] = 0; px[i + 3] = a;
    }
    g.putImageData(d, 0, 0);
    return c.toDataURL('image/png');
  } catch (e) { return null; }
}

function icMctBuildRow(r) {
  const lane = IC_MCT_LANES[r];
  const row = document.createElement('div');
  row.className = 'ic-mrow';
  row.style.top = (IC_MCT_ROW_TOP + r * IC_MCT_ROW_PITCH) + 'px';
  row.style.setProperty('--d',  (160 + r * 90) + 'ms');   /* entrance delay: top row first */
  row.style.setProperty('--xd', (r * 45) + 'ms');         /* exit delay: top row first */

  const bg = document.createElement('img');
  bg.className = 'ic-mbg';
  bg.alt = '';
  row.appendChild(bg);

  const heroBox = document.createElement('div');          /* masked by the art's black holes */
  heroBox.className = 'ic-mhero';
  const heroes = {};
  ['home', 'away'].forEach(side => {
    const h = document.createElement('img');
    h.className = 'ic-mhero-img ic-mhero-' + side;
    h.style.left = IC_MCT_HERO[side].x + 'px';
    h.style.width = IC_MCT_HERO[side].w + 'px';
    h.alt = '';
    h.onerror = () => { h.onerror = null; h.removeAttribute('src'); };
    heroBox.appendChild(h);
    heroes[side] = h;
  });
  row.appendChild(heroBox);
  /* a mask that could not be built (tainted canvas) must not leave an unmasked rectangle over the art */
  heroBox.style.visibility = 'hidden';
  const probe = new Image();
  probe.onload = () => {
    const m = icMctMask(probe);
    if (!m) return;
    heroBox.style.webkitMaskImage = heroBox.style.maskImage = 'url(' + m + ')';
    heroBox.style.visibility = '';
  };
  probe.src = IC_MCT_DIR + 'mct_item' + lane + '.png';
  bg.src = IC_MCT_DIR + 'mct_item' + lane + '.png';

  const refs = { home: { items: [] }, away: { items: [] }, heroes };
  ['home', 'away'].forEach(side => {
    const cx = side === 'home' ? IC_MCT_HOME_ITEM_CX : IC_MCT_AWAY_ITEM_CX;
    for (let k = 0; k < 6; k++) {
      const it = document.createElement('img');
      it.className = 'ic-mitem';
      it.style.left = (cx[k] - IC_MCT_ITEM / 2) + 'px';
      it.style.top  = (IC_MCT_ITEM_CY - IC_MCT_ITEM / 2) + 'px';
      it.style.setProperty('--id', (300 + k * 45) + 'ms');   /* items pop in outward from the hero */
      it.alt = '';
      it.onerror = () => { it.onerror = null; it.src = 'assets/game/items/99999.png'; };
      row.appendChild(it);
      refs[side].items.push(it);
    }
    const gold = document.createElement('div');
    gold.className = 'ic-mgold';
    gold.style.left = (IC_MCT_GOLD_CX[side] - 34) + 'px';
    const ico = document.createElement('img');
    ico.className = 'ic-mgold-icon';
    ico.src = IC_MCT_DIR + 'mct_goldicon.png';
    ico.alt = '';
    const val = document.createElement('span');
    val.className = 'ic-mgold-val';
    gold.append(ico, val);
    row.appendChild(gold);
    refs[side].gold = gold; refs[side].goldVal = val;
  });
  return { row, refs };
}

function icMctBuildPanel(overlay) {
  const title = document.createElement('div');
  title.className = 'ic-mtitle';
  const timg = document.createElement('img');
  timg.src = IC_MCT_DIR + 'mct_itemvisa.png';
  timg.alt = '';
  title.append(timg);
  overlay.appendChild(title);
  icRefs.mtitle = title;
  for (let r = 0; r < 5; r++) {
    const b = icMctBuildRow(r);
    overlay.appendChild(b.row);
    icRefs['m' + r] = b.refs;
  }
}

function icMctUpdate(data) {
  for (let i = 1; i <= 10; i++) {
    const side = i <= 5 ? 'home' : 'away';
    const r = i <= 5 ? i - 1 : i - 6;
    const ref = icRefs['m' + r];
    const pl = getPlayer(data, i);
    if (!ref || !pl || !pl.player) continue;
    const hero = ref.heroes[side];
    if (pl.player.heroid) { const u = 'assets/hero/post/' + pl.player.heroid + '_POST_HERO.webp'; if (hero.dataset.u !== u) { hero.dataset.u = u; hero.src = u; } }
    else { hero.removeAttribute('src'); delete hero.dataset.u; }
    for (let s = 0; s < 6; s++) {
      const id = pl.equipIds[s];
      const it = ref[side].items[s];
      if (id && id !== '99999') {
        const u = 'assets/game/items/' + id + '.png';
        if (it.dataset.u !== u) { it.dataset.u = u; it.src = u; }
        it.style.visibility = '';
      } else { it.removeAttribute('src'); delete it.dataset.u; it.style.visibility = 'hidden'; }
    }
    /* lane gold lead over the opposing player: shown for whichever side is ahead */
    const diff = Math.round(Number(pl.player.goldDiffPlayer) || 0);
    ref[side].goldVal.textContent = diff > 0 ? '+' + diff : '';
    ref[side].gold.classList.toggle('ic-mgold-off', diff <= 0);
  }
}

function icBuildPanel() {
  const overlay = document.getElementById('item-check-overlay');
  if (!overlay) return;
  if (IC_MCT) { icMctBuildPanel(overlay); return; }

  const isAnniv = document.documentElement.getAttribute('data-theme') === '10th_anniversary';
  const isPlayoffs = document.documentElement.getAttribute('data-theme') === 'playoffs';
  const icAssetDir = isAnniv ? '/assets/overlay/ingame/anniversary/' : isPlayoffs ? '/assets/overlay/ingame/playoffs/' : '/assets/overlay/ingame/';

  const bg = document.createElement('img');
  bg.className = 'ic-bg';
  bg.src = icAssetDir + 'ingameitemback2.png';
  bg.alt = '';
  overlay.appendChild(bg);

  /* Banner riding above the panel, same slide, same bounce+sheen
     flourish pattern as golddiff-check's .gdc-smart chip. */
  const label = document.createElement('div');
  label.className = 'ic-label';
  label.id = 'ic-label';

  const labelImg = document.createElement('img');
  labelImg.className = 'ic-label-img';
  labelImg.src = icAssetDir + 'ingameitemlabel.png';
  labelImg.alt = '';
  label.appendChild(labelImg);

  const labelSheen = document.createElement('div');
  labelSheen.className = 'ic-label-sheen';
  label.appendChild(labelSheen);

  overlay.appendChild(label);
  icRefs.label = label;

  for (let i = 1; i <= 10; i++) {
    icBuildRow(i).forEach(el => overlay.appendChild(el));
  }
}
icBuildPanel();

function icUpdate(data) {
  if (!icShouldShow) return;
  if (IC_MCT) { icMctUpdate(data); return; }
  for (let i = 1; i <= 10; i++) {
    const r   = getPlayer(data, i);
    const ref = icRefs[i];
    if (!r || !r.player || !ref) continue;

    const heroId = r.player.heroid;
    if (heroId) ref.portrait.src = heroWebUrl(heroId);
    else        ref.portrait.removeAttribute('src');

    ref.goldText.textContent = icFormatGold(r.player.gold);

    for (let s = 0; s < 6; s++) {
      const id = r.equipIds[s] || '99999';
      ref.items[s].src = `assets/game/items/${id}.png`;
    }
  }
}
registerPollHandler(icUpdate);

/* Waits for every <img> under `overlay` to finish loading (or errors, or
   maxWaitMs elapses) — same shape as postgame.html's preloadMedia(). On a
   freshly-reloaded page none of the ~60 item/portrait icons are cached
   yet, so setting all their src at once and immediately starting the
   slide-in transition let the burst of first-time image decodes stall
   the main thread right on the transition's opening frames, making it
   look like it "pops in" partway instead of sliding from the start.
   Once every icon is cached (every show after the first), there's
   nothing to wait on and this resolves immediately. */
function icPreloadImages(overlay, maxWaitMs) {
  const els = overlay.querySelectorAll('img');
  return Promise.all(Array.from(els).map(el => new Promise(resolve => {
    /* decode() too: a loaded-but-undecoded image decodes on first paint, which is a visible hitch mid-animation */
    if (!el.getAttribute('src')) return resolve();
    if (el.complete) { (el.decode ? el.decode().catch(() => {}) : Promise.resolve()).then(resolve); setTimeout(resolve, maxWaitMs); return; }
    el.addEventListener('load', () => (el.decode ? el.decode().catch(() => {}) : Promise.resolve()).then(resolve), { once: true });
    el.addEventListener('error', resolve, { once: true });
    setTimeout(resolve, maxWaitMs);
  })));
}

async function icAnimateIn() {
  icShouldShow = true;
  clearTimeout(icOutTimer);
  const clip    = document.getElementById('item-check-clip');
  const overlay = document.getElementById('item-check-overlay');

  await icFetchLayout();
  if (!icShouldShow) return; /* hidden again while we were fetching layout */

  if (lastData) icUpdate(lastData);
  await icPreloadImages(overlay, 900);
  if (!icShouldShow) return; /* hidden again while we were preloading */

  clip.style.display = 'block';
  /* Double rAF (same technique as slideOut() in overlay-core.js) so the
     browser commits a full style+layout+paint pass at the base rule's
     translateY(324px) before .ic-in changes it — going from display:none
     straight to the "in" transform in the same tick can otherwise skip
     the transition entirely. */
  requestAnimationFrame(() => requestAnimationFrame(() => {
    overlay.classList.add('ic-in');
  }));

  /* Bounce + sheen flourish on the label banner once the 350ms slide-in
     finishes — same pattern as golddiff-check's gdcPlaySmartFlourish(). */
  if (IC_MCT) return;   /* MCT title has no sheen */
  setTimeout(() => {
    if (!icShouldShow) return;
    icRefs.label.classList.remove('ic-bounce-play', 'ic-sheen-play');
    void icRefs.label.offsetWidth;
    icRefs.label.classList.add('ic-bounce-play', 'ic-sheen-play');
  }, 350);
}

function icAnimateOut() {
  icShouldShow = false;
  const clip    = document.getElementById('item-check-clip');
  const overlay = document.getElementById('item-check-overlay');
  /* Just remove .ic-in — the transition lives on the base rule, so this
     animates back to it smoothly instead of snapping instantly with
     nothing left to transition (that was the earlier "stall" bug). */
  overlay.classList.remove('ic-in');
  clearTimeout(icOutTimer);
  icOutTimer = setTimeout(() => {
    clip.style.display = 'none';
  }, IC_MCT ? 750 : 350);
  /* Resume any kill events that queued up while this panel was blocking
     them (see killEventsBlocked() in overlay-killevents.js). */
  playNextKillEvent();
}
