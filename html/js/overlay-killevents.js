/* ── [FEATURE: kill-events] ── */

var killEventPlaying = false;
var killEventCurrent = null; /* video filename currently playing */
const killEventQueue = []; /* each entry: { src, priority, playerIdx, playerName, role } */

const killOverlayEl     = document.getElementById('kill-event-overlay');
const killVideoEl       = document.getElementById('kill-event-video');
const killPhotoClipEl   = document.getElementById('kill-event-photo-clip');
const killPhotoEl       = document.getElementById('kill-event-photo');
const killNametagClipEl = document.getElementById('kill-event-nametag-clip');
const killNametagBgEl   = document.getElementById('kill-event-nametag-text');
const killNameEl        = document.getElementById('kill-event-name');
const killRoleIconEl    = document.getElementById('kill-event-role-icon');
const killSponsorLogoClipEl  = document.getElementById('kill-event-sponsor-logo-clip');
const killSponsorLogoEl      = document.getElementById('kill-event-sponsor-logo');
const killTeamLogoClipEl     = document.getElementById('kill-event-teamlogo-clip');
const killTeamLogoEl         = document.getElementById('kill-event-teamlogo');

/* Never show a broken-image icon if a player's signature photo is
   missing — just leave that spot transparent instead. Reset to visible
   before each new src assignment in showKillEventPlayer() below. */
killPhotoEl.onerror = function() {
  killPhotoEl.style.visibility = 'hidden';
};
killTeamLogoEl.onerror = function() {
  killTeamLogoEl.style.visibility = 'hidden';
};

/* Wipe Out (10th Anniversary only) has no acting player — instead of the
   photo/nametag popup, it shows the logo of the team that did the
   wiping. `camp` here is that team's camp ('blue'/'red'), same value
   broadcastKillEvent's wipeout branch in lib/pollers.js already sends.
   Resolved from the shared masterPoll data (overlay-core.js's `lastData`)
   the same way overlay-scoreboard.js resolves its own team logos, rather
   than adding a second, separate fetch for the same information. */
function killEventTeamLogoSrc(camp, tricodeOverride) {
  /* Manual-test-only override (dashboard's Wipe Out Random Test) — picks
     any team's tricode directly instead of needing a live match's camp_list
     loaded. Real live-detected wipeouts never send this. */
  if (tricodeOverride) return '/assets/team/logos/' + encodeURIComponent(tricodeOverride) + '.png';
  if (!lastData || !lastData.camp_list) return null;
  var cid = camp === 'red' ? 2 : 1;
  var c = lastData.camp_list.find(function(cc) { return cc.campid === cid; });
  var name = c && c.team_simple_name ? c.team_simple_name.toUpperCase().trim() : '';
  return name ? '/assets/team/logos/' + encodeURIComponent(name) + '.png' : null;
}

/* Kill events sponsored by a specific brand — the sponsor logo only
   shows for these videos, popping in alongside the photo. */
/* Which logo (if any) goes with which video comes from the COUNTRY set this page was opened with (?set=ID …) — see
   overlay-eventsponsors.js; configured per set in the dashboard's Sponsors tab. No logo configured = the event runs unsponsored. */
var KILL_EVENT_SPONSOR_SLOT = { 'doublekill.webm': 'doublekill', 'triplekill.webm': 'triplekill', 'turtleslain.webm': 'turtleslain' };   /* MCT adds no new slots: the other MCT events run unsponsored */
function killEventConfiguredLogo(video) {
  var u = KILL_EVENT_SPONSOR_SLOT[video] ? EventSponsors.get(KILL_EVENT_SPONSOR_SLOT[video]) : '';
  return (u && u !== 'builtin') ? u : null;
}
/* 10th Anniversary — Turtle Slain runs unsponsored (Double Kill and
   Triple Kill keep their logos). previewKillEventSponsor() below picks
   its preview video based on this same theme check, so it always
   previews an event that's actually sponsored under the current theme. */
function killEventIsPlayoffs() {
  return document.documentElement.getAttribute('data-theme') === 'playoffs';
}
function killEventSponsorLogo(video) {
  /* MCT: the sponsor pill shows on every event that has a player popup (the reference has it on Triple Kill AND Lord Slain); an event with its own
     slot uses it, everything else falls back to the Triple Kill sponsor. */
  if (killEventIsMct()) {
    var mu = EventSponsors.get(KILL_EVENT_SPONSOR_SLOT[video] || 'triplekill') || EventSponsors.get('triplekill');
    return (mu && mu !== 'builtin') ? mu : null;
  }
  /* Playoffs — the updated kill-event webms no longer have the sponsor baked in (the previous ones had Smart / Visa
     painted on the bar), so the same three events get the same logos from the overlay element instead; see
     killEventApplySponsorFit for the per-logo sizing. */
  if (video === 'turtleslain.webm' && document.documentElement.getAttribute('data-theme') === '10th_anniversary') {
    return null;
  }
  return killEventConfiguredLogo(video);
}

/* Playoffs sponsor fit. The sponsor PNGs are full 1920x1080 canvases with different margins (Smart's pill spans 1865x534,
   Visa's logo 1609x519), but the old baked sponsors were Smart 177x50 and Visa 136x44 centred at the same x. The shared
   clip box (mploverlay_v7::playoffs #kill-event-sponsor-logo-clip, sized for Smart) gives Smart exactly that; Visa's image is
   shrunk/offset inside the box (inline %, reset for every other logo) so its logo lands on 136x44 at (1225,817). */
function killEventApplySponsorFit(logo) {
  var s = killSponsorLogoEl.style;
  if (killEventIsPlayoffs() && /visa/i.test(logo)) {
    s.width = '89%'; s.height = '89%'; s.left = '5.4%'; s.top = '13.9%';
  } else {
    s.width = ''; s.height = ''; s.left = ''; s.top = '';
  }
}

