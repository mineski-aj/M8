// Server mode: MAIN (default) or REBROADCAST. Persisted in data/server_mode.json.
// Other modules call getMode() / isRebroadcast() to switch behaviour per mode.
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data', 'server_mode.json');
const MODES = ['MAIN', 'REBROADCAST'];

function getMode() {
  try { const m = String(JSON.parse(fs.readFileSync(FILE, 'utf8')).mode || '').toUpperCase(); return MODES.includes(m) ? m : 'MAIN'; }
  catch { return 'MAIN'; }
}
function setMode(mode) {
  const m = String(mode || '').toUpperCase();
  if (!MODES.includes(m)) return null;
  fs.writeFileSync(FILE, JSON.stringify({ mode: m }));
  return m;
}
const isRebroadcast = () => getMode() === 'REBROADCAST';

module.exports = { MODES, getMode, setMode, isRebroadcast };
