// lib/dire.js — DiredudeAPI built into the overlay server: a self-hosted game-data API.
//
// What it is: polls the MLBB esports "battledata" upstream (auth key + judge id / battle id), keeps the latest battle cached and serves it
// in the enriched seat_N format the overlays were written for (same output as theapi.dpdns.org/sub-info). It replaces the external API
// while the dashboard's API Mode is DEBUG:
//   * entering DEBUG  -> lib/gameUrl.js points the game poller at /dire/api/gamedata and onModeChange('debug') starts polling here
//   * leaving DEBUG   -> polling stops (no needless upstream traffic)
//   * Settings -> API Mode (DEBUG) shows  [Debug]  [Refresh]  = GET /dire/api/debug | /dire/api/refresh:
//        refresh = ask the upstream for the JUDGE's current battle (config.judgeIds.global) and (re)start polling — the normal live game
//        debug   = load the most recent battle of the last 24h instead (no config change) — for testing without a live game
// Config: data/dire_config.json (git-ignored — holds the access token; see data/dire_config.example.json). Roster (roleid -> role, used to put
// players in seat order): data/dire_roster.json. Hero names: data/heronames.json.
const fs    = require('fs');
const path  = require('path');
const axios = require('axios');

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'dire_config.json');
const ROSTER_PATH = path.join(__dirname, '..', 'data', 'dire_roster.json');
const HERO_PATH   = path.join(__dirname, '..', 'data', 'heronames.json');

let CONFIG = {
  authKey: '', accessToken: '', authUrl: '',
  judgeIds: { global: '', indo: '' },
  servers: { battleList: 'https://esportsdata-sg.mobilelegends.com' },
  battleId: '', dataId: '', pollInterval: 1, mapName: '', matchCnt: '',
};
try { CONFIG = Object.assign(CONFIG, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))); }
catch (e) { console.warn('[dire] no data/dire_config.json yet — copy data/dire_config.example.json and fill in the access token'); }
CONFIG.judgeIds = Object.assign({ global: '', indo: '' }, CONFIG.judgeIds);
CONFIG.servers  = Object.assign({ battleList: 'https://esportsdata-sg.mobilelegends.com' }, CONFIG.servers);
if (process.env.DIRE_ACCESS_TOKEN) CONFIG.accessToken = process.env.DIRE_ACCESS_TOKEN;
if (process.env.AUTH_KEY) CONFIG.authKey = process.env.AUTH_KEY;

function saveConfig() {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(Object.assign({}, CONFIG, { authKey: '' }), null, 2)); } catch (e) { /* read-only is fine */ }
}

const heroNameMap = {};
try { JSON.parse(fs.readFileSync(HERO_PATH, 'utf8')).forEach(h => { heroNameMap[h.id] = h.name; }); } catch (e) { console.warn('[dire] could not load heronames.json'); }
let ROSTER = { players: {}, seatOrder: {} };
try { ROSTER = JSON.parse(fs.readFileSync(ROSTER_PATH, 'utf8')); } catch (e) { console.warn('[dire] could not load dire_roster.json'); }

const cache = {
  battleData: null,      // latest RAW upstream payload
  parsedJson: null,      // parseGameData(battleData), stringified once per poll
  lastUpdated: null,
  pollTimer: null,
  isDebug: false,        // true after /debug (the loaded battle is not the judge's game) — informational
  lastError: null,
  authOk: false,
  running: false,
};
let pollAbortController = null;

// Cumulative EXP required to reach each level (index = level - 1) — best minimums across observed games
const EXP_THRESHOLDS = [0, 247, 740, 1381, 2081, 2800, 3781, 4901, 6162, 7561, 9103, 10781, 12605, 14509, 16665];
// EXP needed to go from level N to N+1 (index = level - 1, valid for levels 1–14)
const EXP_PER_LEVEL  = [247, 493, 641, 700, 719, 981, 1120, 1261, 1399, 1542, 1678, 1824, 1904, 2156];