/* ── Timeline pause (all kill events) ──
   Replaces the earlier slow-motion-middle-third trial: instead of riding
   playbackRate, the video just pauses outright once it reaches a fixed
   point in its OWN timeline, holds there for pauseMs, then resumes at
   normal speed. The player-photo popup's hold time is extended by the
   same pauseMs so it doesn't retreat while the video is sitting paused.

   Pause points are specified as atFrame — a frame COUNT (every asset
   here is 60fps, so e.g. 1s+15f = frame 75), not a seconds value. A
   seconds-based threshold is checked against currentTime on the
   'timeupdate' event, which only fires on the browser's own coarse
   schedule — a rendering hiccup elsewhere on the page can delay that
   check running until well past the intended instant, landing the pause
   on a visibly later frame than intended. requestVideoFrameCallback
   (used below when supported — Chrome/Edge; falls back to timeupdate
   otherwise, e.g. Firefox/Safari) instead fires once per actually
   decoded/presented video frame with that frame's own exact mediaTime,
   so the pause always lands on the intended frame regardless of what
   else is happening on the page. Same atFrame/pauseMs for every video
   for now (shortest asset — Double/Triple Kill at 2.124s — still leaves
   ~0.87s after resume, so frame 75 is safe across the board); split any
   one of these out with its own values once someone wants a different
   feel for it. */
var KILL_EVENT_FPS = 60;
var KILL_EVENT_PAUSE = {
  'firstblood.webm':  { atFrame: 75, pauseMs: 750 }, // 1s + 15f
  'doublekill.webm':  { atFrame: 75, pauseMs: 750 },
  'triplekill.webm':  { atFrame: 75, pauseMs: 750 },
  'maniac.webm':      { atFrame: 75, pauseMs: 750 },
  'savage.webm':      { atFrame: 75, pauseMs: 750 },
  'lordslain.webm':   { atFrame: 75, pauseMs: 750 },
  'turtleslain.webm': { atFrame: 75, pauseMs: 750 },
  'wipedout.webm':    { atFrame: 75, pauseMs: 750 },
};
/* 10th Anniversary — every kill event video is a re-timed (itsscale +
   stream copy, not a full decode/re-encode — that path was tried first
   and silently dropped these assets' WebM alpha side-channel, since
   this ffmpeg build's VP9 decoder doesn't read it back out; itsscale
   only rewrites container timestamps, so the original bitstream —
   alpha included — passes through untouched) encode, stretched so each
   one's native duration alone already equals what natural length +
   750ms pause used to add up to. No freeze-and-hold needed for any of
   them anymore — returning null here skips the video pause entirely,
   letting the baked-in slower playback carry that same extra time
   instead. Regular is untouched, still pauses at frame 75. */
function killEventPauseCfg(video) {
  var cfg = KILL_EVENT_PAUSE[video];
  if (!cfg) return cfg;
  if (killEventIsMct()) return null;   /* MCT videos are timed as delivered — no freeze-and-hold */
  var theme = document.documentElement.getAttribute('data-theme');
  /* Playoffs — the new webms are already longer; no freeze-and-hold. */
  if (theme === '10th_anniversary' || theme === 'playoffs') {
    return null;
  }
  return cfg;
}
/* The photo/name/sponsor popup's extra hold time — kept separate from
   killEventPauseCfg above, which governs the VIDEO's own freeze. For
   firstblood.webm/10th Anniversary the video doesn't freeze (its extra
   time is baked into the slowed asset instead), but the popup should
   still hold for that same extra stretch so it doesn't retract before
   the now-longer video actually ends. Always reads the base config's
   pauseMs, regardless of whether killEventPauseCfg suppresses the
   video-freeze for this video/theme. */
/* Playoffs — the popup (photo + name tag) pops out so its 300ms exit
   finishes just as the gold centre block leaves the video (~2.95s in; the
   gold block starts morphing out at ~2.85s of a 3.35s clip). Pop-in starts at
   KILL_POP_DELAY_MS, so the hold timer = PLAYOFFS_POP_OUT_AT_MS - delay. */
var KILL_PLAYOFFS_POP_OUT_AT_MS = 2650;
function killEventHoldExtensionMs(video) {
  if (killEventIsMct()) return KILL_MCT_HOLD_MS - KILL_POP_HOLD_MS;   /* popup stays up until ~3.2 s of the 4 s clip */
  if (killEventIsPlayoffs()) {
    return KILL_PLAYOFFS_POP_OUT_AT_MS - KILL_POP_DELAY_MS - KILL_POP_HOLD_MS;
  }
  var cfg = KILL_EVENT_PAUSE[video];
  return cfg ? cfg.pauseMs : 0;
}
/* 10th Anniversary — assets/webm/motion/anniversary/ has its own version of
   every kill event video, same filenames as the regular assets/webm/motion/. */
