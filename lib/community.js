// lib/community.js — Community Responses: the published Google Sheet (CSV) of viewer messages.
// getUrl() = saved link (data/community_responses_url.json) or the default; fetchRows() = fetch + parse -> {header, rows:[{timestamp,name,message}]}.
const fs = require('fs');
const path = require('path');
const COMMUNITY_URL_FILE = path.join(__dirname, '..', 'data', 'community_responses_url.json');
const COMMUNITY_URL_DEFAULT = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTKSPyWULZa0kkI5nTTGbBVrVuW-xpPJabvXtuWdv5_77Z3uh0LpT5DfbEpZeFj0O-dA3gl-1kJQQ68/pub?gid=533017059&single=true&output=csv';
function getUrl() {
  try { const u = String(JSON.parse(fs.readFileSync(COMMUNITY_URL_FILE, 'utf8')).url || '').trim(); if (u) return u; } catch {}
  return COMMUNITY_URL_DEFAULT;
}
function parseCsv(text) {                         // RFC-4180-ish: quoted fields, "" escapes, newlines inside quotes
  const rows = []; let row = [], cell = '', q = false;
  text = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}

async function fetchRows() {
  const r = await fetch(getUrl(), { signal: AbortSignal.timeout(8000), redirect: 'follow' });
  if (!r.ok) throw new Error(`sheet returned ${r.status}`);
  const all = parseCsv(await r.text());
  return { header: all[0] || [], rows: all.slice(1).map(c => ({ timestamp: c[0] || '', name: c[1] || '', message: c[2] || '' })) };
}

module.exports = { COMMUNITY_URL_FILE, COMMUNITY_URL_DEFAULT, getUrl, parseCsv, fetchRows };