function calcLevelPercent(totalExp, level) {
  if (level >= 15) return 100;
  if (!level || level < 1) return 0;
  const startExp = EXP_THRESHOLDS[level - 1] || 0;
  const needed   = EXP_PER_LEVEL[level - 1]  || 1;
  const pct = Math.round(((totalExp - startExp) / needed) * 100);
  // Clamp 0–99: p.level is authoritative; never show 100% mid-level
  // (p.exp lags behind on level-up until the next poll)
  return Math.max(0, Math.min(99, pct));
}

const ROSTER_ROLE_FORMAT = {
  'EXP LANER':  'exp_laner',
  'JUNGLER':    'jungler',
  'MID LANER':  'mid_laner',
  'ROAMER':     'roamer',
  'GOLD LANER': 'gold_laner',
  'MULTIROLE':  'multirole',
};

function sortPlayersByRoster(playerList) {
  return [...playerList].sort((a, b) => {
    const rA = ROSTER.players[String(a.roleid)];
    const rB = ROSTER.players[String(b.roleid)];
    // roster first; players the roster does not know fall back to the lane inferred from the feed (annotateRoles), then to pos
    const seatA = rA ? (ROSTER.seatOrder[rA.role] || 99) : (a.__seatHint || 99);
    const seatB = rB ? (ROSTER.seatOrder[rB.role] || 99) : (b.__seatHint || 99);
    return seatA - seatB || (a.pos || 0) - (b.pos || 0);
  });
}

// ─── GAMEDATA PARSER ──────────────────────────────────────────────────────────

function itemObj(id) {
  return {
    image_Square: `path/to/${id}.png`,
    image_circle: `path/static/item/${id}.png`,
    value: id,
  };
}

function buildEventStats(events) {
  const stats = {};
  const get = id => {
    if (!stats[id]) stats[id] = {
      first_blood: 0, double_kill: 0, triple_kill: 0,
      quadra_kill: 0, penta_kill: 0, legendary: 0,
      kill_lord: 0, kill_tortoise: 0, steal: 0,
    };
    return stats[id];
  };
  (events || []).forEach(e => {
    if (!e.killer_id) return;
    const s = get(e.killer_id);
    const params = Array.isArray(e.extra_param) ? e.extra_param : [];
    if (e.event_type === 'kill_hero') {
      if (params.includes('first_blood')) s.first_blood = 1;
      if (params.includes('double_kill')) s.double_kill++;
      if (params.includes('triple_kill')) s.triple_kill++;
      if (params.includes('quadra_kill')) s.quadra_kill++;
      if (params.includes('penta_kill')) s.penta_kill++;
      if (params.includes('legendary')) s.legendary++;
    }
    if (e.event_type === 'kill_boss') {
      if (e.boss_name === 'lord') s.kill_lord++;
      if (e.boss_name === 'tortoise') s.kill_tortoise++;
      if (params.includes('steal')) s.steal++;
    }
  });
  return stats;
}

const ICON_BASE = 'theapi.dpdns.org/static/icons';
const ZERO_AREA = { end_time: 0, monster_gold: 0, orange_buffer_num: 0, purple_buffer_num: 0 };
const ZERO_LORD_ADV = { begin_time: 0, end_time: 0, exp: 0, gold: 0, tower_hp: 0 };
const asList = v => Array.isArray(v) ? v : (v && typeof v === 'object' ? [v] : []);
const fmtClock = sec => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
const pctOf = (a, b) => (a + b) > 0 ? Math.round(a / (a + b) * 100) : 0;
const sortKeys = o => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));

