/* ── MCT "Real Time Gold Graph" (Gold Graph Check, MCT theme) ───────────────
   Used instead of the generic #gold-graph-check panel when data-theme-name="mct"
   (hooks in overlay-goldgraphcheck.js: ggcAnimateIn/Out + the top of ggcRenderChart,
   so it shares that file's data fetch: V2 Gold Info API, else the /positions log).
   Coordinates are the 1920x1080 canvas, taken from mct_ingamegoldcurve_reference.png.
   Graph = gold DIFFERENCE over the game: a blue baseline (0), the line is CYAN while
   team 1 (top logo) leads and YELLOW while team 2 (bottom logo) leads. Y axis is
   symmetric around the baseline in nice steps (S, 2S, 3S); X axis runs 0 -> now with
   a gridline + label every 5 minutes.
   Logos: from the game API (camp.team_simple_name -> assets/team/logos/<TRI>.png);
   if NEITHER loads, the Match Board's teams are used instead. */
const ggmPanel = (function () {
  const SVGNS = 'http://www.w3.org/2000/svg';
  const PL = 663, PT = 834, PW = 480, PH = 187;           /* plot box (page coords) */
  const ROWS = 6, BASE_ROW = 3, BASE_Y = PT + PH * BASE_ROW / ROWS;
  const CYAN = '#43fff0', YELLOW = '#ffe100';
  const E = 'cubic-bezier(.2,.9,.1,1)';
  const root = document.getElementById('ggm-root');
  let built = false, shown = false, drawn = false, busy = Promise.resolve();
  let c1 = '', c2 = '', liveDiff = null;   /* liveDiff = camp1 - camp2 team gold from the live feed, used to sanity-check the recorded series' sign */
  const el = {};

  const mk = (tag, id, cls) => { const e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; return e; };
  const sv = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); Object.keys(attrs || {}).forEach(k => e.setAttribute(k, attrs[k])); return e; };

  function build() {
    if (built || !root) return; built = true;
    const bk = mk('img', 'ggm-backer'); bk.src = '/assets/overlay/MCT/ingame/mct_ingamegoldcurve_backer.png'; bk.alt = '';
    const ti = mk('div', 'ggm-title'); ti.textContent = 'REAL TIME GOLD GRAPH';
    const ic = mk('img', 'ggm-icon'); ic.src = '/assets/overlay/MCT/ingame/mct_ingamegoldcurve_goldicon.png'; ic.alt = '';
    const m1 = mk('div', 'ggm-mark1'), m2 = mk('div', 'ggm-mark2');
    const l1 = mk('img', 'ggm-logo1', 'ggm-logo'), l2 = mk('img', 'ggm-logo2', 'ggm-logo');
    [l1, l2].forEach(i => { i.alt = ''; i.style.display = 'none'; });
    const svg = sv('svg', { id: 'ggm-chart', viewBox: '610 748 701 309', width: 701, height: 309 });
    svg.innerHTML = `
      <defs>
        <linearGradient id="ggmPlotBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a9cb0" stop-opacity=".20"/><stop offset="1" stop-color="#2864e6" stop-opacity=".36"/></linearGradient>
        <linearGradient id="ggmLineGrad" gradientUnits="userSpaceOnUse" x1="0" y1="${PT}" x2="0" y2="${PT + PH}">
          <stop offset="0" stop-color="${CYAN}"/><stop offset="0.5" stop-color="${CYAN}"/><stop offset="0.5" stop-color="${YELLOW}"/><stop offset="1" stop-color="${YELLOW}"/>
        </linearGradient>
        <clipPath id="ggmClip"><rect x="${PL}" y="${PT}" width="${PW}" height="${PH}"/></clipPath>
      </defs>
      <rect id="ggm-plotbg" x="${PL}" y="${PT}" width="${PW}" height="${PH}" fill="url(#ggmPlotBg)"/>
      <g id="ggm-grid"></g>
      <line id="ggm-baseline" x1="${PL}" x2="${PL + PW}" y1="${BASE_Y}" y2="${BASE_Y}" stroke="#3f8cff" stroke-width="1.5"/>
      <path id="ggm-line" fill="none" stroke="url(#ggmLineGrad)" stroke-width="1.6" stroke-linejoin="round" clip-path="url(#ggmClip)"/>
      <g id="ggm-ylabels"></g><g id="ggm-xlabels"></g>`;
    [bk, svg, ti, ic, m1, m2, l1, l2].forEach(n => root.appendChild(n));
    Object.assign(el, { bk, ti, ic, m1, m2, l1, l2, svg, grid: svg.querySelector('#ggm-grid'), line: svg.querySelector('#ggm-line'),
                        yl: svg.querySelector('#ggm-ylabels'), xl: svg.querySelector('#ggm-xlabels') });
    /* static horizontal gridlines + y label slots */
    for (let i = 0; i <= ROWS; i++) {
      const y = PT + PH * i / ROWS;
      if (i > 0 && i < ROWS && i !== BASE_ROW) el.grid.appendChild(sv('line', { x1: PL, x2: PL + PW, y1: y, y2: y, stroke: 'rgba(80,140,255,.22)', 'stroke-width': 1 }));
      const t = sv('text', { class: 'ggm-ylab', x: PL - 7, y: y + 4.5, 'text-anchor': 'end' }); el.yl.appendChild(t);
    }
  }

  function niceStep(maxAbs) {
    const need = Math.max(maxAbs, 1) * 1.08 / 3;
    for (const s of [1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000]) if (s >= need) return s;
    return 100000;
  }

  /* series: [{t (s), diff}] — diff > 0 = camp 1 (top logo) ahead */
  function render(series) {
    if (!shown || !built || !series || !series.length) return;
    /* Sign guard: the recorded series (/positions log) says camp 1 - camp 2, but its camp ids can come out swapped relative to the live feed
       (seen in a real game: the graph went to team 2's side while team 1 was ahead on the scoreboard). The live team gold is the truth for
       "who is ahead right now"; when the newest recorded point is clearly the OPPOSITE of it (and the two are close in size), flip the series. */
    const last = series[series.length - 1].diff;
    if (liveDiff != null && Math.abs(last) > 1000 && Math.abs(liveDiff) > 1000 && Math.sign(last) !== Math.sign(liveDiff) && Math.abs(last + liveDiff) < Math.abs(last - liveDiff)) {
      series = series.map(p => ({ t: p.t, diff: -p.diff }));
    }
    const now = Math.max(series[series.length - 1].t, 60);   /* x-axis = 0 .. now (at least 1 min wide so the first marker has room) */
    let maxAbs = 0; series.forEach(p => { const a = Math.abs(p.diff); if (a > maxAbs) maxAbs = a; });
    const S = niceStep(maxAbs);
    const yOf = d => BASE_Y - (d / (3 * S)) * (PH / 2);
    const xOf = t => PL + (t / now) * PW;
    /* line (fixed sample count) */
    /* only draw where data was actually recorded: before the first sample ggcInterpolate would just repeat that value backwards as a flat
       line (the log can start mid-game, e.g. server restarted / page opened late) — that stretch is left empty instead of invented */
    const N = 200, pts = [], t0 = series[0].t;
    for (let i = 0; i < N; i++) {
      const t = (i / (N - 1)) * now;
      if (t < t0) continue;
      pts.push((pts.length ? 'L' : 'M') + xOf(t).toFixed(1) + ' ' + Math.max(PT, Math.min(PT + PH, yOf(ggcInterpolate(series, t)))).toFixed(1));
    }
    el.line.setAttribute('d', pts.join(''));
    /* y labels: 3S 2S S 0 S 2S 3S, symmetric around the baseline */
    Array.prototype.forEach.call(el.yl.children, (t, i) => { const k = Math.abs(BASE_ROW - i); t.textContent = k === 0 ? '0' : (k * S / 1000) + 'K'; });
    /* x: a vertical gridline + label every 5 min that the game has reached (plus "0") */
    el.xl.innerHTML = ''; el.grid.querySelectorAll('.ggm-vgrid').forEach(n => n.remove());
    const addX = (txt, x) => { const t = sv('text', { class: 'ggm-xlab', x: x + 4, y: 1039, 'text-anchor': 'middle' }); t.textContent = txt; el.xl.appendChild(t); };
    addX('0', PL);
    /* time markers are always there: the step grows with the game (1, 2, 5, 10 ... min) so there are never more than ~6 of them,
       and a marker appears as soon as the game reaches it ("0", "1 MIN", "2 MINS" ...) */
    const mins = now / 60;
    const step = [1, 2, 5, 10, 15, 20].find(st => mins / st <= 6) || 30;
    for (let m = step; m * 60 <= now + 0.5; m += step) {
      const x = xOf(m * 60);
      el.grid.appendChild(sv('line', { class: 'ggm-vgrid', x1: x, x2: x, y1: PT, y2: PT + PH, stroke: 'rgba(80,140,255,.22)', 'stroke-width': 1 }));
      addX(m + (m === 1 ? ' MIN' : ' MINS'), x);
    }
    if (!drawn) { drawn = true; drawLine(); }
  }
  function drawLine() {
    const len = el.line.getTotalLength ? el.line.getTotalLength() : 0;
    if (!len) return;
    el.line.style.strokeDasharray = len; el.line.style.strokeDashoffset = len;
    const an = el.line.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 750, delay: 250, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' });
    an.finished.then(() => { el.line.style.strokeDasharray = ''; el.line.style.strokeDashoffset = ''; an.cancel(); }).catch(() => {});
  }

  /* ── logos ── */
  const probe = src => new Promise(r => { const i = new Image(); i.onload = () => r(true); i.onerror = () => r(false); i.src = src; });
  const logoUrl = n => '/assets/team/logos/' + encodeURIComponent(String(n).toUpperCase()) + '.png';
  async function applyLogos() {
    if (!built) return;
    const [ok1, ok2] = await Promise.all([c1 ? probe(logoUrl(c1)) : false, c2 ? probe(logoUrl(c2)) : false]);
    let n1 = c1, n2 = c2, a = ok1, b = ok2;
    if (!ok1 && !ok2) {                                   /* neither game-API logo exists -> Match Board teams */
      try {
        const st = await (await fetch('/match/state', { cache: 'no-store' })).json();
        const sw = !!st.swapped, h = st.home || {}, w = st.away || {};
        n1 = (sw ? w : h).short; n2 = (sw ? h : w).short;
        [a, b] = await Promise.all([n1 ? probe(logoUrl(n1)) : false, n2 ? probe(logoUrl(n2)) : false]);
      } catch (e) {}
    }
    [[el.l1, n1, a], [el.l2, n2, b]].forEach(([img, n, ok]) => {
      if (ok && n) { img.src = logoUrl(n); img.style.display = ''; } else img.style.display = 'none';
    });
  }
  registerPollHandler(function (data) {
    const camps = data.camp_list || [];
    const a = camps.find(c => c.campid === 1), b = camps.find(c => c.campid === 2);
    if (a && b) {
      let g1 = 0, g2 = 0;
      for (let k = 1; k <= 5; k++) { g1 += (a['seat_' + k] && a['seat_' + k].gold) || 0; g2 += (b['seat_' + k] && b['seat_' + k].gold) || 0; }
      liveDiff = g1 - g2;
    }
    const n1 = a ? String(a.team_simple_name || '').toUpperCase() : '', n2 = b ? String(b.team_simple_name || '').toUpperCase() : '';
    if (n1 !== c1 || n2 !== c2) { c1 = n1; c2 = n2; applyLogos(); }
  });

  const q = fn => (busy = busy.then(fn, fn));
  function show() {
    build(); if (!root) return;
    shown = true; drawn = false;
    q(async () => {
      if (!shown) return;
      root.style.display = 'block';
      applyLogos();
      const parts = [el.bk, el.ti, el.ic, el.m1, el.m2, el.l1, el.l2, el.svg];
      await Promise.all(parts.map((e, i) => e.animate([{ transform: 'translateY(300px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
        { duration: 560, delay: i > 1 ? 40 : 0, easing: E, fill: 'both' }).finished.catch(() => {})));
      parts.forEach(e => e.getAnimations().forEach(a => a.cancel()));
    });
  }
  function hide() {
    shown = false;
    q(async () => {
      if (!root || root.style.display === 'none') return;
      const parts = [el.bk, el.ti, el.ic, el.m1, el.m2, el.l1, el.l2, el.svg];
      await Promise.all(parts.map(e => e.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(300px)', opacity: 0 }],
        { duration: 340, easing: 'cubic-bezier(.6,0,.9,.4)', fill: 'both' }).finished.catch(() => {})));
      if (!shown) root.style.display = 'none';
      parts.forEach(e => e.getAnimations().forEach(a => a.cancel()));
    });
  }
  return { show, hide, render };
})();
function ggmIsMct() { return document.documentElement.getAttribute('data-theme-name') === 'mct'; }