var KILL_EVENT_PLAYOFFS_VIDEO = {
  'firstblood.webm':  '1_FIRST_BLOOD_1920x1080.webm',
  'doublekill.webm':  '2_DOUBLE_KILL_1920x1080.webm',
  'triplekill.webm':  '3_TRIPLE_KILL_1920x1080.webm',
  'maniac.webm':      '4_MANIAC_1920x1080.webm',
  'savage.webm':      '5_SAVAGE_1920x1080.webm',
  'lordslain.webm':   '6_LORD_SLAIN_1920x1080.webm',
  'turtleslain.webm': '7_TURTLE_SLAIN_1920x1080.webm',
  'wipedout.webm':    '8_WIPED_OUT_1920x1080.webm',
};
/* ── MCT theme ── own videos in assets/webm/motion/mct/ (C07..C17). Double Kill and Perfect Lord have no MCT video yet, so they are skipped. */
function killEventIsMct() { return document.documentElement.getAttribute('data-theme-name') === 'mct'; }
var KILL_EVENT_MCT_VIDEO = {
  'firstblood.webm':   'C07-FIRST BLOOD.webm',
  'triplekill.webm':   'C09-TRIPLE KILL.webm',
  'maniac.webm':       'C10-MANIAC.webm',
  'savage.webm':       'C11-SAVAGE.webm',
  'wipedout.webm':     'C12-WIPE OUT.webm',
  'turtleslain.webm':  'C13-TURTLE SLAIN.webm',
  'lordslain.webm':    'C14-LORD SLAIN.webm',
  'perfectturtle.webm':'C15-PERFECT TURTLE.webm',
  'lordsteal.webm':    'C16-LORD STEAL.webm',
  'turtlesteal.webm':  'C17-TURTLE STEAL.webm',
};
function killEventVideoPath(video) {
  if (killEventIsMct() && KILL_EVENT_MCT_VIDEO[video]) return 'assets/webm/motion/mct/' + encodeURIComponent(KILL_EVENT_MCT_VIDEO[video]);
  if (killEventIsPlayoffs() && KILL_EVENT_PLAYOFFS_VIDEO[video]) {
    return 'assets/overlay/ingame/playoffs/motion/' + KILL_EVENT_PLAYOFFS_VIDEO[video];
  }
  if (document.documentElement.getAttribute('data-theme') === '10th_anniversary') {
    return 'assets/webm/motion/anniversary/' + video;
  }
  return 'assets/webm/motion/' + video;
}
var killPauseArmed  = false; /* true until the current video's pause point has fired once */
var killPauseRvfcId = null;  /* pending requestVideoFrameCallback handle, if in use */
var KILL_EVENT_HAS_RVFC = typeof HTMLVideoElement !== 'undefined' &&
  'requestVideoFrameCallback' in HTMLVideoElement.prototype;

function killClearPause() {
  killPauseArmed = false;
  if (killPauseRvfcId !== null && killVideoEl.cancelVideoFrameCallback) {
    killVideoEl.cancelVideoFrameCallback(killPauseRvfcId);
  }
  killPauseRvfcId = null;
}

function killResumeAfterPause(cfg) {
  killVideoEl.pause();
  var token = killEventToken;
  setTimeout(function() {
    /* Guard against a since-superseded video (queue moved on while this
       was pending) — only resume if it's still the same playback. */
    if (killEventToken === token) killVideoEl.play().catch(function() {});
  }, cfg.pauseMs);
}

/* Re-arms itself every frame (via the callback's own recursive request)
   until the target frame is reached, then pauses. */
function killArmFramePause() {
  killPauseRvfcId = killVideoEl.requestVideoFrameCallback(function(now, metadata) {
    killPauseRvfcId = null;
    if (!killPauseArmed) return;
    var cfg = killEventPauseCfg(killEventCurrent);
    if (!cfg) return;
    if (Math.round(metadata.mediaTime * KILL_EVENT_FPS) < cfg.atFrame) {
      killArmFramePause();
      return;
    }
    killPauseArmed = false;
    killResumeAfterPause(cfg);
  });
}

/* Fallback for browsers without requestVideoFrameCallback — same frame
   count, converted to seconds against currentTime instead. Less precise
   under a hiccup (see the comment above), but a graceful degradation
   rather than a hard requirement. */
killVideoEl.addEventListener('timeupdate', function() {
  if (KILL_EVENT_HAS_RVFC) return; /* handled by killArmFramePause instead */
  if (!killPauseArmed) return;
  var cfg = killEventPauseCfg(killEventCurrent);
  if (!cfg || killVideoEl.currentTime < cfg.atFrame / KILL_EVENT_FPS) return;
  killPauseArmed = false;
  killResumeAfterPause(cfg);
});

/* Pop timing — start delayed 300ms after the trigger, held up for 1.3s,
   then pops back down. KILL_POP_EXIT_MS must track the exit transition
   duration in mploverlay_v7.css so the overlay hide (below) never cuts
   the pop-down transition short. */
var KILL_MCT_HOLD_MS = 2600;   /* MCT: how long the popup holds after popping in */
var KILL_POP_DELAY_MS = 300;
var KILL_POP_HOLD_MS  = 1300;
var KILL_POP_EXIT_MS  = 300;

/* Wipe Out's team-logo popup holds 150ms longer than KILL_POP_HOLD_MS above
   — kept as its own constant rather than changing KILL_POP_HOLD_MS itself,
   since that one's shared with the player-photo popup used by every other
   kill event. */
var KILL_TEAMLOGO_EXTRA_HOLD_MS = 250;

/* Must track #kill-event-photo-clip.ke-in #kill-event-photo's transition
   duration in mploverlay_v7.css — the bounce fires right as the slide-up lands. */
var KILL_POP_ENTER_MS = 480;

/* Rectangle_3 (name text box) is 151px wide — leave a small margin so
   shrink-to-fit text never touches the plate art's edges. */
var KILL_NAME_MAX_W = 139;

var killShowTimer      = null; /* pending: about to pop in */
var killBounceTimer    = null; /* pending: about to play the settle bounce */
var killHoldTimer      = null; /* pending: about to pop back out */
var killPopCycleEndsAt = 0;    /* Date.now() timestamp when the pop-down transition finishes */
var killEventToken      = 0;   /* bumped each time a new video starts, to void stale deferred hides */