function parseGameData(raw) {
  const battle = raw?.data?.data || raw?.data || raw;
  const campList = battle?.camp_list || [];
  const gameTime = Math.max(battle?.game_time || 1, 1);
  const evStats = buildEventStats(battle?.incre_event_list || battle?.event_list);

  // All real players (campid 1 & 2) sorted by pos — used for cross-team rankings
  const realCamps = campList.filter(c => c.campid === 1 || c.campid === 2);
  // seat order: roster -> inferred lane (annotateRoles) -> pos — the same in DEBUG and normal mode
  const allPlayers = realCamps.flatMap(c => sortPlayersByRoster(c.player_list || []));

  // Metric arrays across all 10 players
  const gpmArr          = allPlayers.map(p => (p.gold || 0) / (gameTime / 60));
  const kdaArr          = allPlayers.map(p => ((p.kill_num || 0) + (p.assist_num || 0)) / Math.max(p.dead_num || 0, 1));
  const killArr         = allPlayers.map(p => p.kill_num || 0);
  const assistArr       = allPlayers.map(p => p.assist_num || 0);
  const dmgTowerArr     = allPlayers.map(p => p.total_damage_tower || 0);
  const dmgDealtGoldArr = allPlayers.map(p => (p.total_damage || 0) / Math.max(p.gold || 1, 1));
  const dmgTknDeathArr  = allPlayers.map(p => (p.total_hurt || 0) / Math.max(p.dead_num || 0, 1));
  const gm1Arr = allPlayers.map(p => p.gold_map?.['1'] || 0);
  const gm2Arr = allPlayers.map(p => p.gold_map?.['2'] || 0);
  const gm3Arr = allPlayers.map(p => p.gold_map?.['3'] || 0);
  const gm4Arr = allPlayers.map(p => p.gold_map?.['4'] || 0);
  const gm5Arr = allPlayers.map(p => p.gold_map?.['5'] || 0);
  const gm6Arr = allPlayers.map(p => p.gold_map?.['6'] || 0);

  // rank = (value / max) * 100
  const ratioRank = (val, arr) => {
    const max = Math.max(...arr);
    return max === 0 ? 0 : parseFloat((val / max * 100).toFixed(2));
  };

  // ordinal rank descending: 1 = highest value
  const ordRankDesc = (val, arr) => {
    const sorted = [...arr].sort((a, b) => b - a);
    const idx = sorted.indexOf(val);
    return idx === -1 ? 0 : idx + 1;
  };

  // Camp players sorted by pos for goldDiffPlayer matching by seat index
  const campSorted = {};
  realCamps.forEach(c => {
    campSorted[c.campid] = sortPlayersByRoster(c.player_list || []);
  });

  const teamAgg = {};
  realCamps.forEach(c => {
    const ps = campSorted[c.campid];
    const sum = f => ps.reduce((t, p) => t + (f(p) || 0), 0);
    teamAgg[c.campid] = {
      dmg: sum(p => p.total_damage), taken: sum(p => p.total_hurt),
      tower: sum(p => p.total_damage_tower), heal: sum(p => p.total_heal),
      kills: sum(p => p.kill_num), assists: sum(p => p.assist_num), deaths: sum(p => p.dead_num),
      // blessing/passive gold: the raw feed has no gold_map_passive — roam-equipment gold (gold_map[5]) is used instead (same assumption as lib/rawAdapter.js)
      passive: sum(p => p.gold_map_passive != null ? p.gold_map_passive : (p.gold_map && p.gold_map['5'])),
    };
  });
  const moneyOf = id => (realCamps.find(c => c.campid === id)?.total_money) || 0;
  const clock = fmtClock(Math.floor(battle?.game_time || 0));

  const transformedCamps = campList.map(camp => {
    const areaList = asList(camp.enemy_area_get);
    const lordAdvList = asList(camp.kill_lord_advantage);
    const campExtras = {
      enemy_area_get: [...areaList].reverse().find(a => a.end_time < gameTime) || areaList[areaList.length - 1] || ZERO_AREA,
      jungle_stolen: (({ monster_gold, orange_buffer_num, purple_buffer_num }) => ({ monster_gold, orange_buffer_num, purple_buffer_num }))(areaList[areaList.length - 1] || ZERO_AREA),
      kill_lord_advantage: lordAdvList[lordAdvList.length - 1] || ZERO_LORD_ADV,
    };
    if (camp.campid !== 1 && camp.campid !== 2) {
      const { player_list, ...rest } = camp;
      return sortKeys({ ...rest, ...campExtras });
    }
    const agg = teamAgg[camp.campid];
    const oppAgg = teamAgg[camp.campid === 1 ? 2 : 1] || { dmg: 0, taken: 0, tower: 0, heal: 0 };
    const sorted = sortPlayersByRoster(camp.player_list || []);
    const teamTotal = Math.max(camp.total_money || 1, 1);
    const oppId = camp.campid === 1 ? 2 : camp.campid === 2 ? 1 : null;
    const oppPlayers = oppId ? (campSorted[oppId] || []) : [];

    const seats = {};
    sorted.forEach((p, i) => {
      const gpm           = (p.gold || 0) / (gameTime / 60);
      const dmgDealtGold  = (p.total_damage || 0) / Math.max(p.gold || 1, 1);
      const dmgTknDeath   = (p.total_hurt || 0) / Math.max(p.dead_num || 0, 1);
      const health_percent = p.max_health_point > 0 ? Math.round((p.cur_health_point || 0) / p.max_health_point * 100) : 0;
      const mana_percent   = p.max_mana > 0 ? Math.round((p.cur_mana || 0) / p.max_mana * 100) : 0;
      const kda_rate       = ((p.kill_num || 0) + (p.assist_num || 0)) / Math.max(p.dead_num || 0, 1);
      const goldrate       = `${((p.gold || 0) / teamTotal * 100).toFixed(2)}%`;
      const goldk          = `${parseFloat(((p.gold || 0) / 1000).toFixed(2))}k`;
      const goldDiffPlayer = oppPlayers[i] ? (p.gold || 0) - (oppPlayers[i].gold || 0) : 0;
      const oppGold        = oppPlayers[i] ? (oppPlayers[i].gold || 0) : 0;
      const kp             = agg.kills > 0 ? parseFloat((((p.kill_num || 0) + (p.assist_num || 0)) / agg.kills * 100).toFixed(2)) : 0;
      const reviveShow     = (p.revive_left_time || 0) > 0 ? p.revive_left_time + 1 : '';
      const ev             = evStats[p.roleid] || {};
      const ri             = allPlayers.findIndex(q => q.roleid === p.roleid);
      const rosterEntry    = ROSTER.players[String(p.roleid)];
      const rosterRole     = rosterEntry ? (ROSTER_ROLE_FORMAT[rosterEntry.role] || null) : null;

      seats[`seat_${i + 1}`] = {
        ...p,
        role: rosterRole || p.role || '',
        dmg_dealt_gold: parseFloat(dmgDealtGold.toFixed(2)),
        dmg_tkn_death: parseFloat(dmgTknDeath.toFixed(2)),
        emblem_list: p.emblem_list || [1, 2, 3],
        exp_current_target: p.exp_current_target || '0%',
        extra_param: p.extra_param || {
          double_kill:  ev.double_kill  || 0,
          first_blood:  ev.first_blood  || 0,
          goldk,
          gpm: Math.round(gpm),
          herodead:     `${p.heroid || 0}_${p.dead ? 'True' : 'False'}`,
          kda:          `${p.kill_num || 0}/${p.dead_num || 0}/${p.assist_num || 0}`,
          kill_lord:    ev.kill_lord    || 0,
          kill_tortoise:ev.kill_tortoise|| 0,
          legendary:    ev.legendary    || 0,
          namedead:     `${p.name || ''}_${p.dead ? 'True' : 'False'}`,
          penta_kill:   ev.penta_kill   || 0,
          quadra_kill:  ev.quadra_kill  || 0,
          steal:        ev.steal        || 0,
          triple_kill:  ev.triple_kill  || 0,
        },
        goldDiffPlayer: goldDiffPlayer > 0 ? goldDiffPlayer : '',
        goldDiffPlayerPercent: pctOf(p.gold || 0, oppGold),
        gold_map_1: p.gold_map?.['1'] || 0,
        gold_map_2: p.gold_map?.['2'] || 0,
        gold_map_3: p.gold_map?.['3'] || 0,
        gold_map_4: p.gold_map?.['4'] || 0,
        gold_map_5: p.gold_map?.['5'] || 0,
        gold_map_6: p.gold_map?.['6'] || 0,
        gold_map_7: p.gold_map?.['7'] || 0,
        gold_map_8: p.gold_map?.['8'] || 0,
        gold_map_9: p.gold_map?.['9'] || 0,
        gold_map_passive: p.gold_map_passive != null ? p.gold_map_passive : ((p.gold_map && p.gold_map['5']) || 0),
        goldrate,
        health_percent,
        hero_name: p.heroid ? (heroNameMap[p.heroid] || `Hero_${p.heroid}`) : '',
        hit_rate: (Array.isArray(p.hit_rate) && p.hit_rate.length ? p.hit_rate : [{}, {}]).map(h => ({
          cast_times: h.cast_times || 0,
          hit_percentage: h.cast_times > 0 ? Math.round((h.hit_times || 0) / h.cast_times * 100) : 0,
          hit_times: h.hit_times || 0,
          skill_name: h.skill_name || 'Unknown',
          skillid: String(h.skillid || '0'),
        })),
        core_item: p.core_item || { difference: 0, fastestTime: 0, item_1: 0, item_2: 0, item_3: 0, status: 'building', time: 0 },
        first_item: p.first_item || { build_rate: 0, difference: 0, fastestTime: 0, item: 0, status: 'not_built', time: 0 },
        kp,
        sky_piercer_stack: p.sky_piercer_stack || { active: false, dead: 0, kill: 0, stack: 0 },
        smooth_revive_countdown_timer: reviveShow === '' ? 0 : reviveShow,
        kda_rate: parseFloat(kda_rate.toFixed(4)),
        last_emblem: p.last_emblem || [],
        level_eta: p.level_eta || '',
        level_percent: calcLevelPercent(p.exp || 0, p.level || 0),
        mana_percent,
        rank_assist:              ri >= 0 ? ratioRank(assistArr[ri],       assistArr)       : 0,
        rank_damage_tower:        ri >= 0 ? ratioRank(dmgTowerArr[ri],     dmgTowerArr)     : 0,
        rank_dmg_dealt_gold:      ri >= 0 ? ratioRank(dmgDealtGoldArr[ri], dmgDealtGoldArr) : 0,
        rank_dmg_dealt_tkn_death: ri >= 0 ? ratioRank(dmgTknDeathArr[ri],  dmgTknDeathArr)  : 0,
        rank_gold_map_1: ri >= 0 ? ordRankDesc(gm1Arr[ri], gm1Arr) : 0,
        rank_gold_map_2: ri >= 0 ? ordRankDesc(gm2Arr[ri], gm2Arr) : 0,
        rank_gold_map_3: ri >= 0 ? ordRankDesc(gm3Arr[ri], gm3Arr) : 0,
        rank_gold_map_4: ri >= 0 ? ordRankDesc(gm4Arr[ri], gm4Arr) : 0,
        rank_gold_map_5: ri >= 0 ? ordRankDesc(gm5Arr[ri], gm5Arr) : 0,
        rank_gold_map_6: ri >= 0 ? ordRankDesc(gm6Arr[ri], gm6Arr) : 0,
        rank_gpm:  ri >= 0 ? ratioRank(gpmArr[ri],  gpmArr)  : 0,
        rank_kda:  ri >= 0 ? ratioRank(kdaArr[ri],  kdaArr)  : 0,
        rank_kill: ri >= 0 ? ratioRank(killArr[ri], killArr) : 0,
        revive_left_time_show: reviveShow,
        roaming_type: p.roaming_type || 'None',
        rune_map_1: p.rune_map?.['1'] || 0,
        rune_map_2: p.rune_map?.['2'] || 0,
        rune_map_3: p.rune_map?.['3'] || 0,
        ultimate_ready: (p.level >= 4 && (p.major_left_time || 0) === 0) ? 'true' : 'false',
        equip_list: (p.equip_list || []).map(id =>
          typeof id === 'object' ? id : itemObj(id)
        ),
      };
    });

    const { player_list, ...campWithoutPlayers } = camp;
    const total = camp.total_money || 0;
    const lead = total - moneyOf(camp.campid === 1 ? 2 : 1);
    const gdKey = camp.campid === 1 ? 'golddiffLeft' : 'golddiffRight';
    const kpVals = Object.values(seats).map(x => x.kp);
    const gameMin = gameTime / 60;
    const hasResult = (battle?.win_camp || 0) > 0;
    return sortKeys({
      ...campWithoutPlayers,
      ...campExtras,
      ...seats,
      blessing_gold: agg.passive,
      [gdKey]: lead > 0
        ? { image: `${ICON_BASE}/gold icon.png`, value: `+${parseFloat((lead / 1000).toFixed(2))}k` }
        : { image: `${ICON_BASE}/0.png`, value: ' ' },
      game_time: clock,
      // No upstream source for historical first-blood/tower/turtle/lord rates — placeholders
      firstBloodRate: '0.00%', firstEvolveLordRate: '0.00%', firstEvolveLordWinrate: '0.00%',
      firstInnerTowerRate: '0.00%', firstInnerTowerWinrate: '0.00%', firstLordRate: '0.00%',
      firstTowerRate: '0.00%', firstTowerWinrate: '0.00%', firstTurtleRate: '0.00%',
      firstTurtleWinrate: '0.00%', firtLordWinrate: '0.00%',
      kill_turtle_advantage: camp.kill_turtle_advantage || {
        current_gold: total, kill_turtle: camp.kill_tortoise || 0,
        previous_gold: total, previous_turtle: camp.kill_tortoise || 0, turtle_gold_advantage: 0,
      },
      result: hasResult ? (battle.win_camp === camp.campid ? 'win' : 'lose') : '',
      team_dmg_tkn_d: agg.taken / 2,
      team_dpm: parseFloat((agg.dmg / gameMin).toFixed(2)),
      team_gpm: parseFloat((total / gameMin).toFixed(2)),
      team_kda: parseFloat(((agg.kills + agg.assists) / Math.max(agg.deaths, 1)).toFixed(2)),
      team_kp: kpVals.length ? parseFloat((kpVals.reduce((a, b) => a + b, 0) / kpVals.length).toFixed(2)) : 0,
      team_total_damage_dealt: agg.dmg,
      team_total_damage_percent: pctOf(agg.dmg, oppAgg.dmg),
      team_total_damage_taken: agg.taken,
      team_total_damage_taken_percent: pctOf(agg.taken, oppAgg.taken),
      team_total_damage_tower_percent: pctOf(agg.tower, oppAgg.tower),
      team_total_heal: agg.heal,
      team_total_heal_percent: pctOf(agg.heal, oppAgg.heal),
      team_total_tower_damage: agg.tower,
      total_money_k: `${(total / 1000).toFixed(2)}k`,
    });
  });

  return {
    code: raw?.code ?? 0,
    data: (({ incre_event_list, ...b }) => ({
      ...b,
      camp_list: transformedCamps,
      map_name: b.map_name || CONFIG.mapName || '',
      matchCnt: b.matchCnt || CONFIG.matchCnt || '',
    }))(battle),
    dataid: raw?.dataid ?? battle?.dataid ?? CONFIG.dataId,
    message: raw?.message || 'success',
  };
}

