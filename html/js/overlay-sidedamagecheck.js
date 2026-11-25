/* ── [FEATURE: sidedamage-check] ───────────────────────────────────
   Ranks all 10 players by total damage dealt. See
   overlay-sidecheck-core.js for the shared panel/animation logic and
   the .sidecheck-* CSS block in mploverlay_v7.css for layout notes. */
const sdcPanel = createSideCheck({
  clipId:     'sidedamage-check-clip',
  overlayId:  'sidedamage-check-overlay',
  headerText: 'DAMAGE DEALT',
  statField:  'total_damage',
  formatStat: seat => sidecheckFormatK(seat && seat.total_damage),
});


/* ── MCT "Players Damage" panel ─────────────────────────────────────
   Used instead of the generic sidecheck panel when data-theme-name="mct".
   10 players ranked as ONE list by total_damage; rank 1 sits on the
   baked cyan highlight row (dark text), the rest are cyan/white.
   Each row is persistent (keyed by side+slot) and FLIP-slides when its
   rank changes; the damage number counts up smoothly.
   Animation: title backer sweeps in from the right (overshoot), title
   pops up, the panel + hero column slide in, rows cascade in from the
   right with portraits popping, damage numbers count up from 0, and a
    */
function createMctPlayersPanel(o) {
  const ROW_H = 54, TOP0 = 256, EASE = 'cubic-bezier(.16,1,.3,1)', POP = 'cubic-bezier(.34,1.56,.64,1)', IN = 'cubic-bezier(.5,0,.75,0)';
  const root = document.getElementById(o.rootId);
  const refs = {};            /* key side+slot -> {row, portrait, rankEl, numEl, nameEl, shown, target, tw} */
  let built = false, shouldShow = false, onAir = false, lastFirst = null, busy = Promise.resolve(), lastOrder = [];
  const els = {};
  const a = (el, f, o) => el.animate(f, Object.assign({ fill: 'both' }, o)).finished.catch(() => {});
  const asset = n => '/assets/overlay/MCT/ingame/mct_playerdamage_' + n + '.png';  /* gold panel reuses the damage art, only the title differs */

  function mk(tag, id, cls) { const e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; return e; }
  function build() {
    if (built || !root) return; built = true;
    [['herobg', 'sdm-herobg'], ['bg', 'sdm-bg'], ['titlebacker', 'sdm-titlebacker'], [o.titleFile, 'sdm-title']].forEach(([f, id]) => {
      const i = mk('img', '', id); i.src = asset(f); i.alt = ''; root.appendChild(i); els[id] = i;
    });
    els['sdm-disc'] = mk('div', '', 'sdm-disc'); root.appendChild(els['sdm-disc']);   /* solid black disc filling the #1 ring (in front of the ring art, behind the hero icon) */
    ['home', 'away'].forEach(side => { for (let s = 1; s <= 5; s++) {
      const row = mk('div', '', 'sdm-row');
      const portrait = mk('img', '', 'sdm-portrait'); portrait.alt = ''; portrait.onerror = () => { portrait.onerror = null; portrait.removeAttribute('src'); };
      const rankEl = mk('div', '', 'sdm-rank'), numEl = mk('div', '', 'sdm-num'), nameEl = mk('div', '', 'sdm-name');
      [portrait, rankEl, numEl, nameEl].forEach(e => row.appendChild(e));
      root.appendChild(row);
      refs[side + s] = { row, portrait, rankEl, numEl, nameEl, shown: 0, target: 0, tw: null, top: 0 };
    } });
  }

  function tweenNum(r, to, ms) {
    cancelAnimationFrame(r.tw); const from = r.shown, t0 = performance.now();
    if (!ms || from === to) { r.shown = to; r.numEl.textContent = String(Math.round(to)); return; }
    (function f(now) {
      const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      r.shown = from + (to - from) * e; r.numEl.textContent = String(Math.round(r.shown));
      if (k < 1) r.tw = requestAnimationFrame(f);
    })(t0);
  }
  function fitName(el) {
    let px = 21; el.style.fontSize = px + 'px';
    while (el.scrollWidth > el.clientWidth && px > 11) { px -= 0.5; el.style.fontSize = px + 'px'; }
  }
  /* seat_N straight from the camp: seat = lane in the adapter, and every seat is a distinct player (a role lookup can return the same player twice) */
  function seatOf(data, campId, n) {
    const camp = data.camp_list && data.camp_list.find(c => c.campid === campId);
    return (camp && camp['seat_' + n]) || null;
  }

  function update(data, instant) {
    if (!shouldShow) return;
    const entries = [];
    for (let s = 1; s <= 5; s++) {
      entries.push({ k: 'home' + s, seat: seatOf(data, 1, s), side: 'home', s });
      entries.push({ k: 'away' + s, seat: seatOf(data, 2, s), side: 'away', s });
    }
    const dmg = e => (e.seat && e.seat[o.statField]) || 0;
    entries.sort((x, y) => (dmg(y) - dmg(x)) || (x.side !== y.side ? (x.side === 'home' ? -1 : 1) : x.s - y.s));
    entries.forEach((e, rank) => {
      const r = refs[e.k]; if (!r) return;
      const top = TOP0 + rank * ROW_H;
      if (r.top !== top) {
        const old = r.top; r.top = top; r.row.style.top = top + 'px';
        if (!instant && onAir && old) {
          r.row.animate([{ transform: 'translateY(' + (old - top) + 'px)' }, { transform: 'translateY(0)' }], { duration: 560, easing: EASE });
        }
      }
      r.rankEl.textContent = '#' + (rank + 1);
      r.row.classList.toggle('sdm-first', rank === 0);
      const seat = e.seat;
      if (seat && seat.heroid) { const u = heroWebUrl(seat.heroid); if (r.portrait.dataset.u !== u) { r.portrait.dataset.u = u; r.portrait.src = u; } }
      const nm = (seat && seat.name) || '';
      if (r.nameEl.textContent !== nm) { r.nameEl.textContent = nm; fitName(r.nameEl); }
      const to = dmg(e);
      if (to !== r.target) { r.target = to; if (!instant && !onAir) r._t = to; else tweenNum(r, to, instant ? 0 : 600); }
    });
  }
  registerPollHandler(update);

  const q = fn => (busy = busy.then(fn, fn));

  function animateIn() {
    build(); if (!root) return;
    shouldShow = true; onAir = false;
    q(async () => {
      if (!shouldShow) return;
      root.style.display = 'block';
      Object.values(refs).forEach(r => { r.shown = 0; r.target = -1; r.top = 0; r.row.style.opacity = 0; });
      if (typeof lastData !== 'undefined' && lastData) update(lastData, true);
      Object.values(refs).forEach(r => { r._t = r.target; r.shown = 0; r.numEl.textContent = '0'; });
      const ps = [], E = 'cubic-bezier(.2,.9,.1,1)';
      /* header + body + ring slide in together as one unit; the #1 hero icon pops with the ring */
      [els['sdm-titlebacker'], els['sdm-title'], els['sdm-bg'], els['sdm-herobg'], els['sdm-disc']].forEach(e =>
        ps.push(a(e, [{ transform: 'translateX(140px)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], { duration: 520, easing: E })));
      const order = Object.values(refs).sort((x, y) => x.top - y.top);
      order.forEach((r, i) => {
        const d = i === 0 ? 0 : 140 + i * 45;
        ps.push(a(r.row, [{ transform: 'translateX(80px)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], { duration: i === 0 ? 520 : 420, delay: d, easing: E }));
        ps.push(a(r.portrait, [{ transform: 'scale(.4)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 440, delay: d, easing: 'cubic-bezier(.34,1.56,.64,1)' }));
        setTimeout(() => { if (shouldShow) tweenNum(r, r._t > 0 ? r._t : 0, 650); }, d + 60);
      });
      await Promise.all(ps);
      Object.values(refs).forEach(r => r.row.style.opacity = '');
      onAir = shouldShow;
    });
  }
  function animateOut() {
    shouldShow = false; onAir = false;
    q(async () => {
      if (!root || root.style.display === 'none') return;
      const ps = [], IN2 = 'cubic-bezier(.6,0,.9,.4)';
      Object.values(refs).sort((x, y) => y.top - x.top).forEach((r, i) =>
        ps.push(a(r.row, [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(60px)', opacity: 0 }], { duration: 240, delay: i * 20, easing: IN2 })));
      [els['sdm-titlebacker'], els['sdm-title'], els['sdm-bg'], els['sdm-herobg'], els['sdm-disc']].forEach(e =>
        ps.push(a(e, [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(120px)', opacity: 0 }], { duration: 320, delay: 140, easing: IN2 })));
      await Promise.all(ps);
      if (!shouldShow) root.style.display = 'none';
    });
  }
  return { animateIn, animateOut, update };
}
const sdmPanel = createMctPlayersPanel({ rootId: 'sdm-root', titleFile: 'titledamage', statField: 'total_damage' });

function sdcIsMct() { return document.documentElement.getAttribute('data-theme-name') === 'mct'; }
let sdcActiveMct = false;

function sdcAnimateIn()  { sdcActiveMct = sdcIsMct(); (sdcActiveMct ? sdmPanel : sdcPanel).animateIn(); }
function sdcAnimateOut() { (sdcActiveMct ? sdmPanel : sdcPanel).animateOut(); }