function killEventPhotoSrc(playerName) {
  /* 10th Anniversary — the bigger 484x484 box (see #kill-event-photo-clip
     CSS) uses the full-resolution /hires signature instead of the
     regular-theme pre-resized one, so it doesn't look soft when scaled
     up. Naming differs slightly: assets/photo/hires/SIGNATURE/<name>_SIGNATURE.png,
     no "_resized" suffix. */
  var th = document.documentElement.getAttribute('data-theme');
  if (th === '10th_anniversary' || th === 'playoffs') {
    return 'assets/photo/hires/SIGNATURE_web/' + encodeURIComponent(playerName) + '_SIGNATURE.webp';
  }
  return 'assets/photo/SIGNATURE/' + encodeURIComponent(playerName) + '_SIGNATURE_resized.webp';
}

function killNametagBgSrc(camp) {
  if (killEventIsPlayoffs()) {
    return 'assets/overlay/lineup/playoffs/playoffs_' + (camp === 'red' ? 'red' : 'blue') + 'box.png';
  }
  var file = 'kill' + (camp === 'red' ? 'red' : 'blue') + 'back.png';
  return document.documentElement.getAttribute('data-theme') === '10th_anniversary'
    ? 'assets/overlay/ingame/anniversary/' + file
    : 'assets/overlay/ingame/' + file;
}

/* Shrink-to-fit text (binary search font-size) — same approach as
   sbFitText/eccFitName/etc. elsewhere, so a long IGN never overflows
   Rectangle_3's 151×30 box. */
function killFitNameMeasure(el) {
  var maxW = killEventIsPlayoffs() ? 148 : KILL_NAME_MAX_W; /* playoffs name box is 160 wide */
  el.style.fontSize = '16px';
  if (el.scrollWidth <= maxW) return;
  var lo = 8, hi = 16;
  while (hi - lo > 0.5) {
    var mid = (lo + hi) / 2;
    el.style.fontSize = mid + 'px';
    if (el.scrollWidth <= maxW) lo = mid; else hi = mid;
  }
  el.style.fontSize = lo + 'px';
}
function killFitName(el) {
  killFitNameMeasure(el);
  /* General Sans loads async (font-display:block) — if a kill event fires
     before it's ready, the fit above measures against fallback-font glyphs
     and can under-size the text. Re-measure once the real face is in. */
  if (document.fonts && document.fonts.status !== 'loaded') {
    document.fonts.ready.then(function() { killFitNameMeasure(el); });
  }
}

function clearKillTimers() {
  if (killShowTimer)   { clearTimeout(killShowTimer);   killShowTimer   = null; }
  if (killBounceTimer) { clearTimeout(killBounceTimer); killBounceTimer = null; }
  if (killHoldTimer)   { clearTimeout(killHoldTimer);   killHoldTimer   = null; }
  killPhotoEl.classList.remove('ke-bounce');
  killTeamLogoEl.classList.remove('ke-bounce');
}

/* Instantly hides a still-visible popup piece (no animated slide-out) by
   disabling its transition for one frame. Used when a new kill event
   supersedes one that's still on screen — without this, the OLD player's
   photo/name plays its normal ~300ms exit slide before the new one pops
   in, which reads as "the wrong player briefly shows" when kill events
   fire in quick succession (e.g. rapid-fire testing from the dashboard). */
function killSnapHide(clipEl, innerEl) {
  innerEl.style.transition = 'none';
  clipEl.classList.remove('ke-in');
  void innerEl.offsetWidth;
  innerEl.style.transition = '';
}

function showKillEventPlayer(playerName, role, camp, sponsorLogo, extraHoldMs) {
  extraHoldMs = extraHoldMs || 0;
  clearKillTimers();
  /* If a previous popup is still up, snap it away instantly instead of
     letting it slide out — the new photo/name/role only get swapped in
     once the old one is fully gone, so we never swap the image mid-slide
     (see killSnapHide above for why this must be instant, not animated). */
  killSnapHide(killPhotoClipEl, killPhotoEl);
  killSnapHide(killNametagClipEl, killNametagBgEl);
  killSnapHide(killSponsorLogoClipEl, killSponsorLogoEl);
  killSnapHide(killTeamLogoClipEl, killTeamLogoEl);

  killShowTimer = setTimeout(function() {
    killShowTimer = null;
    killPhotoEl.style.visibility = ''; /* undo any previous missing-photo hide */
    killPhotoEl.src = killEventPhotoSrc(playerName);
    killNametagBgEl.style.backgroundImage = 'url(' + killNametagBgSrc(camp) + ')';
    killNameEl.textContent = playerName;
    killFitName(killNameEl);
    if (role && ROLE_ICONS[role]) {
      killRoleIconEl.src = ROLE_ICONS[role];
      killRoleIconEl.style.display = '';
    } else {
      killRoleIconEl.removeAttribute('src');
      killRoleIconEl.style.display = 'none';
    }
    killPhotoClipEl.classList.add('ke-in');
    killNametagClipEl.classList.add('ke-in');
    if (sponsorLogo) {
      killEventApplySponsorFit(sponsorLogo);
      killSponsorLogoEl.src = sponsorLogo;
      killSponsorLogoClipEl.classList.add('ke-in');
    }
    killBounceTimer = setTimeout(function() {
      killBounceTimer = null;
      killPhotoEl.classList.remove('ke-bounce');
      void killPhotoEl.offsetWidth;
      killPhotoEl.classList.add('ke-bounce');
    }, KILL_POP_ENTER_MS);
    killHoldTimer = setTimeout(function() {
      killHoldTimer = null;
      killPhotoClipEl.classList.remove('ke-in');
      killNametagClipEl.classList.remove('ke-in');
      killSponsorLogoClipEl.classList.remove('ke-in');
    }, KILL_POP_HOLD_MS + extraHoldMs);
  }, KILL_POP_DELAY_MS);

  killPopCycleEndsAt = Date.now() + KILL_POP_DELAY_MS + KILL_POP_HOLD_MS + extraHoldMs + KILL_POP_EXIT_MS;
}

