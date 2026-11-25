// lib/audienceComment.js — Audience Comment lower third: rolls through the Community Responses sheet.
// While the lower third is on air the server owns the cursor (so the Control preview and every browser source agree):
//   show  -> jump to "Start from line" and roll; every `seconds` the next response goes out (wraps back to the start line after the last).
//   the sheet is re-read every few seconds — new rows are simply appended, the cursor is NEVER reset by a sheet update.
// Each change is broadcast over the shared overlay SSE as `event: lowerthird` {name:'audiencecomment', action:'line', row, index, total}.
// Settings (data/audience_comment.json): startLine (1 = first response, i.e. sheet row 2), seconds per comment.
const fs = require('fs');
const path = require('path');
const state = require('./state');
const community = require('./community');

const FILE = path.join(__dirname, '..', 'data', 'audience_comment.json');
const clampInt = (v, lo, hi, d) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
let settings = (() => {
  let s = {}; try { s = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  return { startLine: clampInt(s.startLine, 1, 100000, 1), seconds: clampInt(s.seconds, 2, 600, 8) };
})();

const S = { active: false, rows: [], index: 0, rollTimer: null, pollTimer: null, last: '' };

function broadcast(payload) {
  const line = 'event: lowerthird\ndata: ' + JSON.stringify(Object.assign({ name: 'audiencecomment' }, payload)) + '\n\n';
  state.overlayClients.forEach(c => { try { c.write(line); } catch {} });
}
const startIdx = () => Math.min(Math.max(0, settings.startLine - 1), Math.max(0, S.rows.length - 1));
function current() { return S.rows[S.index] || null; }
function snapshot() { return { settings, active: S.active, index: S.index, line: S.index + 1, total: S.rows.length, row: current() }; }

function emit(force) {
  const row = current();
  const sig = row ? S.index + '|' + row.name + '|' + row.message : '';
  if (!force && sig === S.last) return;
  S.last = sig;
  broadcast({ action: 'line', row, index: S.index, line: S.index + 1, total: S.rows.length });
}
async function refresh() {
  try { S.rows = (await community.fetchRows()).rows; } catch (e) { /* keep the last good rows */ }
  if (S.index >= S.rows.length) S.index = startIdx();
}
function advance() {
  if (!S.active) return;
  if (S.rows.length) {
    S.index++;
    if (S.index >= S.rows.length) S.index = startIdx();      // keep rolling: wrap to the start line
  }
  emit(false);
}
function scheduleRoll() {
  clearInterval(S.rollTimer);
  S.rollTimer = setInterval(advance, settings.seconds * 1000);
}

async function start() {
  stop(false);
  S.active = true; S.last = '';
  await refresh();
  if (!S.active) return;
  S.index = startIdx();
  emit(true);
  scheduleRoll();
  S.pollTimer = setInterval(async () => { await refresh(); emit(false); }, 8000);   // new rows join the rotation; the cursor stays put
}
function stop(announce) {
  S.active = false;
  clearInterval(S.rollTimer); clearInterval(S.pollTimer); S.rollTimer = S.pollTimer = null;
  if (announce !== false) S.last = '';
}
function setSettings(p) {
  const prevStart = settings.startLine;
  settings = { startLine: clampInt(p.startLine != null ? p.startLine : settings.startLine, 1, 100000, settings.startLine),
               seconds: clampInt(p.seconds != null ? p.seconds : settings.seconds, 2, 600, settings.seconds) };
  try { fs.writeFileSync(FILE, JSON.stringify(settings, null, 2)); } catch (e) { console.warn('[audience] could not save settings:', e.message); }
  if (S.active) {
    scheduleRoll();                                           // new seconds apply immediately
    if (settings.startLine !== prevStart) { S.index = startIdx(); emit(true); }   // new start line: jump there and roll on
  }
  return settings;
}

module.exports = { start, stop, setSettings, snapshot };