// ─── UPSTREAM ─────────────────────────────────────────────────────────────────
async function ensureAuthKey(force) {
  if (CONFIG.authKey && !force) return CONFIG.authKey;
  if (!CONFIG.authUrl || !CONFIG.accessToken) throw new Error('no authKey and no authUrl/accessToken in data/dire_config.json');
  const res = await axios.get(CONFIG.authUrl, { headers: { 'X-Access-Token': CONFIG.accessToken }, timeout: 8000 });
  if (!res.data || !res.data.authKey) throw new Error('auth server returned no authKey');
  CONFIG.authKey = res.data.authKey;
  cache.authOk = true;
  console.log('[dire] auth key loaded');
  return CONFIG.authKey;
}

// GET the upstream; on an auth failure fetch a fresh key once and retry.
async function upstreamGet(url, opts) {
  const withKey = () => url.replace(/authkey=[^&]*/, 'authkey=' + encodeURIComponent(CONFIG.authKey));
  await ensureAuthKey(false);
  try {
    const { data } = await axios.get(withKey(), Object.assign({ timeout: 8000 }, opts || {}));
    // an upstream auth failure comes back as a non-zero code with an "auth" message (10012 is the rate limiter, not auth)
    if (data && data.code && data.code !== 0 && data.code !== 10012 && /auth/i.test(String(data.message || ''))) throw Object.assign(new Error('auth rejected'), { auth: true });
    return data;
  } catch (e) {
    if (axios.isCancel(e)) throw e;
    if (e.auth || (e.response && (e.response.status === 401 || e.response.status === 403))) {
      await ensureAuthKey(true);
      const { data } = await axios.get(withKey(), Object.assign({ timeout: 8000 }, opts || {}));
      return data;
    }
    throw e;
  }
}