/* Wipe Out (10th Anniversary only) — same pop-in/pop-out timing as
   showKillEventPlayer above (shares its timer vars, since only one of the
   two ever runs for a given kill event), but drives the team-logo box
   instead of the photo/nametag/sponsor-logo pieces, and holds
   KILL_TEAMLOGO_EXTRA_HOLD_MS longer. */
function showKillEventTeamLogo(camp, extraHoldMs, tricodeOverride) {
  extraHoldMs = extraHoldMs || 0;
  /* Playoffs pops out on the video's own timeline (see KILL_PLAYOFFS_POP_OUT_AT_MS) — no extra hold */
  var teamLogoExtra = killEventIsPlayoffs() ? 0 : KILL_TEAMLOGO_EXTRA_HOLD_MS;
  clearKillTimers();
  killSnapHide(killPhotoClipEl, killPhotoEl);
  killSnapHide(killNametagClipEl, killNametagBgEl);
  killSnapHide(killSponsorLogoClipEl, killSponsorLogoEl);
  killSnapHide(killTeamLogoClipEl, killTeamLogoEl);

  killShowTimer = setTimeout(function() {
    killShowTimer = null;
    var src = killEventTeamLogoSrc(camp, tricodeOverride);
    if (!src) return; /* unknown camp/team — leave the box empty rather than show a broken image */
    killTeamLogoEl.style.visibility = '';
    killTeamLogoEl.src = src;
    killTeamLogoClipEl.classList.add('ke-in');
    killBounceTimer = setTimeout(function() {
      killBounceTimer = null;
      killTeamLogoEl.classList.remove('ke-bounce');
      void killTeamLogoEl.offsetWidth;
      killTeamLogoEl.classList.add('ke-bounce');
    }, KILL_POP_ENTER_MS);
    killHoldTimer = setTimeout(function() {
      killHoldTimer = null;
      killTeamLogoClipEl.classList.remove('ke-in');
    }, KILL_POP_HOLD_MS + teamLogoExtra + extraHoldMs);
  }, KILL_POP_DELAY_MS);

  killPopCycleEndsAt = Date.now() + KILL_POP_DELAY_MS + KILL_POP_HOLD_MS + teamLogoExtra + extraHoldMs + KILL_POP_EXIT_MS;
}


/* ═══════════════ MCT kill-event popup ═══════════════
   Placement from the MCT reference frames (Triple Kill / Wiped Out): the player's signature photo pops up above the bar's left part, and the
   plate baked into the video's bottom edge gets [team logo][role tile][name]. Wiped Out has no player — its small centre plate gets the wiping
   team's logo + tricode. A "SPONSORED BY" pill (event sponsor of the page's ?set=, see overlay-eventsponsors.js) sits right of the plate.
   All pieces are real DOM children of #ket-root (own ids) and pop with the same timing as the classic popup. */
var ketEls = null;
function ketInit() {
  if (ketEls) return ketEls;
  ketEls = {
    photoClip: document.getElementById('ket-photo-clip'), photo: document.getElementById('ket-photo'),
    logo: document.getElementById('ket-plate-logo'), role: document.getElementById('ket-plate-role'), roleGlyph: document.getElementById('ket-plate-role-glyph'),
    name: document.getElementById('ket-plate-name'),
    sponsor: document.getElementById('ket-sponsor'), sponsorImg: document.getElementById('ket-sponsor-img'),
    wo: document.getElementById('ket-wo'), woLogo: document.getElementById('ket-wo-logo'), woTri: document.getElementById('ket-wo-tri'),
  };
  ketEls.photo.onerror = function() { ketEls.photo.style.visibility = 'hidden'; };
  return ketEls;
}
function ketAllIn(on) {
  var e = ketInit();
  [e.photoClip, e.logo, e.role, e.name, e.sponsor, e.wo].forEach(function(n) { if (n) n.classList.toggle('ket-in', !!on); });
}
function ketSnapHide() {
  var e = ketInit();
  var nodes = [e.photoClip, e.logo, e.role, e.name, e.sponsor, e.wo];
  nodes.forEach(function(n) { n.style.transition = 'none'; n.classList.remove('ket-in'); });
  void e.photoClip.offsetWidth;
  nodes.forEach(function(n) { n.style.transition = ''; });
}
/* white team logo (<TAG>_3.png) when the team has one, else the normal logo (normal = true: always the normal logo) */
function ketSetTeamLogo(img, tricode, normal) {
  if (!tricode) { img.removeAttribute('src'); img.style.visibility = 'hidden'; return; }
  var t = encodeURIComponent(String(tricode).toUpperCase());
  img.style.visibility = '';
  img.onerror = function() { img.onerror = function() { img.style.visibility = 'hidden'; }; img.src = '/assets/team/logos/' + t + '.png'; };
  img.src = '/assets/team/logos/' + t + (normal ? '.png' : '_3.png');
}
function ketTricodeOf(camp) {
  if (!lastData || !lastData.camp_list) return '';
  var c = lastData.camp_list.find(function(cc) { return cc.campid === (camp === 'red' ? 2 : 1); });
  return c && c.team_simple_name ? String(c.team_simple_name).toUpperCase().trim() : '';
}
/* role glyph: cut out of the middle of the MCT ingame Item Check row art, smoothed (8x up-sample + blur + threshold) — same trick as the MVP scene */
var ketGlyphCache = {};
function ketRoleGlyph(roleNum) {
  var lane = ['exp', 'jungle', 'mid', 'roam', 'gold'][(roleNum || 0) - 1];
  if (!lane) return Promise.resolve('');
  if (ketGlyphCache[lane]) return ketGlyphCache[lane];
  return (ketGlyphCache[lane] = new Promise(function(res) {
    var im = new Image();
    im.onload = function() {
      try {
        /* keeps the glyph's own light-cyan -> blue gradient: colour from a plain 8x up-sample, shape (alpha) from a blurred + thresholded copy
           so the outline is smooth */
        var K = 8, W = 52, H = 52;
        var col = document.createElement('canvas'); col.width = W * K; col.height = H * K;
        var cx = col.getContext('2d', { willReadFrequently: true });
        cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
        cx.drawImage(im, 516, 0, W, H, 0, 0, W * K, H * K);
        var shp = document.createElement('canvas'); shp.width = W * K; shp.height = H * K;
        var sx = shp.getContext('2d', { willReadFrequently: true });
        sx.imageSmoothingEnabled = true; sx.imageSmoothingQuality = 'high'; sx.filter = 'blur(' + (K * 0.45) + 'px)';
        sx.drawImage(im, 516, 0, W, H, 0, 0, W * K, H * K); sx.filter = 'none';
        var cd = cx.getImageData(0, 0, W * K, H * K), sd = sx.getImageData(0, 0, W * K, H * K).data, px = cd.data;
        for (var i = 0; i < px.length; i += 4) {
          var a = Math.max(0, Math.min(1, (sd[i + 1] - 105) / 26));
          /* push the colour towards the bright cyan inside the glyph so no dark background halo bleeds into the edge */
          px[i + 3] = Math.round(a * 255);
        }
        cx.putImageData(cd, 0, 0); res(col.toDataURL());
      } catch (err) { res(''); }
    };
    im.onerror = function() { res(''); };
    im.src = '/assets/overlay/M8/Ingame/mct_item' + lane + '.png';
  }));
}
/* sponsor art is a full 1920x1080 canvas with the logo somewhere on it — crop to the logo's own bounding box so it fits the pill */
var ketCropCache = {};
function ketCropArt(url) {
  if (ketCropCache[url]) return ketCropCache[url];
  return (ketCropCache[url] = new Promise(function(res) {
    var im = new Image();
    im.onload = function() {
      try {
        var c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
        var x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0);
        var d = x.getImageData(0, 0, c.width, c.height).data, x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
        for (var yy = 0; yy < c.height; yy += 2) for (var xx = 0; xx < c.width; xx += 2) if (d[(yy * c.width + xx) * 4 + 3] > 20) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
        if (x1 <= x0 || y1 <= y0) { res(url); return; }
        var o = document.createElement('canvas'); o.width = x1 - x0 + 2; o.height = y1 - y0 + 2;
        o.getContext('2d').drawImage(im, x0, y0, o.width, o.height, 0, 0, o.width, o.height); res(o.toDataURL());
      } catch (err) { res(url); }
    };
    im.onerror = function() { res(url); };
    im.src = url;
  }));
}
function ketFitText(el, maxW, maxPx, minPx) {
  var px = maxPx; el.style.fontSize = px + 'px';
  while (el.scrollWidth > (maxW || el.clientWidth) && px > minPx) { px -= 0.5; el.style.fontSize = px + 'px'; }
}


