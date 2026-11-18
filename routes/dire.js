// routes/dire.js — DiredudeAPI built in (see lib/dire.js). Mounted at /dire, so this is /dire/api/*:
//   GET /dire/api/gamedata   the cached battle in enriched seat_N format (what the game poller reads in DEBUG mode)
//   GET /dire/api/refresh    judge's current battle -> restart polling            (dashboard "Refresh" button)
//   GET /dire/api/debug      random battle of the last 24h whose draft has just started (scans until found) of the last 24h -> restart polling (dashboard "Debug" button; 403 unless API Mode = DEBUG)
//   POST /dire/api/judge     { judgeId } — change the judge ID used by Refresh (saved in data/dire_config.json)
//   GET /dire/api/status     { running, isDebug, battleId, lastUpdated, lastError, ... }
//   GET /dire/api/battledata the raw upstream payload (for inspecting)
const express = require('express');
const router  = express.Router();
const dire    = require('../lib/dire');
const { getApiMode } = require('../lib/apiMode');

const noStore = (res) => res.set('Cache-Control', 'no-store');
const fail = (res, e) => noStore(res).status(e.status || 502).json({ success: false, error: (e.response && e.response.data && JSON.stringify(e.response.data).slice(0, 300)) || e.message });

router.get('/dire/api/gamedata', (req, res) => {
  const json = dire.getGameDataJson();
  if (!json) return noStore(res).status(503).json({ success: false, error: 'No battle loaded yet — press Refresh in Settings → API Mode', status: dire.status() });
  noStore(res).type('application/json').send(json);
});
router.get('/dire/api/battledata', (req, res) => {
  const raw = dire.getRaw();
  if (!raw) return noStore(res).status(503).json({ success: false, error: 'No battle loaded yet' });
  noStore(res).json(raw);
});
// Judge ID the Refresh button asks for: POST { judgeId } (digits). Applies on the next Refresh.
router.post('/dire/api/judge', (req, res) => {
  try { const judgeId = dire.setJudgeId((req.body || {}).judgeId); noStore(res).json({ success: true, judgeId }); }
  catch (e) { fail(res, e); }
});
router.get('/dire/api/status', (req, res) => noStore(res).json(dire.status()));
router.get('/dire/api/refresh', async (req, res) => { try { noStore(res).json({ success: true, data: await dire.refresh() }); } catch (e) { fail(res, e); } });
router.get('/dire/api/debug',   async (req, res) => { if (getApiMode() !== 'debug') return noStore(res).status(403).json({ success: false, error: 'Debug loader is only available in API Mode DEBUG' }); try { noStore(res).json({ success: true, data: await dire.debug() }); }   catch (e) { fail(res, e); } });

module.exports = router;