async function fetchBattleList(judgeId) {
  const data = await upstreamGet(`${CONFIG.servers.battleList}/battlelist/judge?authkey=${CONFIG.authKey}&judgeid=${judgeId}`);
  const result = data && data.data && data.data.result || data && data.result;
  const battleId = Array.isArray(result) && result.length > 0 ? String(result[0].battleid) : null;
  if (battleId) { CONFIG.battleId = battleId; saveConfig(); console.log('[dire] battleId updated:', CONFIG.battleId); }
  else console.warn('[dire] could not extract battleId from the judge battle list:', JSON.stringify(data).slice(0, 300));
  return data;
}
async function fetchBattleListByDatetime(datetime) {
  return upstreamGet(`${CONFIG.servers.battleList}/battlelist/datetime?authkey=${CONFIG.authKey}&datetime=${encodeURIComponent(datetime)}`);
}
async function fetchBattleData(battleId, dataId, signal) {
  return upstreamGet(`${CONFIG.servers.battleList}/battledata?authkey=${CONFIG.authKey}&battleid=${battleId}&dataid=${dataId}`, signal ? { signal } : {});
}

// ─── ROLES FOR PLAYERS THE ROSTER DOESN'T KNOW ────────────────────────────────
// data/dire_roster.json maps roleid -> role for known players; for everyone else (a new tournament, a debug game) the lane is inferred from
// the feed by lib/rawAdapter.js's resolveRoles (Retribution = jungle, roam-equipment gold = roamer, most minion gold = gold lane; EXP/MID
// provisionally by pos). Sets p.role + a seat hint used by sortPlayersByRoster.
function annotateRoles(raw) {
  try {
    const battle = (raw && raw.data && raw.data.data) || (raw && raw.data) || raw;
    const adapter = require('./rawAdapter');
    adapter.ensureBattle(battle && battle.battleid);
    const time = (battle && battle.game_time) || 0;
    (battle.camp_list || []).filter(c => c.campid === 1 || c.campid === 2).forEach(camp => {
      const players = (camp.player_list || []).filter(p => !p.judger).sort((a, b) => (a.pos || 0) - (b.pos || 0)).slice(0, 5);
      if (players.some(p => ROSTER.players[String(p.roleid)])) return;          // roster covers this team
      const roles = adapter.resolveRoles(players, time);
      players.forEach(p => {
        const i = adapter.ROLES.indexOf(roles[p.roleid]);
        if (i >= 0) { p.role = roles[p.roleid]; p.__seatHint = i + 1; }
      });
    });
  } catch (e) { /* inference is best-effort */ }
}

