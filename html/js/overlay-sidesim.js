/* ── Debug-bar "SIDE CHECK" tab — simulate stat changes / overtakes ─────────
   Adds offsets to every seat's total_damage / gold (the stats the Players
   Damage / Players Gold side checks rank by). overlay-core.js calls
   SideSim.apply(data) on each fetched feed, so the offsets survive polling;
   the buttons also re-apply to lastData and re-run the poll handlers so the
   panel reacts immediately. Debug-bar only (` key) — never touches the server. */
window.SideSim = (function () {
  var FIELDS = { total_damage: 'DAMAGE', gold: 'GOLD' };
  var offsets = {};                       /* 'c1s3' -> { total_damage: n, gold: n } */
  var field = 'total_damage';
  function seatsOf(data) {
    var out = [];
    ((data && data.camp_list) || []).forEach(function (c) {
      if (c.campid !== 1 && c.campid !== 2) return;
      for (var s = 1; s <= 5; s++) if (c['seat_' + s]) out.push({ key: 'c' + c.campid + 's' + s, seat: c['seat_' + s] });
    });
    return out;
  }
  function apply(data) {
    seatsOf(data).forEach(function (e) {
      Object.keys(FIELDS).forEach(function (f) {
        var rk = '__real_' + f;
        if (!(rk in e.seat)) e.seat[rk] = e.seat[f] || 0;
        var o = offsets[e.key] && offsets[e.key][f];
        e.seat[f] = e.seat[rk] + (o || 0);
      });
    });
    return data;
  }
  function push() {
    if (!lastData) return;
    apply(lastData);
    pollHandlers.forEach(function (fn) { try { fn(lastData); } catch (e) {} });
    render();
  }
  function bump(key, d) { var o = offsets[key] || (offsets[key] = {}); o[field] = (o[field] || 0) + d; push(); }
  function ranked() {
    return seatsOf(lastData).sort(function (a, b) { return (b.seat[field] || 0) - (a.seat[field] || 0); });
  }
  function overtakeFirst() {          /* last place jumps just past the leader */
    var r = ranked(); if (r.length < 2) return;
    var last = r[r.length - 1], lead = r[0];
    bump(last.key, (lead.seat[field] || 0) - (last.seat[field] || 0) + 500);
  }
  function shuffle() {
    var base = 3000 + Math.random() * 6000;
    seatsOf(lastData).forEach(function (e) {
      var o = offsets[e.key] || (offsets[e.key] = {});
      o[field] = Math.round(Math.random() * base) - (e.seat['__real_' + field] || 0);
    });
    push();
  }
  function reset() { offsets = {}; push(); }

  var host;
  function render() {
    if (!host) return;
    host.innerHTML = '';
    var top = document.createElement('div'); top.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;';
    Object.keys(FIELDS).forEach(function (f) {
      top.appendChild(btn(FIELDS[f], function () { field = f; render(); }, f === field));
    });
    top.appendChild(btn('⇧ LAST OVERTAKES #1', overtakeFirst));
    top.appendChild(btn('⇄ SHUFFLE', shuffle));
    top.appendChild(btn('↺ RESET', reset));
    host.appendChild(top);
    var list = document.createElement('div'); list.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:4px 14px;';
    ranked().forEach(function (e, i) {
      var row = document.createElement('div'); row.style.cssText = 'display:flex;gap:4px;align-items:center;font-size:11px;';
      var lab = document.createElement('span'); lab.style.cssText = 'flex:1;min-width:0;overflow:hidden;white-space:nowrap;';
      lab.textContent = '#' + (i + 1) + ' ' + (e.key[1] === '1' ? 'BLUE' : 'RED') + ' ' + (e.seat.name || ('seat ' + e.key.slice(-1))) + ' — ' + Math.round(e.seat[field] || 0);
      row.appendChild(lab);
      [-2000, -500, 500, 2000].forEach(function (d) { row.appendChild(btn((d > 0 ? '+' : '') + d, function () { bump(e.key, d); })); });
      list.appendChild(row);
    });
    host.appendChild(list);
    if (!lastData) host.appendChild(document.createTextNode('waiting for feed data…'));
  }
  function btn(t, fn, on) {
    var b = document.createElement('button'); b.className = 'debug-btn'; b.textContent = t;
    if (on) b.style.outline = '2px solid #43fff0';
    b.style.padding = '2px 6px'; b.addEventListener('click', fn); return b;
  }
  document.addEventListener('DOMContentLoaded', function () { host = document.getElementById('sidesim-ui'); render(); });
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('.tab-btn');
    if (t && t.dataset.tab === 'sidesim') render();
  });
  return { apply: apply, push: push, reset: reset };
})();
