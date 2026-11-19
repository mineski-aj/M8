/* ── First item priority "eventer" overlay — M8 art ──
   assets/overlay/M8/Ingame/m8_firstitem_left.png (home: flat edge on the screen's left, circle on the right) and
   m8_firstitem_right.png (away: mirror-drawn, flat edge on the right, circle on the left). 377x106 each; the opaque band
   is y 6..98, so the art sits 7px above the player card so its top/bottom edges line up with the card's.
   It covers the card and slides in from the outer screen edge. The item icon goes in the art's grey ring. */
const FIP_W = 377, FIP_H = 106, FIP_TOP_OFFSET = 7;
const FIP_CIRCLE = { home: { cx: 320, cy: 56.5 }, away: { cx: 57, cy: 56.5 } };   /* ring centres, measured off the art */
const FIP_ICON_D = 68;
function buildItemOverlay(i) {
  const side = i <= 5 ? 'home' : 'away';
  const pos  = i <= 5 ? i - 1 : i - 6;

  const clip = document.createElement('div');
  clip.className = 'fip2-clip ' + side;
  clip.id = `fip-evt-${i}`;
  clip.style.left = (side === 'home' ? 0 : 1920 - FIP_W) + 'px';
  clip.style.top  = (346 + pos * 90 - FIP_TOP_OFFSET) + 'px';

  const card = document.createElement('div');
  card.className = 'fip2-card';

  const bg = document.createElement('img');
  bg.className = 'fip2-bg';
  bg.src = 'assets/overlay/M8/Ingame/m8_firstitem_' + (side === 'home' ? 'left' : 'right') + '.png';
  bg.alt = '';

  const c = FIP_CIRCLE[side];
  const itemBox = document.createElement('div');
  itemBox.className = 'fip2-item';
  itemBox.style.left = (c.cx - FIP_ICON_D / 2) + 'px';
  itemBox.style.top  = (c.cy - FIP_ICON_D / 2) + 'px';
  const itemIcon = document.createElement('img');
  itemIcon.className = 'fip2-icon';
  itemIcon.alt = '';
  const sheen = document.createElement('div');
  sheen.className = 'evt-sheen';
  itemBox.appendChild(itemIcon);
  itemBox.appendChild(sheen);

  card.appendChild(bg);
  card.appendChild(itemBox);
  clip.appendChild(card);
  document.getElementById('scene').insertBefore(clip, document.getElementById('player-ui-overlay'));

  itemRefs[i] = { clip, itemIcon, sheen };
}

function resetItem(i) {
  const { clip, sheen } = itemRefs[i];
  clip.classList.remove('fip2-in');
  sheen.classList.remove('sweep');
}

/* First-item timing from the game feed: player.extra_param.first_item (or player.first_item) =
   { build_rate, difference (negative = faster), fastestTime, heroid, item, status: 'faster'|'late'|'no_data'|..., time }.
   Same phase-2 logic as Trinity's core_item (coreItemPhase2 in overlay-trinity.js). */
const FIRST_ITEM_KEYS = ['first_item'];
function getFirstItemData(player) {
  if (!player) return null;
  const ep = player.extra_param || {};
  for (const k of FIRST_ITEM_KEYS) { if (ep[k] && typeof ep[k] === 'object') return ep[k]; if (player[k] && typeof player[k] === 'object') return player[k]; }
  return null;
}

/* The M8 art has no time / phase-2 slots, so timeStr and core are accepted (old call sites pass them) but not shown. */
function triggerItem(i, itemId, timeStr, core) {
  if (isPlayingItem[i]) return;
  isPlayingItem[i] = true;
  const btn = document.querySelector(`.item-debug-btn[data-player="${i}"]`);
  if (btn) btn.disabled = true;
  const { clip, itemIcon, sheen } = itemRefs[i];

  let outerGuard;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(outerGuard);
    resetItem(i);
    clip.style.display = 'none';
    isPlayingItem[i]    = false;
    if (btn) btn.disabled = false;
    playNextQueued(i);
  };
  outerGuard = setTimeout(cleanup, 4000);

  itemIcon.src = itemId ? `assets/game/items/${itemId}.png` : '';
  resetItem(i);
  clip.style.display = 'block';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    clip.classList.add('fip2-in');
  }));

  setTimeout(() => { sheen.classList.add('sweep'); }, 400); /* right after the slide-in settles */

  setTimeout(() => {
    if (cleanedUp) return;
    clip.classList.remove('fip2-in');
    setTimeout(cleanup, 350);
  }, 2400);
}