/* The bar's light-blue wave is drawn OVER the player photo in the reference (photo above the navy band, below the wave). The video can't be layered
   in between, so the photo sits above the video and gets a mask cut from the wave itself: one frame of each video (steady state, ~1.8 s) is read
   and every light-blue pixel left of the title text becomes transparent in the mask. Built once per video and cached (pre-warmed after load). */
var KET_CLIP = { x: 650, y: 790, w: 400, h: 210 };   /* must match #ket-photo-clip in mploverlay_v7.css */
var ketMaskCache = {};
function ketMaskFor(video) {
  if (ketMaskCache[video]) return ketMaskCache[video];
  return (ketMaskCache[video] = new Promise(function(res) {
    var v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    v.onerror = function() { res(''); };
    v.onloadedmetadata = function() { v.currentTime = Math.min(1.8, (v.duration || 4) * 0.45); };
    v.onseeked = function() {
      try {
        var c = document.createElement('canvas'); c.width = KET_CLIP.w; c.height = KET_CLIP.h;
        var x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(v, KET_CLIP.x, KET_CLIP.y, KET_CLIP.w, KET_CLIP.h, 0, 0, KET_CLIP.w, KET_CLIP.h);
        var d = x.getImageData(0, 0, c.width, c.height), px = d.data;
        for (var yy = 0; yy < c.height; yy++) for (var xx = 0; xx < c.width; xx++) {
          var i = (yy * c.width + xx) * 4, pageX = KET_CLIP.x + xx;
          var w = 0;
          if (pageX < 965) {   /* the title text starts right of this; only the wave lives to its left */
            var a = px[i + 3] / 255, g = px[i + 1], b = px[i + 2], r = px[i];
            w = a * Math.max(0, Math.min(1, (g - 120) / 50)) * Math.max(0, Math.min(1, (b - 170) / 40)) * (r < 200 ? 1 : 0);
          }
          px[i] = px[i + 1] = px[i + 2] = 0; px[i + 3] = Math.round((1 - w) * 255);
        }
        x.putImageData(d, 0, 0); res(c.toDataURL());
      } catch (err) { res(''); }
    };
    v.src = killEventVideoPath(video);
  }));
}
function ketApplyMask(video) {
  var e = ketInit();
  ketMaskFor(video).then(function(m) {
    var v = m ? 'url(' + m + ')' : 'none';
    e.photoClip.style.webkitMaskImage = e.photoClip.style.maskImage = v;
    e.photoClip.style.webkitMaskSize = e.photoClip.style.maskSize = '100% 100%';
  });
}
if (killEventIsMct()) {
  window.addEventListener('load', function() {
    setTimeout(function() { Object.keys(KILL_EVENT_MCT_VIDEO).forEach(function(v, i) { setTimeout(function() { ketMaskFor(v); }, i * 400); }); }, 3000);
  });
}

