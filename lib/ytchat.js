// lib/ytchat.js — YouTube live-chat bridge (ported from the standalone ytcomments app: /Users/.../Claude/ytcomments/ytserver.js).
// No API key: loads the watch page, finds the chat continuation token and polls YouTube's internal chat endpoint (unofficial —
// YouTube can change it any time). ONE server-side session feeds every page: each message / status change is broadcast over the
// shared overlay SSE stream as `event: ytchat` {t:'msg'|'status'|'info'|'reset'|'fatal'|'prefs', ...}, so the Live Comments tab and
// html/livecomments.html (the output) always show the same feed. Settings (font size, speed, photos, filter words, canvas size)
// persist in data/ytchat_prefs.json. Finished-stream chat download (yt-dlp) is served by routes/ytchat.js via handleReplay/handleDownload.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const state = require('./state');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const COOKIE = 'CONSENT=YES+cb; SOCS=CAI';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- helpers ----------
function videoId(input = '') {
  input = input.trim();
  if (/^[\w-]{11}$/.test(input)) return input;
  try {
    const u = new URL(input);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1, 12);
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/(live|embed|shorts)\/([\w-]{11})/);
    if (m) return m[2];
  } catch {}
  return null;
}

const plainOf = x => x?.simpleText ?? x?.runs?.map(r => r.text || r.emoji?.shortcuts?.[0] || r.emoji?.emojiId || '').join('') ?? '';
const fixUrl = u => (u && u.startsWith('//') ? 'https:' + u : u);
const lastThumb = t => fixUrl(t?.thumbnails?.[t.thumbnails.length - 1]?.url);

// Convert YouTube message runs into plain text plus a list of text / custom-emoji parts.
function parseRuns(msg) {
  const runs = [];
  for (const r of msg?.runs || []) {
    if (r.text != null) {
      pushText(runs, r.text);
    } else if (r.emoji) {
      const e = r.emoji;
      if (e.isCustomEmoji) runs.push({ img: lastThumb(e.image), alt: e.shortcuts?.[0] || '' });
      else pushText(runs, e.emojiId || e.shortcuts?.[0] || '');
    }
  }
  const text = runs.map(r => (typeof r === 'string' ? r : r.alt)).join('') || plainOf(msg);
  return { text, runs };
}
function pushText(runs, s) {
  if (typeof runs[runs.length - 1] === 'string') runs[runs.length - 1] += s;
  else runs.push(s);
}

// YouTube colours are ARGB integers. Return css colour plus a readable ink colour.
function argb(n, fallback) {
  if (n == null) return fallback;
  const c = Number(n) >>> 0;
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return { color: `rgb(${r}, ${g}, ${b})`, ink: lum > 0.6 ? '#17131f' : '#ffffff' };
}

function badges(r) {
  const out = {};
  for (const b of r.authorBadges || []) {
    const br = b.liveChatAuthorBadgeRenderer;
    if (!br) continue;
    const icon = br.icon?.iconType;
    if (icon === 'OWNER') out.owner = true;
    else if (icon === 'MODERATOR') out.mod = true;
    else if (br.customThumbnail) out.member = true;
  }
  return out;
}

function toMsg(item) {
  const T = item.liveChatTextMessageRenderer;
  const P = item.liveChatPaidMessageRenderer;
  const S = item.liveChatPaidStickerRenderer;
  const M = item.liveChatMembershipItemRenderer;
  const G = item.liveChatSponsorshipsGiftPurchaseAnnouncementRenderer;
  const r = T || P || S || M || G;
  if (!r) return null;

  const gh = G?.header?.liveChatSponsorshipsHeaderRenderer;
  const base = {
    id: r.id,
    author: plainOf(r.authorName || gh?.authorName) || 'Someone',
    avatarUrl: lastThumb(r.authorPhoto || gh?.authorPhoto),
    time: Math.round(Number(r.timestampUsec) / 1000) || Date.now(),
    ...badges(r)
  };

  if (T) return { ...base, type: 'text', ...parseRuns(T.message) };

  if (P) {
    const style = argb(P.bodyBackgroundColor, { color: '#8fc9ff', ink: '#17131f' });
    return { ...base, type: 'paid', kind: 'Super Chat', amount: plainOf(P.purchaseAmountText), ...style, ...parseRuns(P.message) };
  }
  if (S) {
    const style = argb(S.moneyChipBackgroundColor ?? S.backgroundColor, { color: '#8fc9ff', ink: '#17131f' });
    return { ...base, type: 'paid', kind: 'Super Sticker', amount: plainOf(S.purchaseAmountText), ...style, text: '', runs: [] };
  }
  if (M) {
    const kind = plainOf(M.headerPrimaryText) || plainOf(M.headerSubtext) || 'New member';
    return { ...base, type: 'member', kind, ...parseRuns(M.message) };
  }
  // gift purchase announcement
  return { ...base, type: 'member', kind: plainOf(gh?.primaryText) || 'Gifted memberships', text: '', runs: [] };
}

