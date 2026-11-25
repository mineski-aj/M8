// lib/turtlePit.js — "Perfect Turtle" inference.
// The feed has no boss HP / attacker list, so a perfect turtle (the whole fight done by one team, the other team never contesting it) is inferred.
// The turtle spawns at a RANDOM one of two pits (top / bottom river), so the pit is not hard-coded: at the moment the turtle dies the KILLER's map
// position is the pit. Then, over the last few seconds before the death, it is NOT perfect if either
//   (a) an alive hero of the OTHER team stood within `enemyRadius` of that pit, or
//   (b) any player (either team) within `hurtRadius` of the pit took damage (total_hurt rose) — a hero-vs-hero fight at the pit.
// Tunables in data/turtle_pit.json: { windowS, enemyRadius, hurtRadius }  (map_pos units; windowS = look-back seconds).
const fs   = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data', 'turtle_pit.json');
const DEFAULTS = { windowS: 8, enemyRadius: 10, hurtRadius: 9 };
let cfg = Object.assign({}, DEFAULTS);
try { cfg = Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) {}

let prevHurt = {};     // "camp_seat" -> last total_hurt
let samples = [];      // { t, camp, who, x, y, dead, hurtUp } — one per player per game second, last ~40 s
let lastBattle = null;

function reset() { prevHurt = {}; samples = []; }

// call once per game second while playing
function sample(camps, gameTimeS, battleId) {
  if (battleId !== lastBattle) { lastBattle = battleId; reset(); }
  for (const camp of camps) {
    if (camp.campid !== 1 && camp.campid !== 2) continue;
    for (let s = 1; s <= 5; s++) {
      const seat = camp['seat_' + s];
      if (!seat) continue;
      const key = camp.campid + '_' + s;
      const hurt = Number(seat.total_hurt) || 0;
      const prev = prevHurt[key];
      prevHurt[key] = hurt;
      const p = seat.map_pos;
      if (!p || p.x == null || p.y == null) continue;
      samples.push({ t: gameTimeS, camp: camp.campid, who: seat.name || key, x: Number(p.x), y: Number(p.y), dead: !!seat.dead, hurtUp: prev !== undefined && hurt > prev });
    }
  }
  const cutoff = gameTimeS - 40;
  if (samples.length && samples[0].t < cutoff) samples = samples.filter(x => x.t >= cutoff);
}

// at the moment a turtle dies: killerCamp = campid of the killing team, killerPos = the killer's map_pos. true = perfect.
function isPerfect(gameTimeS, killerCamp, killerPos) {
  if (!killerPos || killerPos.x == null || killerPos.y == null) { console.log('[PERFECT TURTLE] no killer position — cannot judge, skipping'); return false; }
  const cx = Number(killerPos.x), cy = Number(killerPos.y);
  const recent = samples.filter(x => x.t > gameTimeS - cfg.windowS && x.t <= gameTimeS + 1);
  const near = (x, r) => Math.hypot(x.x - cx, x.y - cy) <= r;
  const enemies = recent.filter(x => x.camp !== killerCamp && !x.dead && near(x, cfg.enemyRadius));
  const hurt    = recent.filter(x => x.hurtUp && near(x, cfg.hurtRadius));
  const names = a => [...new Set(a.map(x => x.who))].join(', ');
  const perfect = enemies.length === 0 && hurt.length === 0;
  console.log('[PERFECT TURTLE] turtle died at ' + gameTimeS + 's, pit at (' + cx.toFixed(1) + ', ' + cy.toFixed(1) + ') — last ' + cfg.windowS + 's: ' +
    'enemy heroes within ' + cfg.enemyRadius + ': ' + (enemies.length ? names(enemies) : 'none') + '; damage ticks within ' + cfg.hurtRadius + ': ' + (hurt.length ? names(hurt) : 'none') +
    ' -> ' + (perfect ? 'PERFECT' : 'not perfect'));
  return perfect;
}

module.exports = { sample, isPerfect, reset, config: () => cfg };