// ─── POLLING ──────────────────────────────────────────────────────────────────
async function pollNow() {
  const battleId = CONFIG.battleId, dataId = CONFIG.dataId;
  if (!battleId || !dataId) return;
  pollAbortController = new AbortController();
  try {
    const raw = await fetchBattleData(battleId, dataId, pollAbortController.signal);
    annotateRoles(raw);
    cache.battleData = raw;
    cache.parsedJson = JSON.stringify(parseGameData(raw));
    cache.lastUpdated = new Date().toISOString();
    cache.lastError = null;
  } catch (e) {
    if (axios.isCancel(e)) return;
    cache.lastError = e.message;
    console.error('[dire] poll failed:', e.message);
  }
}
function startPolling() {
  stopPolling();
  const sec = Math.max(0.25, Number(CONFIG.pollInterval) || 1);
  cache.pollTimer = setInterval(pollNow, sec * 1000);
  cache.running = true;
  console.log(`[dire] polling every ${sec}s (battleId ${CONFIG.battleId})`);
  pollNow();
}
function stopPolling() {
  if (pollAbortController) pollAbortController.abort();
  if (cache.pollTimer) { clearInterval(cache.pollTimer); cache.pollTimer = null; }
  cache.running = false;
}
function clearCache() { cache.battleData = null; cache.parsedJson = null; cache.lastUpdated = null; }