function ketShowPlayer(playerName, role, camp, sponsorLogo, extraHoldMs) {
  var e = ketInit();
  extraHoldMs = extraHoldMs || 0;
  clearKillTimers();
  ketSnapHide();
  ketApplyMask(killEventCurrent);
  killShowTimer = setTimeout(function() {
    killShowTimer = null;
    e.photo.style.visibility = '';
    e.photo.src = 'assets/photo/hires/FRONT_web/' + encodeURIComponent(playerName) + '_FRONT.webp';   /* MCT uses the FRONT pose */
    e.name.textContent = playerName;
    e.name.style.display = 'block'; ketFitText(e.name, 0, 14, 8);
    ketSetTeamLogo(e.logo, ketTricodeOf(camp));
    ketRoleGlyph(role).then(function(g) { e.roleGlyph.style.backgroundImage = g ? 'url(' + g + ')' : 'none'; });
    var showSponsor = function(src) { if (src) { e.sponsorImg.src = src; e.sponsor.classList.add('ket-in'); } };
    e.wo.classList.remove('ket-in');
    [e.photoClip, e.logo, e.role, e.name].forEach(function(n) { n.classList.add('ket-in'); });
    if (sponsorLogo) ketCropArt(sponsorLogo).then(showSponsor);
    killBounceTimer = setTimeout(function() {
      killBounceTimer = null; e.photo.classList.remove('ke-bounce'); void e.photo.offsetWidth; e.photo.classList.add('ke-bounce');
    }, KILL_POP_ENTER_MS);
    killHoldTimer = setTimeout(function() { killHoldTimer = null; ketAllIn(false); }, KILL_POP_HOLD_MS + extraHoldMs);
  }, KILL_POP_DELAY_MS);
  killPopCycleEndsAt = Date.now() + KILL_POP_DELAY_MS + KILL_POP_HOLD_MS + extraHoldMs + KILL_POP_EXIT_MS;
}
/* Wiped Out: `camp` = the team that did the wiping ('blue'/'red'), tricodeOverride = manual test */
function ketShowTeam(camp, extraHoldMs, tricodeOverride) {
  var e = ketInit();
  extraHoldMs = extraHoldMs || 0;
  clearKillTimers();
  ketSnapHide();
  killShowTimer = setTimeout(function() {
    killShowTimer = null;
    var tri = tricodeOverride ? String(tricodeOverride).toUpperCase() : ketTricodeOf(camp);
    if (!tri) return;
    e.woTri.textContent = tri;
    ketSetTeamLogo(e.woLogo, tri, true);   /* on the light plate the normal (colour) logo reads better than the white one */
    e.wo.classList.add('ket-in');
    killHoldTimer = setTimeout(function() { killHoldTimer = null; ketAllIn(false); }, KILL_POP_HOLD_MS + extraHoldMs);
  }, KILL_POP_DELAY_MS);
  killPopCycleEndsAt = Date.now() + KILL_POP_DELAY_MS + KILL_POP_HOLD_MS + extraHoldMs + KILL_POP_EXIT_MS;
}
function ketHide() { if (ketEls) ketAllIn(false); }

function hideKillEventPlayer() {
  clearKillTimers();
  ketHide();
  killPhotoClipEl.classList.remove('ke-in');
  killNametagClipEl.classList.remove('ke-in');
  killSponsorLogoClipEl.classList.remove('ke-in');
  killTeamLogoClipEl.classList.remove('ke-in');
  killPopCycleEndsAt = 0;
}

/* Defers hiding #kill-event-overlay until the player popup (if any) has
   fully finished its pop-down transition, instead of yanking it away
   mid-animation the instant the video ends. Guarded by a token so a
   stale deferred hide can never clobber a video that started after it. */
function scheduleOverlayHide() {
  var token     = killEventToken;
  var remaining = killPopCycleEndsAt - Date.now();
  function finish() {
    if (killEventToken === token) killOverlayEl.style.display = 'none';
  }
  if (remaining > 0) setTimeout(finish, remaining);
  else finish();
}

killVideoEl.addEventListener('ended', function() {
  killClearPause();
  scheduleOverlayHide();
  killEventPlaying = false;
  killEventCurrent = null;
  playNextKillEvent();
});

/* safety net: if video stalls or errors, don't get stuck */
killVideoEl.addEventListener('error', function() {
  killClearPause();
  scheduleOverlayHide();
  hideKillEventPlayer();
  killEventPlaying = false;
  killEventCurrent = null;
  playNextKillEvent();
});

/* Item Check / Emblem Check / Gold Diff Check each cover a big chunk of
   the screen — a kill event popping in on top of (or getting covered by)
   one of those reads as broken. icShouldShow/eccShouldShow/gdcShouldShow
   are declared in overlay-itemcheck.js/overlay-emblemcheck.js/
   overlay-golddiffcheck.js — safe to reference here even though this
   script loads first in ingame.html, since every call site below
   only runs from an event handler fired well after all scripts have
   finished their top-level execution. */
function killEventsBlocked() {
  return icShouldShow || eccShouldShow || gdcShouldShow;
}