// ---------- talking to YouTube ----------
async function loadWatchPage(id) {
  const res = await fetch(`https://www.youtube.com/watch?v=${id}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: COOKIE }
  });
  if (!res.ok) throw new Error(`YouTube returned status ${res.status} for the video page.`);
  const html = await res.text();

  const apiKey = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(html)?.[1];
  const clientVersion = /"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/.exec(html)?.[1] || '2.20240101.00.00';
  const raw = /ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s.exec(html)?.[1];
  if (!apiKey || !raw) throw new Error('Could not read the video page. YouTube may be showing a consent or bot check.');

  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('Could not parse the video page data.'); }

  const primary = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents?.find(c => c.videoPrimaryInfoRenderer)?.videoPrimaryInfoRenderer;
  const title = plainOf(primary?.title) || /<meta name="title" content="([^"]*)"/.exec(html)?.[1] || 'Live stream';

  const chat = data?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer;
  if (!chat) throw new Error('No live chat found. The video may not be live, chat may be off, or it may be members-only.');
  if (chat.isReplay) throw new Error('This stream has ended, so there is no live chat to follow.');

  const menu = chat.header?.liveChatHeaderRenderer?.viewSelector?.sortFilterSubMenuRenderer?.subMenuItems;
  const liveItem = menu?.find(i => /^live chat$/i.test(i.title || ''));
  // The top-level token is the one YouTube accepts now; the menu tokens return 400.
  const continuation =
    chat.continuations?.[0]?.reloadContinuationData?.continuation ||
    liveItem?.continuation?.reloadContinuationData?.continuation;
  if (!continuation) throw new Error('Could not find the chat token on the page.');

  return { apiKey, clientVersion, continuation, title };
}

async function fetchChat({ apiKey, clientVersion }, continuation) {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${apiKey}&prettyPrint=false`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Cookie: COOKIE, Origin: 'https://www.youtube.com' },
    body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: 'US' } }, continuation })
  });
  if (!res.ok) throw new Error(`Chat request failed with status ${res.status}`);
  const json = await res.json();
  const lc = json?.continuationContents?.liveChatContinuation;
  if (!lc) return { ended: true, msgs: [] };

  const c = lc.continuations?.[0];
  const d = c?.invalidationContinuationData || c?.timedContinuationData || c?.reloadContinuationData;
  const msgs = (lc.actions || [])
    .map(a => a.addChatItemAction?.item)
    .filter(Boolean)
    .map(toMsg)
    .filter(Boolean);

  return { ended: !d?.continuation, next: d?.continuation, timeout: d?.timeoutMs, msgs };
}

// ---------- finished streams (chat replay via yt-dlp) ----------
// Parse yt-dlp's .live_chat.json (one JSON object per line) into messages with a video offset.
function parseReplay(text) {
  const out = [], seen = new Set();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const r = o.replayChatItemAction;
    if (!r) continue;
    const offsetMs = Number(r.videoOffsetTimeMsec) || 0;
    for (const a of r.actions || []) {
      const item = a.addChatItemAction?.item;
      const m = item && toMsg(item);
      if (!m || seen.has(m.id)) continue;
      seen.add(m.id);
      out.push({ ...m, offsetMs });
    }
  }
  return out.sort((a, b) => a.offsetMs - b.offsetMs);
}

