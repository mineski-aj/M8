// lib/state.js — all mutable state, initialized from config
const { players, CAMP_MAP } = require('./config');

function freshPlayerStats() {
  const s = {};
  for (const pid of Object.keys(players)) {
    s[pid] = {
      bpm_samples:           [],
      ticks_above_120:       0,
      ticks_total:           0,
      objective_bpm_samples: [],
    };
  }
  return s;
}

// Initialize readings from players
const readings = {};
for (const [pid, info] of Object.entries(players)) {
  readings[pid] = { ...info, bpm: null, last_bpm: null, status: "disconnected", last_seen: null };
}

const state = {
  readings,
  gameState: { state: "unknown", battleid: null, game_time_s: 0, game_time_fmt: "00:00", paused: false },
  campSwapped: false,
  activeCampMap: { camp1: [...CAMP_MAP.camp1], camp2: [...CAMP_MAP.camp2] },
  campTricodes: { camp1: null, camp2: null },
  playerNames: {},
  postgamePlayerNames: {},
  bpmOnEnd: {},
  stats: freshPlayerStats(),
  prevKillLord: 0, prevKillTurtle: 0,
  clashSnapshots: [], prevTotalKills: 0,
  activeFight: null, fightLog: [], fightIdSeq: 0, lastPlayerSnap: {},
  prevSeatKDA: {}, itemLog: {}, prevItemCounts: {},
  prevC1Lord: 0, prevC2Lord: 0, prevC1Turtle: 0, prevC2Turtle: 0,
  prevC1Tower: 0, prevC2Tower: 0,
  gameEvents: [], positionLog: [], posWriteCounter: 0,
  overlayClients: [], fightsPendingAction: null,
  mplfsScene: { matchboard: false, middleboard: false, playerboard: false, activeFeature: null },
  // Consolidated Post 2 — which of its three pages is currently shown
  // (1 = Runes/Items, 2 = Damage Dealt/Taken), scene-wide across all 10
  // rows. See routes/overlay.js's /overlay/cp2page/:page and
  // /overlay/cp2-page (restore-on-load).
  cp2Page: 1,
  p2hPage: 1,   // Post H2H page: 1 = role stats, 2 = gold distribution (/overlay/p2hpage/:page)
  featureToggles: {
    killevents: true,
    items:      true,
    skypiercer: true,
    lordadv:    true,
    trinity:    true,
    swap:       true,
    lvl15:      true,
    conceal:    true,
    fights:     true,
    objectivespawn: true,
    debugphotos: false, // MPL Full Screen playerboard: off = live photos by name, on = random test photos
    credits_v2: false, // Credit Reel (mplfs): false = V1 (centered reel over the full background), true = V2 (reel in a right-hand panel, transparent left)
    ggc_v2: false, // Gold Graph Check (mploverlay_v7): false = V1 (/positions + /events), true = V2 (Gold Info API: per-second GOLD_DIFFERENCE_v2 + objective events)
    hl_v2: false, // MVP Highlights (mplfs): false = V1, true = V2 (no player photo)
    mvp_v2: false, // MVP Scene (mplfs): false = V1 (full scene + background + photo), true = V2 (transparent over the live camera, no photo, black gradient on the right)
    stolengold: true, // Jungle Resource Stolen banner — auto-fires at 2/5/8/12min game time
  },
  prevKillEventCounts: {},
  // Whether each sliding "check" overlay (item/emblem/gold-diff, plus the
  // always-on scoreboard/player-ui panels) is currently shown — lets the
  // dashboard toggle reflect true state on reload instead of resetting to
  // a guess.
  checkOverlays: {
    scoreboard:      true,
    playerui:        true,
    itemcheck:       false,
    emblemcheck:     false,
    golddiffcheck:   false,
    goldgraphcheck:  false,
    livewinrate:     false,
    teamfightcheck:  false,   // Live Team Fight damage bar (overlay-teamfightcheck.js)
    sideexpcheck:    false,
    sidetakencheck:  false,
    sidedamagecheck: false,
    sidegoldcheck:   false,
    sidegolddistricheck: false,
    sidekdadistricheck: false,
    bpmmeter:        false,
    stolengold:      false,
  },
  // ingame_red.html / ingame_blue.html per-player heart-rate meter:
  // true = OFF (swapped to KDA + Gold block), false = LIVE (BPM meter
  // shown). Server-side so every open page (dashboard, ingame_red,
  // ingame_blue, vMix) reflects the same on/off state — this used to
  // live only in each browser's own localStorage, which never syncs
  // across separate browsers/machines.
  hrmOff: {
    player1: false, player2: false, player3: false, player4: false, player5: false,
    player6: false, player7: false, player8: false, player9: false, player10: false,
  },
  currentBattleId: null, gameStartTime: null,
  lastWrittenBattleId: null, hasSeenPlay: false,
  freshPlayerStats,
};

module.exports = state;
