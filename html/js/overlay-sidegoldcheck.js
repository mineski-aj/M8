/* ── [FEATURE: sidegold-check] ─────────────────────────────────────
   Ranks all 10 players by total gold earned. See
   overlay-sidecheck-core.js for the shared panel/animation logic and
   the .sidecheck-* CSS block in mploverlay_v7.css for layout notes.
   Uses its own background (sidestatbackgold.png, already has a title
   baked into the art) instead of the shared sidestatback.png, so no
   headerText — the other side-check panels keep the plain background
   + text header combo. */
const sgcPanel = createSideCheck({
  clipId:     'sidegold-check-clip',
  overlayId:  'sidegold-check-overlay',
  bgSrc:      'assets/overlay/ingame/sidestatbackgold.png',
  statField:  'gold',
  formatStat: seat => sidecheckFormatK(seat && seat.gold),
});

/* MCT: same "Players" list as Players Damage (createMctPlayersPanel, overlay-sidedamagecheck.js — loads first), only the header art differs. */
const sgmPanel = createMctPlayersPanel({ rootId: 'sgm-root', titleFile: 'titlegold', statField: 'gold' });
let sgcActiveMct = false;
function sgcAnimateIn()  { sgcActiveMct = sdcIsMct(); (sgcActiveMct ? sgmPanel : sgcPanel).animateIn(); }
function sgcAnimateOut() { (sgcActiveMct ? sgmPanel : sgcPanel).animateOut(); }