const videoClock = ms => {
  const neg = ms < 0, s = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (neg ? '-' : '') + (h ? `${h}:${String(m).padStart(2, '0')}` : m) + ':' + String(x).padStart(2, '0');
};
const badgeOf = m => ['owner', 'mod', 'member'].filter(k => m[k]).join('+');
const bodyOf = m => m.text || m.kind || '';
// Stop spreadsheets from running a message that starts with = + - as a formula.
const csvCell = v => {
  let s = String(v ?? '');
  if (/^[=+\-\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};
function toCsv(msgs) {
  const rows = [['video_time', 'offset_ms', 'wall_time', 'author', 'type', 'amount', 'badges', 'message']];
  for (const m of msgs) rows.push([videoClock(m.offsetMs), m.offsetMs, new Date(m.time).toISOString(), m.author, m.type, m.amount || '', badgeOf(m), bodyOf(m)]);
  return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}
function toTxt(msgs) {
  return msgs.map(m => `[${videoClock(m.offsetMs)}] ${m.author}${m.amount ? ` (${m.kind} ${m.amount})` : ''}: ${bodyOf(m)}`).join('\n');
}
function toJson(title, id, msgs) {
  return JSON.stringify({ videoId: id, title, count: msgs.length, messages: msgs.map(m => ({
    videoTime: videoClock(m.offsetMs), offsetMs: m.offsetMs, wallTime: new Date(m.time).toISOString(),
    author: m.author, type: m.type, kind: m.kind, amount: m.amount, badges: badgeOf(m), message: bodyOf(m), id: m.id
  })) }, null, 2);
}

const replays = new Map();   // videoId -> { title, msgs }, kept in memory for downloads
// Child environment for yt-dlp. Works on macOS, Linux and Windows:
// - the PATH variable is "Path" on Windows, so find its real name instead of adding a second one
// - add the usual Homebrew locations on Mac (apps started outside a terminal often lack them)
// - force UTF-8 so emoji in titles and messages survive on Windows consoles
const YTDLP_ENV = (() => {
  const env = Object.assign({}, process.env);
  const key = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
  const extra = process.platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin'] : [];
  env[key] = [env[key], ...extra].filter(Boolean).join(path.delimiter);
  env.PYTHONIOENCODING = 'utf-8';
  env.PYTHONUTF8 = '1';
  return env;
})();
const INSTALL_HINT = process.platform === 'win32'
  ? 'yt-dlp is not installed or not on PATH. In PowerShell run: winget install yt-dlp   (or: py -m pip install -U yt-dlp). Then restart this server.'
  : 'yt-dlp is not installed. Run: brew install yt-dlp   (or: python3 -m pip install -U yt-dlp)';

function handleReplay(req, res, url) {
  const id = videoId(url.searchParams.get('v') || '');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'
  });
  const send = (ev, data) => { if (!res.writableEnded) res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); };
  const fail = text => { send('fatal', { text }); send('done', {}); res.end(); };
  if (!id) return fail('That does not look like a YouTube link.');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytchat-'));
  // Windows keeps files locked briefly after a process exits, so retry the delete.
  const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} };
  const sizeNow = () => { try { return fs.readdirSync(dir).reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0); } catch { return 0; } };

  send('status', { text: 'Starting yt-dlp…' });
  const child = spawn('yt-dlp', [
    '--no-playlist', '--skip-download', '--write-subs', '--sub-langs', 'live_chat',
    '--print-to-file', '%(title)s', path.join(dir, 'title.txt'),
    '-o', path.join(dir, '%(id)s.%(ext)s'),
    `https://www.youtube.com/watch?v=${id}`
  ], { env: YTDLP_ENV });

  let errTail = '', finished = false;
  child.stderr.on('data', d => { errTail = (errTail + d).slice(-800); });
  child.stdout.on('data', d => {
    const line = String(d).trim().split('\n').pop();
    if (line) send('status', { text: line.slice(0, 140) });
  });
  const tick = setInterval(() => send('progress', { bytes: sizeNow() }), 1000);
  const beat = setInterval(() => res.write(': keep-alive\n\n'), 15000);
  const stop = () => { clearInterval(tick); clearInterval(beat); };

  req.on('close', () => { if (!finished) { child.kill('SIGTERM'); } stop(); cleanup(); });

  child.on('error', e => {
    finished = true; stop(); cleanup();
    fail(e.code === 'ENOENT' ? INSTALL_HINT : 'Could not start yt-dlp: ' + e.message);
  });
  child.on('close', code => {
    if (finished) return;
    finished = true; stop();
    try {
      const file = fs.readdirSync(dir).find(f => f.endsWith('.live_chat.json'));
      if (!file) {
        const why = /private|members|unavailable|sign in/i.test(errTail) ? ' The video may be private or members-only.' : '';
        return fail(`No chat replay found (yt-dlp exit ${code}).${why} ${errTail.trim().split('\n').pop() || ''}`.trim());
      }
      send('status', { text: 'Parsing chat…' });
      const msgs = parseReplay(fs.readFileSync(path.join(dir, file), 'utf8'));
      let title = id;
      try { title = fs.readFileSync(path.join(dir, 'title.txt'), 'utf8').trim() || id; } catch {}
      replays.set(id, { title, msgs });

      const users = new Map();
      let paid = 0;
      for (const m of msgs) { users.set(m.author, (users.get(m.author) || 0) + 1); if (m.type !== 'text') paid++; }
      const top = [...users.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      send('result', {
        id, title, count: msgs.length, chatters: users.size, paid, top,
        durationMs: msgs.length ? msgs[msgs.length - 1].offsetMs : 0,
        preview: msgs.slice(0, 80).map(m => ({ t: videoClock(m.offsetMs), author: m.author, text: bodyOf(m), amount: m.amount || '' }))
      });
      send('done', {}); res.end();
    } catch (e) { fail('Could not read the chat file: ' + e.message); }
    finally { cleanup(); }
  });
}

