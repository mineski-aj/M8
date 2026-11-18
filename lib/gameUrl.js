// lib/gameUrl.js — the Game (battledata) URL the poller / proxy read. Both API modes (LIVE and DEBUG) use the built-in self-hosted
// DiredudeAPI (lib/dire.js) — no URL to configure. LIVE = the judge's current battle (forced /refresh), DEBUG = adds the /debug loader.
const path = require('path');
const { readUrlForMode } = require('./apiMode');
const { PORT } = require('./config');

const GAME_URL_FILE = path.join(__dirname, '..', 'data', 'game_api_url.json');
const DIRE_GAME_URL = () => `http://127.0.0.1:${PORT}/dire/api/gamedata`;

const isSelfHosted = () => true;
function getGameUrl(fallback) {
  if (isSelfHosted()) return DIRE_GAME_URL();
  return String(readUrlForMode(GAME_URL_FILE, fallback || '') || '').trim();
}
module.exports = { getGameUrl, isSelfHosted, DIRE_GAME_URL, GAME_URL_FILE };
