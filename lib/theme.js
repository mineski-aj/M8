// lib/theme.js — shared accessor for the global broadcast theme
// (M8 = 'playoffs' / MCT). Backs routes/devapi.js's
// GET/POST /api/theme AND routes/overlayStyles.js's theme-scoped
// overrides — both must agree on what "the current theme" is.
const fs   = require('fs');
const path = require('path');

const THEME_FILE    = path.join(__dirname, '..', 'data', 'theme.json');
const THEME_DEFAULT = 'playoffs';
/* 'playoffs' is the M8 theme (internal key kept so saved layouts / the playoffs asset folders keep working); 'mct' starts as a clone of it. */
const THEME_VALID   = ['playoffs', 'mct'];

function getTheme() {
  try {
    const raw = JSON.parse(fs.readFileSync(THEME_FILE, 'utf8'));
    return THEME_VALID.includes(raw.theme) ? raw.theme : THEME_DEFAULT;
  } catch (e) {
    return THEME_DEFAULT;
  }
}

function setTheme(theme) {
  const t = THEME_VALID.includes(theme) ? theme : THEME_DEFAULT;
  fs.writeFileSync(THEME_FILE, JSON.stringify({ theme: t }));
  return t;
}

module.exports = { getTheme, setTheme, THEME_DEFAULT, THEME_VALID };