// ─── CONTROLS (dashboard: Debug / Refresh) ────────────────────────────────────
/** refresh: judge's current battle -> roster ordering -> restart polling */
async function refresh() {
  const judgeId = CONFIG.judgeIds.global;
  if (!judgeId) throw new Error('no judgeIds.global in data/dire_config.json');
  stopPolling();
  const prev = CONFIG.battleId;
  await fetchBattleList(judgeId);
  clearCache(); cache.isDebug = false; cache.lastError = null;
  startPolling();
  return { battleId: CONFIG.battleId, judgeId, changed: CONFIG.battleId !== prev, message: 'battleId updated, polling restarted' };
}

/** debug: most recent battle of the last 24h (config untouched) -> pos ordering -> restart polling */
async function debug() {
  stopPolling();
  await new Promise(r => setTimeout(r, 400));
  const pad = n => String(n).padStart(2, '0');
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const datetime = `${past.getUTCFullYear()}-${pad(past.getUTCMonth() + 1)}-${pad(past.getUTCDate())} ${pad(past.getUTCHours())}:${pad(past.getUTCMinutes())}:${pad(past.getUTCSeconds())}`;
  let listData;
  for (let attempt = 1; attempt <= 6; attempt++) {
    listData = await fetchBattleListByDatetime(datetime);
    if (!listData || listData.code !== 10012) break;          // 10012 = rate limited
    await new Promise(r => setTimeout(r, 1500));
  }
  if (!listData || listData.code !== 0) throw Object.assign(new Error(`upstream error: ${listData && listData.message} (code ${listData && listData.code})`), { status: 502 });
  const result = listData.result || (listData.data && listData.data.result) || [];
  if (!Array.isArray(result) || !result.length) throw Object.assign(new Error('no battles found in the last 24h'), { status: 404 });
  CONFIG.battleId = String(result[0].battleid);            // memory only — not saved
  clearCache(); cache.isDebug = true; cache.lastError = null;
  startPolling();
  return { debugBattleId: CONFIG.battleId, debugJudgeId: result[0].judgeid, reporttime: result[0].reporttime, datetime, totalFound: result.length, message: 'debug battle loaded; Refresh restores the judge game' };
}

