/* ── Level 4 "eventer" overlay — same trigger shape as Level 15, fires when a player reaches level 4.
   Art: assets/overlay/M8/Ingame/m8_level4.png (168x94, "LV 4" baked in). It covers that player's UI card,
   sliding in from the outer screen edge (home from the left, away from the right — the art is NEVER mirrored).
   Player name + role icon get the gold gradient; after the slide-in the gold parts shine once, then it slides out. */
/* MCT (data-theme-name="mct"): 168x90 art, one file per side (mct_level4left/right.png), name only (no role icon / shine) — see the MCT LEVEL 4 CSS block. */
const LV4_MCT = document.documentElement.getAttribute('data-theme-name') === 'mct';
const LV4_W = 168, LV4_H = LV4_MCT ? 90 : 94;
const LV4_TOPS = LV4_MCT ? [345, 435, 525, 615, 705] : [344, 434, 524, 614, 704];   /* = player-card tops (346 + 90n) - 2: 94px art centred on the 90px card slot */
const lvl4Queue = {};
const isPlayingLvl4 = {};
const lvl4Refs = {};

function buildLvl4Overlay(i) {
  const side = i <= 5 ? 'home' : 'away';
  const pos  = i <= 5 ? i - 1 : i - 6;

  const clip = document.createElement('div');
  clip.className = 'lv4-clip ' + side;
  clip.id = `lvl4-evt-${i}`;
  clip.style.left = (side === 'home' ? 0 : 1920 - LV4_W) + 'px';
  clip.style.top  = LV4_TOPS[pos] + 'px';

  const card = document.createElement('div');
  card.className = 'lv4-card';

  const bg = document.createElement('img');
  bg.className = 'lv4-bg';
  bg.src = LV4_MCT ? 'assets/overlay/M8/Ingame/mct_level4' + (side === 'home' ? 'right' : 'left') + '.png' : 'assets/overlay/M8/Ingame/m8_level4.png';
  bg.alt = '';

  const role = document.createElement('div');
  role.className = 'lv4-role';
  const roleUrl = ROLE_ICONS[pos + 1];
  if (roleUrl) role.style.cssText = `-webkit-mask-image:url("${roleUrl}");mask-image:url("${roleUrl}");`;

  const nameBox = document.createElement('div');
  nameBox.className = 'lv4-name';
  const nameTxt = document.createElement('span');
  nameBox.appendChild(nameTxt);

  const sheen = document.createElement('div');
  sheen.className = 'lv4-sheen';

  card.appendChild(bg); card.appendChild(role); card.appendChild(nameBox); card.appendChild(sheen);
  clip.appendChild(card);
  document.getElementById('scene').insertBefore(clip, document.getElementById('player-ui-overlay'));

  lvl4Refs[i] = { clip, nameTxt, sheen };
}

function lv4FitName(el, maxW) {
  const top = LV4_MCT ? 19.5 : 15;
  el.style.fontSize = top + 'px';
  if (el.offsetWidth <= maxW) return;
  let lo = top / 2, hi = top;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    el.style.fontSize = mid + 'px';
    if (el.offsetWidth <= maxW) lo = mid; else hi = mid;
  }
  el.style.fontSize = lo + 'px';
}

function triggerLvl4(i, name) {
  if (isPlayingLvl4[i]) return;
  isPlayingLvl4[i] = true;
  const btn = document.querySelector(`.debug-btn[data-lvl4="${i}"]`);
  if (btn) btn.disabled = true;
  const { clip, nameTxt, sheen } = lvl4Refs[i];

  let outerGuard, cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(outerGuard);
    clip.classList.remove('lv4-in');
    sheen.classList.remove('sweep');
    clip.style.display = 'none';
    isPlayingLvl4[i] = false;
    if (btn) btn.disabled = false;
    playNextQueued(i);
  };
  outerGuard = setTimeout(cleanup, 4500);

  nameTxt.textContent = name || '';
  clip.classList.remove('lv4-in');
  sheen.classList.remove('sweep');
  clip.style.display = 'block';
  lv4FitName(nameTxt, LV4_MCT ? 150 : 120);                 /* measured while display:block (never while hidden) */
  requestAnimationFrame(() => requestAnimationFrame(() => clip.classList.add('lv4-in')));

  setTimeout(() => { void sheen.offsetWidth; sheen.classList.add('sweep'); }, 480);   /* shine once the slide has landed */
  setTimeout(() => {
    clip.classList.remove('lv4-in');
    setTimeout(cleanup, 380);
  }, 2700);
}