function handleDownload(res, url) {
  const id = videoId(url.searchParams.get('v') || '');
  const fmt = url.searchParams.get('fmt');
  const r = id && replays.get(id);
  if (!r) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Nothing loaded for that video. Download the chat first.'); }
  const types = { csv: ['text/csv; charset=utf-8', toCsv(r.msgs)], json: ['application/json; charset=utf-8', toJson(r.title, id, r.msgs)], txt: ['text/plain; charset=utf-8', toTxt(r.msgs)] };
  if (!types[fmt]) { res.writeHead(400); return res.end('Unknown format'); }
  res.writeHead(200, { 'Content-Type': types[fmt][0], 'Content-Disposition': `attachment; filename="chat-${id}.${fmt}"` });
  res.end(types[fmt][1]);
}


// ---------- shared session (one YouTube feed for every page) ----------
const PREFS_FILE = path.join(__dirname, '..', 'data', 'ytchat_prefs.json');
const PREF_DEFAULTS = { fs: 15, speed: 5, photos: true, words: [], width: 480, height: 900, bg: 'solid' };
const clamp = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d; };
function cleanPrefs(p) {
  p = p || {};
  return {
    fs: clamp(p.fs, 12, 60, PREF_DEFAULTS.fs),
    speed: clamp(p.speed, 1, 10, PREF_DEFAULTS.speed),
    photos: p.photos !== false,
    words: Array.isArray(p.words) ? [...new Set(p.words.map(w => String(w).trim().toLowerCase()).filter(Boolean))].slice(0, 100) : [],
    width: clamp(p.width, 120, 3840, PREF_DEFAULTS.width),
    height: clamp(p.height, 120, 2160, PREF_DEFAULTS.height),
    bg: p.bg === 'transparent' ? 'transparent' : 'solid'
  };
}
let prefs = cleanPrefs((() => { try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); } catch { return {}; } })());

const S = { token: 0, source: null, videoId: null, title: 'Live comments', status: { text: 'Not connected', live: false }, backlog: [] };
const BACKLOG = 150;

function broadcast(payload) {
  const line = 'event: ytchat\ndata: ' + JSON.stringify(payload) + '\n\n';
  state.overlayClients.forEach(c => { try { c.write(line); } catch {} });
}
function setStatus(text, live) { S.status = { text, live: !!live }; broadcast({ t: 'status', ...S.status }); }
function emitMsg(m) {
  S.backlog.push(m);
  if (S.backlog.length > BACKLOG) S.backlog.shift();
  broadcast({ t: 'msg', m });
}
function resetFeed(source, title) {
  S.backlog = []; S.source = source; S.title = title || 'Live comments';
  broadcast({ t: 'reset' });
  broadcast({ t: 'info', title: S.title });
}