/** called when the dashboard flips API Mode (and once at server start) */
async function onModeChange(mode) {
  if (mode !== 'debug') { stopPolling(); return; }
  try {
    await ensureAuthKey(false);
    if (CONFIG.battleId && CONFIG.dataId) startPolling(); else await refresh();
  } catch (e) { cache.lastError = e.message; console.warn('[dire] could not start:', e.message); }
}

/** the judge id `refresh` asks the upstream for (config.judgeIds.global) — saved to data/dire_config.json */
function setJudgeId(id) {
  const v = String(id == null ? '' : id).trim();
  if (!/^\d{1,20}$/.test(v)) throw Object.assign(new Error('judge ID must be digits only'), { status: 400 });
  CONFIG.judgeIds.global = v;
  saveConfig();
  return v;
}

function status() {
  return {
    running: cache.running, isDebug: cache.isDebug, battleId: CONFIG.battleId || null, dataId: CONFIG.dataId || null,
    judgeId: CONFIG.judgeIds.global || null, pollInterval: CONFIG.pollInterval, lastUpdated: cache.lastUpdated,
    lastError: cache.lastError, authOk: cache.authOk, hasData: !!cache.parsedJson,
    configured: !!(CONFIG.authUrl && CONFIG.accessToken) || !!CONFIG.authKey,
  };
}

module.exports = {
  refresh, debug, onModeChange, status, setJudgeId, startPolling, stopPolling,
  getGameDataJson: () => cache.parsedJson,
  getRaw: () => cache.battleData,
  parseGameData,   // exported for offline replays/tests
};
