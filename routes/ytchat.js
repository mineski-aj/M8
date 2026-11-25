// routes/ytchat.js — Live Comments (YouTube chat) API. Logic lives in lib/ytchat.js.
//   GET  /ytchat/state                 prefs + status + title + recent messages (pages restore from this, then follow SSE `ytchat`)
//   POST /ytchat/connect {url}         follow a live stream's chat
//   POST /ytchat/demo                  simulated chat (layout preview)
//   POST /ytchat/disconnect
//   POST /ytchat/prefs {fs,speed,photos,words,width,height,bg}   (partial ok)
//   GET  /ytchat/replay?v=<url|id>     SSE: download a finished stream's chat (needs yt-dlp)
//   GET  /ytchat/replay/download?v=&fmt=csv|txt|json
const express = require('express');
const yt = require('../lib/ytchat');
const router = express.Router();

router.get('/ytchat/state', (req, res) => res.set('Cache-Control', 'no-store').json(yt.snapshot()));

router.post('/ytchat/connect', async (req, res) => {
  try { await yt.connect((req.body || {}).url || ''); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.post('/ytchat/demo', (req, res) => { yt.startDemo(); res.json({ ok: true }); });
router.post('/ytchat/disconnect', (req, res) => { yt.disconnect(); res.json({ ok: true }); });
router.post('/ytchat/prefs', (req, res) => res.json({ ok: true, prefs: yt.setPrefs(req.body || {}) }));

router.get('/ytchat/replay', (req, res) => yt.handleReplay(req, res, new URL(req.originalUrl, 'http://localhost')));
router.get('/ytchat/replay/download', (req, res) => yt.handleDownload(res, new URL(req.originalUrl, 'http://localhost')));

module.exports = router;