function snapshot() {
  return { prefs, status: S.status, title: S.title, source: S.source, videoId: S.videoId, backlog: S.backlog };
}
function getPrefs() { return prefs; }
function setPrefs(patch) {
  prefs = cleanPrefs(Object.assign({}, prefs, patch || {}));
  try { fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2)); } catch (e) { console.warn('[ytchat] could not save prefs:', e.message); }
  broadcast({ t: 'prefs', prefs });
  return prefs;
}

function stop() { S.token++; S.source = null; S.videoId = null; }
function disconnect() { stop(); setStatus('Not connected', false); broadcast({ t: 'info', title: 'Live comments' }); S.title = 'Live comments'; }

async function connect(input) {
  const id = videoId(input);
  if (!id) throw new Error('That does not look like a YouTube link.');
  stop();
  const my = S.token;
  S.videoId = id;
  resetFeed('youtube', 'Live comments');
  setStatus('Looking up stream…', false);
  (async () => {
    let ctx;
    try { ctx = await loadWatchPage(id); }
    catch (e) { if (my === S.token) { broadcast({ t: 'fatal', text: e.message }); setStatus(e.message, false); } return; }
    if (my !== S.token) return;
    S.title = ctx.title; broadcast({ t: 'info', title: ctx.title });
    setStatus('Live', true);
    console.log(`[ytchat ${id}] connected: ${ctx.title}`);
    let continuation = ctx.continuation, fails = 0;
    while (my === S.token) {
      try {
        const r = await fetchChat(ctx, continuation);
        fails = 0;
        if (my !== S.token) return;
        r.msgs.forEach(emitMsg);
        if (r.ended) { setStatus('Chat ended', false); return; }
        continuation = r.next;
        setStatus('Live', true);
        await sleep(Math.min(Math.max(r.timeout || 1500, 700), 2000));
      } catch (e) {
        if (++fails > 5) { if (my === S.token) { broadcast({ t: 'fatal', text: 'Lost connection to YouTube: ' + e.message }); setStatus('Lost connection to YouTube', false); } return; }
        if (my === S.token) setStatus(`Connection problem, retrying (${fails}/5)`, false);
        await sleep(3000 * fails);
      }
    }
  })();
}

// ---------- demo source (simulated chat, for previewing the layout) ----------
const demoNames = ['mika_plays', 'Dr. Toast', 'nightowl88', '@sunny.side', 'Ferdie', 'kuya_bong', 'Lala 🌸', 'pixelpete', 'tita_marites', 'Ravenclaw_Rey', 'jomar', 'coffee_addict', 'Ate Cha'];
const demoLines = [
  'HELLO from Manila!', 'this is so good', 'lol 😂', 'first time here, what did I miss?', 'can you turn up the music a bit',
  'clip that!!', 'GG', 'who else is here since the start?', 'audio is perfect now', 'brb getting snacks',
  'haha no way', 'W stream', 'can we get a wave in chat 👋', 'that transition was smooth', 'reading chat from work 🤫', "let's gooooo"
];
function startDemo() {
  stop();
  const my = S.token;
  resetFeed('demo', 'Demo stream');
  setStatus('Demo mode (simulated)', true);
  let n = 0;
  const tick = () => {
    if (my !== S.token) return;
    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const author = demoNames[Math.floor(Math.random() * demoNames.length)];
      const roll = Math.random();
      const base = { id: 'd' + Date.now() + '_' + (n++), author, time: Date.now(), mod: author === 'Dr. Toast', owner: author === 'Ferdie', member: author === 'Lala 🌸' };
      if (roll < 0.06) emitMsg({ ...base, type: 'paid', kind: 'Super Chat', amount: '₱' + [100, 250, 500, 1000][Math.floor(Math.random() * 4)], text: 'Keep it up, love the show!', runs: ['Keep it up, love the show!'] });
      else if (roll < 0.09) emitMsg({ ...base, type: 'member', kind: 'Joined as a member', text: '', runs: [] });
      else { const t = demoLines[Math.floor(Math.random() * demoLines.length)]; emitMsg({ ...base, type: 'text', text: t, runs: [t] }); }
    }
    setTimeout(tick, 500 + Math.random() * 1400);
  };
  tick();
}

module.exports = { toMsg, videoId, parseReplay, toCsv, toTxt, toJson, handleReplay, handleDownload, connect, disconnect, startDemo, snapshot, getPrefs, setPrefs };