function playNextKillEvent() {
  if (killEventPlaying || killEventQueue.length === 0) return;
  if (killEventsBlocked()) return; /* stays queued — resumes via the blocking overlay's AnimateOut */
  killEventPlaying = true;
  killEventToken++;
  var entry = killEventQueue.shift();
  killEventCurrent = entry.video;
  killClearPause();
  killVideoEl.src = killEventVideoPath(entry.video);
  killOverlayEl.style.display = 'block';

  var pauseCfg = killEventPauseCfg(entry.video);
  killPauseArmed = !!pauseCfg;
  if (killPauseArmed && KILL_EVENT_HAS_RVFC) killArmFramePause();
  /* Wipe Out has no acting player. Under 10th Anniversary it shows the
     wiping team's logo instead (see showKillEventTeamLogo above); under
     Regular it shows nothing, same as before this feature existed —
     Wipe Out is the one kill event where "no playerName" doesn't just
     mean "no popup at all", so it needs its own check ahead of the
     generic playerName branch below. */
  var isAnniversaryTheme = document.documentElement.getAttribute('data-theme') === '10th_anniversary' || killEventIsPlayoffs(); /* team-logo Wipe Out: anniversary + playoffs */
  if (killEventIsMct()) {
    if (/^perfect(turtle|lord)\.webm$/.test(entry.video)) hideKillEventPlayer();   /* Perfect Turtle / Lord: just the webm, no player popup */
    else if (entry.video === 'wipedout.webm' && (entry.camp || entry.teamTricode)) ketShowTeam(entry.camp, killEventHoldExtensionMs(entry.video), entry.teamTricode);
    else if (entry.playerName) ketShowPlayer(entry.playerName, entry.role, entry.camp, killEventSponsorLogo(entry.video), killEventHoldExtensionMs(entry.video));
    else hideKillEventPlayer();
  } else if (entry.video === 'wipedout.webm' && isAnniversaryTheme && (entry.camp || entry.teamTricode)) {
    showKillEventTeamLogo(entry.camp, killEventHoldExtensionMs(entry.video), entry.teamTricode);
  } else if (entry.playerName) {
    showKillEventPlayer(entry.playerName, entry.role, entry.camp, killEventSponsorLogo(entry.video), killEventHoldExtensionMs(entry.video));
  } else {
    hideKillEventPlayer();
  }

  killVideoEl.play().catch(function() {
    killClearPause();
    scheduleOverlayHide();
    hideKillEventPlayer();
    killEventPlaying = false;
    playNextKillEvent();
  });
}

/* receive kill event trigger from dashboard preview postMessage */
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'killevent') {
    enqueueKillEvent(e.data.video, e.data.priority || 1, null, null, null, null);
  }
});

function enqueueKillEvent(video, priority, playerIdx, playerName, role, camp, teamTricode) {
  if (!featureEnabled.killevents) return;
  if (killEventIsMct()) {
    if (!KILL_EVENT_MCT_VIDEO[video]) return;                   /* no MCT video for this one (Double Kill, Perfect Lord) */
  } else {
    if (video === 'perfectturtle.webm' || video === 'perfectlord.webm') return;   /* MCT-only */
    if (video === 'lordsteal.webm') video = 'lordslain.webm';  /* other themes: a steal is just a normal slain */
    if (video === 'turtlesteal.webm') video = 'turtleslain.webm';
  }
  /* deduplicate: don't queue if same video is already playing or already queued */
  if (killEventCurrent === video) return;
  if (killEventQueue.some(function(e) { return e.video === video; })) return;
  killEventQueue.push({ video: video, priority: priority, playerIdx: playerIdx || null, playerName: playerName || null, role: role || null, camp: camp || null, teamTricode: teamTricode || null });
  playNextKillEvent();
}

/* Forces a representative sponsored kill event into a frozen, held-open
   state — used only as the dashboard Edit tab's showFn for positioning
   the sponsor logo (see mploverlay_v7_killevent in dashboard.html). A
   real kill event plays through in ~2s and auto-hides after ~1.3s, both
   of which make it useless to actually see and drag — this bypasses
   playNextKillEvent()/the queue entirely, plays the video only up to its
   normal KILL_EVENT_PAUSE freeze point and leaves it paused there
   instead of resuming, and shows the player popup + sponsor logo with no
   auto-hide timer. */
function previewKillEventSponsor() {
  /* Always previews a video that's actually sponsored under the current
     theme — Turtle Slain for Regular, Double Kill for 10th Anniversary
     (see killEventSponsorLogo above). */
  var video = document.documentElement.getAttribute('data-theme') === '10th_anniversary'
    ? 'doublekill.webm'
    : 'turtleslain.webm';
  clearKillTimers();
  killEventToken++;
  killPauseArmed = false;
  killEventCurrent = video;
  killOverlayEl.style.display = 'block';
  killVideoEl.src = killEventVideoPath(video);

  var freezeAt = ((killEventPauseCfg(video) || {}).atFrame || 75) / KILL_EVENT_FPS;
  function holdFrame() {
    if (killVideoEl.currentTime < freezeAt) return;
    killVideoEl.pause();
    killVideoEl.removeEventListener('timeupdate', holdFrame);
  }
  killVideoEl.addEventListener('timeupdate', holdFrame);
  killVideoEl.play().catch(function() {});

  killPhotoEl.style.visibility = '';
  killPhotoEl.src = killEventPhotoSrc('PREVIEW');
  killNametagBgEl.style.backgroundImage = 'url(' + killNametagBgSrc('blue') + ')';
  killNameEl.textContent = 'PREVIEW';
  killFitName(killNameEl);
  killRoleIconEl.removeAttribute('src');
  killRoleIconEl.style.display = 'none';
  killPhotoClipEl.classList.add('ke-in');
  killNametagClipEl.classList.add('ke-in');
  var previewLogo = killEventConfiguredLogo(video);
  if (previewLogo) { killEventApplySponsorFit(previewLogo); killSponsorLogoEl.src = previewLogo; killSponsorLogoClipEl.classList.add('ke-in'); }

  /* Also preview the Wipe Out team-logo box so it's positionable from the
     same Edit tab config — harmless under any theme, it just never shows
     live outside 10th Anniversary Wipe Out (see playNextKillEvent above). */
  killTeamLogoEl.style.visibility = '';
  killTeamLogoEl.src = killEventTeamLogoSrc('blue') || '';
  killTeamLogoClipEl.classList.add('ke-in');
}
