// lib/gameUrl.js — the Game (battledata) URL the poller / proxy read. In DEBUG API mode it is always the built-in self-hosted
// DiredudeAPI (lib/dire.js) — no URL to configure; in LIVE / WEB it is the saved URL for that mode.
const path = require('path');
const { getApiMode, readUrlForMode } = require('./apiMode');
const { PORT } = require('./config');

const GAME_URL_FILE = path.join(__dirname, '..', 'data', 'game_api_url.json');
const DIRE_GAME_URL = () => `http://127.0.0.1:${PORT}/dire/api/gamedata`;

const isSelfHosted = () => getApiMode() === 'debug';
function getGameUrl(fallback) {
  if (isSelfHosted()) return DIRE_GAME_URL();
  return String(readUrlForMode(GAME_URL_FILE, fallback || '') || '').trim();
}
module.exports = { getGameUrl, isSelfHosted, DIRE_GAME_URL, GAME_URL_FILE };
