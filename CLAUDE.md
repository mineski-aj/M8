# M8 overlay server — instruction manual

MLBB (Mobile Legends: Bang Bang) esports broadcast overlay system, trimmed to **three overlay pages** — **Draft** (`html/Draft.html`), **Ingame** (`html/ingame.html`) and **Postgame** (`html/postgame.html`) — plus the dashboard that controls them. Each overlay is a browser-source HTML page (OBS/vMix reads it), driven by the live Battledata feed (and the HRM heart-rate server) and controlled from `html/dashboard.html`. Everything else from the old multi-page project (Draft, Waiting TVC/Lobby, Line-Ups, Standings, Bracket, Team Hexagon, Final Team, Today's Schedule, L3 tags, LED wall, ENTVC, Sponsor TV, heatmap.html …) was deleted when this repo was started; it lives in the original `overlay_server` repo's history. Read this before touching anything.

## Running it

```
node server.js        # or: npm start   (port 3000; dashboard at /html/dashboard.html)
```
**`routes/*.js` and `lib/*.js` are NOT hot-reloaded — a restart is required.** `html/*.html` changes apply on next page load. If you edit a route or `lib/` file, say so and ask before restarting: the server is usually the user's own terminal process, never kill/relaunch it silently. Don't assume an earlier route edit is live — ask whether they've restarted.

Never `pkill` Edge by app name (see memory); kill only a test instance by debug port.
Don't commit unless asked.

## Map

- `server.js` — Express entrypoint (static files + mounts `routes/`). `routes/*.js` = API endpoints (`overlay.js` show/hide + feature toggles, `devapi.js` settings/URLs/proxies, `match.js`, `feed.js`, `fights.js`, `positions.js`, `postgame.js`, `overlayStyles.js`, `eventLog.js`, `dashboard.js`). `lib/` = shared server code (`state.js`, `pollers.js`, `game.js`, `rawAdapter.js`, `feedDerived.js`, `gameRefresh.js`, `hrmPoller.js`, `apiMode.js`, `theme.js`, `matchState.js`, …).
- `html/ingame.html` (+ `mploverlay_v7.css`) — **Ingame**: thin shell, one `js/overlay-*.js` per feature + `overlay-core.js` (state/polling) and `overlay-debug.js` (debug bar, SSE, most detection logic).
- `html/postgame.html` — **Postgame**: all post-game "scenes" in one file (Post Hearts/Timeline/Emblem/Items/Stats/Heatmap/H2H/Carry/4 Key/Gold Distribution/Kill Events, Rich Guy, Consolidated Post 1+2, MVP Scene, MVP Highlights, Credit Reel, Tomorrow's Schedule, Matchboard/Middleboard/Playerboard). Its Edit-tab style bucket is still named `mplfs` (`overlay_styles.json`, `/overlay/mplfs-scene`, `state.mplfsScene`) — kept so saved layouts survive; don't rename.
- `html/Draft.html` — **Draft** (pick/ban): restored and re-pointed at the built-in game feed. It polls `/api/gamedata-proxy` with `GameRefresh.loop` (same adapter path as Ingame — never the upstream URL) and reads only draft fields the raw feed carries: `data.state` / `state_left_time` / `game_time`, per seat `heroid` `ban_heroid` `picking` `banning` `ban_order` `pick_order` (plus `camp_list[].ban_hero_list`, unused). Pick plates sit on the seat (seat = lane, icon from `seat.role` else seat index); **ban slots fill in `ban_order` rank** per camp (the feed numbers bans and picks on one 1..20 timeline); status text / countdown hide once `game_time > 0`. Coach name/headset come from Match Board's manual coach field (`/match/state`), not the feed. Server: `/overlay/draft/show|hide`, `/overlay/draft-state`, `/overlay/draft-photo-mode[/:mode]`, `/overlay/mapdetailv2/*` (`routes/overlay.js`, `state.draftActive/draftPhotoMode/mapDetailV2`); short link `/draft/<SET>`. Dashboard: Control entry `draft` (`deferredPreview` — iframe stays `about:blank` until ◈ Preview, `?preview=1`), Edit configs `draft_mapbug/mapdetail2/matchgame` (style bucket `Draft`). **Dropped on purpose** (they needed external Draft/Recap/Predict/Stats APIs the Dire feed doesn't have): Draft Predict v3, Draft Recap, Draft Stats reveal + buff badges, `/proxy/predictions`, `/api/draft-url|draft-recap-url|predictions-url`, `/api/draft-roles`. Leftover dead Draft Stats code in the page is gated off by `draftStatsEnabled = false`. Draft pick videos: `assets/hero/webm/HERO_PICK_DRAFT_<id>.webm`; hero icons `assets/hero/web/*.webp`.
- `html/dashboard.html` — control panel. Control sidebar lists **Draft Overlay**, **Postgame** (OVERLAYS id `mplfs`) and **Ingame** (id `mploverlay7`); tabs: Match Board, Arrangement, Control, Roster, Sponsors, Edit, Settings, Logs. Iframes: `match-dashboard.html`, `arrangement-dashboard.html` (Ingame seat order), `roster-dashboard.html`, `sponsors-dashboard.html`.
- `html/js/overlay-shared-worker.js` + `overlay-sse-shim.js` — the ONE real `/overlay/events` connection per browser. `theme-apply.js` — global theme. `event-log-client.js` — Logs tab reporting. `hero-web.js` — WebP hero art w/ PNG fallback. `sponsor-cursor.js` — shared sponsor-loop resume point. `game-refresh.js` — Game API refresh rate. `po-gold-text.js`, `relay-client.js`, `cache-bust.js`.
- **All assets live under `assets/`** (layout below). Nothing asset-like at repo root.
- **`data/`** holds every runtime JSON/txt file (`match_state`, `overlay_styles`, `theme`, `api_mode`, `config` (dashboard password), `game_api_url`, `hrm_api_url`, `post_info_api_url`, `highlights_api_url`, `winrate_api_url`, `goldinfo_api_url`, `mainroster`, `heronames`, `credits_reel.txt`, `battledata_sample_m8.txt`, …) plus `data/postgames/`. Live state — don't hand-edit. Server code reads them as `path.join(__dirname, '..', 'data', '<file>')`; pages that fetch one directly use `/data/<file>`.
- Repo root keeps only `server.js`, `package*.json`, `CLAUDE.md`, and the folders `assets data html lib routes Tools HRMServer HRMServer_Sim`.

## Asset layout (`assets/`) — put new files in the matching folder

```
assets/
  hero/      web/ (512px WebP icons, HERO_<id>_KOTAK.webp)  mvp_web/ (MVP_<id>.webp)  highlights/ (<id>heromvp.webp)  post/ (<id>_POST_HERO.webp)
  photo/     player photos by pose: FRONT DEFEAT LEFT RIGHT SIGNATURE VICTORY (small <ign>_<POSE>_resized.webp) (+ placeholder.png, Dynamic/3_CROPPED BNW, "Playoffs Sched", broll)
             hires/<POSE>_web/<ign>_<POSE>.webp (full-size WebP; the PNG originals were deleted)
  game/      items/ role/ spell/ emblem/ maps/      (game-data icons)
  team/      logos/<TRI>.png
  sponsor/   MAIN/ ID/ MY/ PH/ = 4 country sets, each with its own logos (+ white/) AND its own categories/order/durations (data/sponsors_config.json -> sets.<SET>); routes take ?set=, default MAIN — see "Sponsor sets" below
  fonts/     Anton, General Sans
  webm/      shared background loops (bgloop*, phase2_anniv*), motion/ (kill-event webms), playoffs/ (playoffsbg_*.webm)
  common/    shared images (mpl2026logo.png)
  overlay/   per-scene art for the remaining scenes (ingame, postgame, PostH2H, consolidated_post, mvp, highlights, credits, postkill, richguy, post_heart, visacarry, noisemeter, shared Waiting/Today header+box art used by Tomorrow's Schedule, …); optional playoffs/ and anniversary/ theme subfolders use the same filenames
```
Server-side dirs that read from disk: `routes/devapi.js` (`SPONSORS_ROOT`, `PHOTOS_DIR`, `LOGOS_DIR`), `routes/overlay.js` (`PHOTOS_DIR`, `HIRES_FRONT_DIR`). Escaped-slash regexes (`hero-web.js`, `hiresWebUrl` in postgame.html) hold paths as well — update them when moving things.

## Game feed adapter — M8 V2 raw battle feed (`lib/rawAdapter.js`)

On this branch the Game API is the RAW battle feed (`camp_list[].player_list[]` + `data.incre_event_list`, sample: `data/battledata_sample_m8.txt`). Every overlay still reads the old enriched shape (`seat_1..5`), so `normalizeGameFeed()` converts it in ONE place: `pollGameAPI` (lib/pollers.js) and `/api/gamedata-proxy?fresh=1` (routes/devapi.js). Pages never see raw. An already-enriched payload (has `seat_1`) passes through; any failure falls back to the raw payload. Referee camp (campid 5, `judger`) is left untouched.
- **Seat = lane:** seat_1 EXP, 2 JUNGLE, 3 MID, 4 ROAM, 5 GOLD (+ `role` string). The raw feed has NO role, so `resolveRoles()` infers it: jungler = Retribution (20020), roamer = only player with `gold_map[5]`, gold = most `gold_map[1]` among the rest (locked at 4:00), EXP/MID = lower `pos` first (**provisional guess — replace `resolveRoles` with the M8 V2 pos/role tracking rules**). Locks reset per battleid.
- **Derived:** `hero_name` (heronames.json), `equip_list` -> `{value,…}`, `extra_param` (kda/gpm/goldk, first_blood / multi-kills / legendary from `kill_hero` markers, kill_lord/kill_tortoise from `kill_boss`), `level_percent`/`level_eta` (XP table `XP_AT`: levels 13-15 measured, **2-12 are a fitted estimate**; eta = time to MAX level), health/mana %, `kda_rate`, `goldrate`, `goldDiffPlayer` (vs the opposite seat), `dmg_tkn_death`, `roaming_type` (roam boot ids), `rune_map_N`, team totals, `blessing_gold` (= camp's `gold_map[5]`, assumed), `kill_lord_advantage` (latest window), `enemy_area_get` (summed).
- **NOT recoverable (left absent/empty):** `hit_rate` (null upstream), `rank_*`, `emblem_list`, `last_emblem`. Unknown `kill_hero` markers are logged once (`[rawAdapter] unknown kill_hero marker`) — quadra/penta names are guesses.
- **mploverlay_v7 reads the feed ONLY through `/api/gamedata-proxy`** (`currentApiUrl` in overlay-core.js) — it used to fetch the upstream URL straight from the browser, which skipped this adapter entirely. Never point a page at the upstream URL.
- **Side Gold Distri / Side KDA Distri** no longer use their external APIs when the raw feed is active: `lib/feedDerived.js` builds `/api/golddistri-data` (one lane's two players, from `gold_map`) and `/api/kdadistri-data` (featured player vs the 5 enemy lanes, counted from `kill_hero` events — `killer_id`/`killed_id`/`assister[]` equal the players' `roleid`). The lane / featured player are chosen from the Ingame control buttons (`/overlay/distri/gold-role/:role`, `/overlay/distri/kda/:camp/:role`; default exp / blue EXP). `jungle_stolen` (Stolen Gold overlay) = summed `enemy_area_get`.
- **Cannot work on the raw feed:** Live Win Rate (needs the Winrate API's probability model), Trinity / First Item Priority "phase 2" core-item timing (`core_item`/`first_item`), Sky Piercer stacks (`sky_piercer_stack`), Gold Graph V2 (needs the Gold Info API; V1 works from the server's position log), skill-accuracy stats (`hit_rate`). They degrade silently (no panel / card without the timing line), no errors.
- **Testing without a live game:** point Settings → Game API (DEBUG) at `http://localhost:<port>/api/battledata-m8` (serves the raw sample through the same adapter). `lib/rawAdapter.js` is pure — require it in node to replay payloads offline.

## Game API refresh rate (Settings → Battledata API → "Refresh rate (ms)", default 150)

`data/game_refresh.json` `{ms}` (50–5000), `lib/gameRefresh.js`, `GET/POST /api/game-refresh`. **Server:** `pollGameAPI` is a self-rescheduling `setTimeout` that re-reads the value every tick (no restart to change it). Everything that counts "ticks" (BPM samples `tickStats`, `positionLog` + its save counter, `tickFight`, the per-tick console line) is gated on `secTick` = game second changed, so it behaves like the old 1s poll — keep new per-tick bookkeeping behind `secTick`. `/api/gamedata-proxy?fresh=1` serves the poller's cache when it is < max(1.5s, 4×refresh) old instead of hitting the upstream. **Pages:** include `html/js/game-refresh.js` and poll with `GameRefresh.loop(fn)` (awaits `fn`, waits `ms()`, never overlaps; re-reads the setting every 10s — no SharedWorker/KNOWN_EVENTS change). Wired: `overlay-debug.js` masterPoll (mploverlay_v7), `led_overlay.html`, `Led_draft.html`, `ingame_blue/red.html`. **Not** on it (deliberately): mplfs Middle/Player Board's 3s unified poll (it also hits postinfo + match state), Hearts/Richguy/Draft-Index pollers, and one-shot `fetch`es at scene show. Any NEW page that polls the game feed should use `GameRefresh.loop`, not `setInterval`.

## Dashboard architecture — connection budget and the SharedWorker

HTTP/1.1 caps a browser at ~6 connections per host, **shared across all tabs**. Too many persistent `EventSource`s makes requests queue forever (dashboard "hangs"). Solution: `overlay-shared-worker.js` holds the single real `EventSource('/overlay/events')` and rebroadcasts over `postMessage`; `createOverlaySSE()` (from `overlay-sse-shim.js`) exposes the same API subset (`addEventListener`, `.onopen`, `.onerror`, `.close()`).

- **Never `new EventSource(...)` on a new page** — include the shim and call `createOverlaySSE()`. (Not yet migrated: `fights.html`, deferred on purpose.)
- **New named SSE event → add it to `KNOWN_EVENTS` in the worker AND bump `OVERLAY_WORKER_VERSION` in the shim (currently ~38).** Workers are reused by exact URL; without the `?v=N` bump, already-open tabs/browser-sources keep the old worker and silently never get the event. Bump on any worker change.
- `dashboard.html` also fans its one connection out to its iframes via `relay-client.js` (`connectRelay`, `relayCache`/`relaySend`) — a separate, narrower layer than the worker.
- Control `#preview-iframe` and Edit `#edit-iframe` unload on tab switch. **To unload an iframe set `src = 'about:blank'`, never `''`** (empty string loads the parent page recursively).
- **The dashboard must live-sync via SSE:** `dashboardSSE` caches `featureStates` / `checkOverlayStates` / `mplfsSceneState`. Every new show/hide feature MUST get a listener there, or its toggle drifts out of sync silently. Click handlers only fire the request; the SSE echo updates the UI.
- **Done = verified in a real browser,** not `curl`: load a fresh page (new context, no stale worker), click the real Control-tab button, confirm a *separate* tab reacts.

## The #1 rule: every element is independently editable

Every image/video/text gets its own id/class and absolute position — never nested in a shared positioning wrapper — so it can be dragged in the Edit tab. Three things must use the exact same selector string (a miss = dead Edit row, no error):
1. the real `id`/`class` in the page DOM;
2. `..._DEFAULTS` in `dashboard.html` (`{left,top,width,height[,fontSize]}` keyed by selector);
3. `..._ELEMENTS` in `dashboard.html` (`{group,id,name}`).

`group` is functional: arrow-key nudging moves every element in the same group together — give an element its own group unless it should be tied to siblings. Register in `EDIT_CONFIGS`:
```js
mplfs_foo: { label:'Foo Scene · mplfs', file:'postgame.html', styleFile:'mplfs',
  defaultsKey:'sb_edit_defaults_mplfs_foo', elements:FOO_ELEMENTS, defaults:FOO_DEFAULTS, showFn:'showFooScene' },
```
Pasted design-tool CSS: take **only `left/top/width/height`**; ignore colours, z-index, radius etc. (the real art is a named asset). Children are positioned relative to their named parent container, not the canvas.

## Scene architecture (postgame.html)

Each scene is a 1920x1080 transparent container (`#foo-page`: `display:none; opacity:0; transition: opacity 400ms`; classes `foo-on` then `foo-visible`). Show: fetch data → `await transitionTo('foo')` → guard `activeFeature === 'foo'` → apply → `preloadMedia` → `showSceneVideo('foo')` → add `foo-on`, force reflow, add `foo-visible`. Hide: `activeFeature = null`, remove `foo-visible`, `setTimeout(~420ms)` to remove `foo-on` + `hideSceneVideo()`. **Never hide on `animationend`** — use setTimeout + the `activeFeature` guard.

Copy the closest existing scene (MVP Scene is the most complete) rather than starting blank.

## Checklist A — new postgame.html scene (shares the `activeFeature` slot)

All steps use the **same feature key**; every miss is silent.
1. CSS container + per-element rules; HTML; JS (fetch → apply → show/hide as above). Text that must fit uses a shrink-to-fit helper (min size ≈ half of max).
2. **Background:** if it wants the shared ambient loop, add to `SCENE_VIDEO_SRC` (match sibling family, e.g. Posts use `bgloopwaves2.webm`). If it has its own full-bleed art, add nothing (the `if (SCENE_VIDEO_SRC[newFeature])` guard handles it — don't hardcode exception lists).
3. **Post-family:** add to `POST_FEATURES` in `transitionToImpl` and decide middle/player board handling (some special-case it).
4. Edit tab: `FOO_DEFAULTS`, `FOO_ELEMENTS`, `EDIT_CONFIGS`.
5. **Live control (6 layers):** (a) `routes/overlay.js` `/overlay/foo/show|hide` — set `state.mplfsScene.activeFeature`, write `event: foo` to every `state.overlayClients`; (b) `connectSSE()` listener in postgame.html; (c) line in `hideActiveFeature()`; (d) line in `restoreScene()`; (e) `OVERLAYS` → `id:'mplfs'` → `features` entry in dashboard.html (generates SHOW/HIDE/Preview/copy buttons); (f) `MPLFS_ACTIVE_FEATURE_MAP` (key = `feat.show.split('/')[2]`) — forgetting only breaks the "● Showing" indicator.
6. **Preview:** add a branch to `window.previewTrigger`. The route/SSE event name often differs from the internal `activeFeature` name (`post_stats` vs `stats`, `final_team` vs `finalteam`, `team_lineup_blue` vs `lineupblue`) — read the real SSE listener, don't guess. Most commonly forgotten step.
7. **Event log verdict:** add to `olScenes` at the bottom of postgame.html's main script.
8. New SSE event name → `KNOWN_EVENTS` + `OVERLAY_WORKER_VERSION` bump.
9. Grep every selector/key across files for mismatches. Syntax-check every touched file:
```
node -e "const fs=require('fs');for(const f of ['html/postgame.html','html/dashboard.html']){const s=fs.readFileSync(f,'utf8');[...s.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].forEach((m,i)=>{try{new Function(m[1])}catch(e){console.log(f,i,e.message)}})}"
```
(`node --check` for `lib/`/`routes/` files — never `require` pollers, it hangs on timers.)
10. Verify live: real Control toggle → separate tab reacts; Preview shows only in the iframe and `curl /overlay/mplfs-scene` is unchanged; board state correct after switching scenes; copy buttons copy the right URL.

Optional local debug card: add a `feature-card` in postgame.html's `` ` `` debug bar calling `showFooScene()`/`hideFooScene()`/`toggleLocalPreview('foo', this)` (also add `'foo'` to `toggleLocalPreview` and `previewTrigger` chains). Local only.

## Checklist B — checkOverlays pattern (independent on/off panels, e.g. the Ingame v7 panels)

1. Boolean in `state.checkOverlays` (`lib/state.js`). 2. `/overlay/<key>/show|hide` in `routes/overlay.js` broadcasting a named SSE event (families of near-identical panels share one event with a `check` field, e.g. `sidecheck`). 3. Restore via `GET /overlay/check-overlays`. 4. Client SSE listener toggling a CSS class. 5. Dashboard: `{name,key}` in `checkToggles` (auto toggle + copy buttons), or plain `show`/`hide` fields on the `OVERLAYS` entry for a single scene (`toggleShowHide: true` for a single pill). 6. `dashboardSSE` listener (see above). 7. New event → `KNOWN_EVENTS` + version bump.

- **Default state:** if normally *on*, default CSS to the shown position and add a "hidden" class when told — otherwise every load flashes blank during the restore fetch.
- **A hide animation must clear the whole layer** (`#scoreboard-overlay` hides with `translateY(-1080px)`); re-check when adding a lower child.
- **"Hide all in a group" buttons:** one server route flipping every key and re-broadcasting each panel's OWN existing event — no new event, no client change. Wire via `extraActions`.

## Control-tab Preview — keep it isolated from real broadcast state

- `previewButton: true` → page is already loaded in the iframe; button calls `contentWindow.previewTrigger(event,'show'|'hide')` locally (no SSE).
- **Any `?preview=1` page must decouple from real state:** (1) don't auto-show/hide from real SSE or restore — mplfs uses `isPreviewFrame`, Draft uses `PREVIEW_ONLY`; (2) don't let side effects hit the server (e.g. `syncBoard()` must skip its `fetch` — this once flipped real vMix boards on a preview click). To tell the dashboard, use `window.parent.postMessage(..., location.origin)` (receiver: `previewToggleRegistry`).
- Only one Preview is active at a time: always build via `buildPreviewToggleBtn(eventName)` (uses `activePreviewOff`); `previewToggleRegistry` is for *passive* reflection and bypasses exclusivity.
- `activePreviewOff`, `previewToggleRegistry`, `draftPreviewActive`, `mplfsLiveBadge`, `mapSelectTagBadge` and any new cross-render state referencing `#control-panel-body` DOM must be reset at the top of `buildControlBody()`.
- Testing: `postgame.html?preview=1` + `previewTrigger(event,'show')` renders a scene against the current feed safely.. `DraftIndex*.html` has no preview mode.

## ingame.html — two feature shapes

**Shape 1 — persistent panel:** checkOverlays pattern. Functions share a short prefix (`icBuildPanel/icAnimateIn/icAnimateOut` = item check, `ecc…`, `gdc…`). Side-checks share `SIDE_CHECK_HANDLERS` in `overlay-debug.js`.

**Shape 2 — automatic per-player reactive effect** (Lvl 15, Item Pickup, Trinity, Swap, Conceal, Kill Events, Objective Spawn, Sky Piercer, Lord Advantage). Fires from `masterPoll()` (1s), armable from the dashboard, queued per player. Steps:
1. Arm toggle: key in `VALID_FEATURES` (`routes/overlay.js`, generic `/overlay/feature/:feature/:action`), default in `featureEnabled` (`overlay-core.js`) — **forgetting this default is the real breakage** (the generic `featuretoggle` listener only updates existing keys) — and `{name,feature}` in dashboard `featureToggles` (+ `lib/state.js`).
2. Detection in `registerPollHandler` in `overlay-debug.js`: diff against a `prevXxx` object, gated on `featureEnabled.x`.
3. `triggerYourFeature(i,…)` shaped like `triggerLvl15`: re-entrancy guard on `isPlayingX[i]`; once-only `cleanup()` that resets visuals, clears the flag, and **calls `playNextQueued(i)`**; plus a safety `setTimeout(cleanup, a bit longer than the animation)`.
4. Mutual exclusion: `isPlayingX = {}`, `xQueue = {}` in `overlay-core.js`; add to `isAnyPlaying(i)` and an `else if` in `playNextQueued(i)`.
5. Debug bar: `▶ Pn` buttons + `tab-x`/`data-tab` markup in ingame.html.
6. Preview Tester: branch in `window.iframeTest(playerIdx, feature)` (`previewDebugTester: true`).
7. Verify from a real poll tick — the debug button bypasses detection and proves nothing about step 2.

Feature notes (mostly unverified against a live feed):
- **Sky Piercer** (`overlay-skypiercer.js`): Item Pickup card at stack 3/5/7…; stack from `player.extra_param.sky_piercer_stack.stack` (real path never confirmed).
- **Lord Advantage** (`overlay-lordadv.js`): panel under each tricode for 90s from `camp_list[].kill_lord_advantage.begin_time`, live-updating GOLD/KILLS/TURRET; not in Edit tab.
- **Trinity / First Item Priority phase 2:** at 1.5s the title swaps to a core-item timing line (`coreItemPhase2()` in `overlay-trinity.js`; `core_item`/`first_item` paths unconfirmed); no data → card leaves at 2.4s as before.
- **Kill events:** `killEventTrigger` dashboard picker + Live/Random photo toggle are bespoke. Playoffs webms in `assets/overlay/ingame/playoffs/motion/` have no baked sponsor; sponsor logo is a separate element (`KILL_EVENT_SPONSOR_LOGO`, `killEventApplySponsorFit`).
- **Objective spawn:** `objSpawnPlayNext` picks lord/turtle webm per theme.
- **Gold Graph Check / Live Win Rate:** fixed checkpoints at 2, 5, 8, 12, 15 min then +3 (`ggcMarkMinute`/`lwrMarkMinute`); last group is the live "now" dot. Live Win Rate reads the Winrate API (`/api/winrate-proxy`, `{camp1,camp2,time}`); shares Gold Graph's art; neither restored on page load. Playoffs title art `assets/overlay/ingame/playoffs/graph_header.png` (recoloured Regular art — redo if Regular changes).

## Theme system — Regular / 10th Anniversary / Playoffs

- One global value in `theme.json`, `GET/POST /api/theme` (`routes/devapi.js`, whitelist `THEME_VALID`), broadcast as SSE `theme`; Settings page `<select id="theme-select">` with confirm dialog.
- `html/js/theme-apply.js` (on EVERY broadcast page, after `cache-bust.js`) sets `data-theme` on `<html>`. Its initial read is a deliberately **synchronous XHR** so every later script can read `data-theme` at load time (async fetch caused wrong-asset-every-load bugs). Pages with a live SSE add `sse.addEventListener('theme', e => applyTheme(JSON.parse(e.data).theme))`.
- A 4th theme = update by hand: `THEME_VALID` (devapi.js), `THEME_VALUES` (theme-apply.js), `THEME_VALUES` + `THEME_LABELS` + a `<option>` (dashboard.html). Same for API modes (`API_MODES` in `lib/apiMode.js` + dashboard + 3 `.api-mode-seg-btn`s).
- **Themes are cosmetic by default** (look only — never behavior, timing, layout, or which elements exist). Exception: Playoffs may be a full per-scene re-layout when the user supplies a reference + `assets/<scene>/playoffs/`; do it scoped to `[data-theme="playoffs"]` and leave Regular/10th Anniversary untouched. If tempted to branch behavior on `data-theme` otherwise, confirm first.
- CSS: scope to the specific theme. **Never write `:not([data-theme="regular"])`** or gate on an absent attribute. Where Regular already sets the same property, use a CSS custom property (`--anniv-accent` with a `var()` fallback) instead of a competing rule. JS-picked values (video `src`, asset dirs) use a per-theme lookup table with fallback to Regular (`SCENE_VIDEO_SRC_BY_THEME`/`getSceneVideoSrc`, `gdcAssetDir`, `icAssetDir`, `mbAsset()`), decided at show/build time — theme switches apply on next show/reload.
- Playoffs assets live in a `playoffs/` subfolder with the same filenames as Regular. Check pixel size against the old file. Gold = `#edc555` → `#d0a43e`; black text on gold/white, white on blue/red.
- **"Copy exactly X" means every themed rule scoped to X's id/class family** (asset, background removal, recolour, reposition) — grep for all of them, not just the background image.

### Edit tab is theme-scoped
`overlay_styles.json` (`routes/overlayStyles.js`) stores `{[file]:{[selector]:{left,top,width,height,fontSize}}}`. Regular uses the plain `file` bucket; other themes use `file::theme` (`mplfs::playoffs`). GET merges per selector (themed wins, else Regular). Nudges seed a new themed entry from Regular first. Overrides are injected as `!important`, so **a Regular override beats a plain `[data-theme]` rule: when theme CSS "isn't taking" — or a playoffs `left/top/width/height` loses — check `overlay_styles.json` and seed the `<file>::playoffs` bucket.**

### Playoffs conventions
- **Universal sponsor box (postgame.html):** every playoffs sponsor box shares one CSS block ("PLAYOFFS UNIVERSAL SPONSOR BOX") on the shared classes (`.sponsor-cat-label`, `.wl-/.ws-sponsor-loop`, `.wl-sponsor-bg`/`.wsm-sponsor-bg`) — never per-scene ids. Gold header strip with the sponsor category over a white logo area, 296x120 (37px strip). A new/reworked scene with a sponsor box uses the standard markup (as in `buildTsSponsor`), adds its selector to the "Default box size" rule, seeds position in `mplfs::playoffs`, and gets the Edit row from `addPlayoffsSponsorEdit()` (add its pair to the list above `var EDIT_CONFIGS`). That row edits all playoffs sponsor logos at once (except Consolidated Post 2's).
- **Sponsor loops** use `SponsorCursor.start(len)` / `SponsorCursor.aired(idx)` (`sponsor-cursor.js`) so scenes resume after the last sponsor aired; any new loop must too.
- **BNW photo crops:** `assets/photo/Dynamic/3_CROPPED BNW/<TRI>_<ign>.webp` (`thBnwUrl`) are used by Post 4 Key and Post H2H under playoffs (greyscale + team-colour tint; missing crop → signature portrait). A new player needs this crop, plus `assets/photo/hires_l3/LEFT|RIGHT/<ign>_*.webp` for L3 Lobby, or it silently falls back.
- **Post 4 Key playoffs:** photo container +120px (cards 416x629); `p4kExtendedArt` stretches `bigfour*.png` on a canvas at show time. Bottom of card y=1002.

## Other scene notes

- **Post Gold Distribution** (`post_golddistri`): lanes matched to the game feed by player NAME — spelling mismatches between feeds put lanes wrong. **Post Kill Events** (`post_killevents`): objectives from Post-Info `camp_list`, kill map from `/events` × `/positions`. **Post H2H** page 2 = gold distribution; `GET /overlay/p2hpage/1|2`; each fresh show resets to page 1.
- **Hero art:** `assets/hero/web/HERO_<id>_KOTAK.webp` via `hero-web.js` for postgame/v7 (PNG fallback in `assets/hero/full/`).

## API Mode — LIVE / DEBUG (`lib/apiMode.js`) — WEB was removed; a saved `web` reads as `live`

**Both modes use the built-in self-hosted Dire API for the game feed** (`lib/gameUrl.js` `isSelfHosted()` is always true; the Battledata URL field is hidden and `POST /api/game-url` returns 409). **LIVE** = `dire.onModeChange('live')` forces `refresh()` (judge's current battle straight from the tournament API via `judgeIds.global`) on entry and at server start; Settings shows only **[Refresh]** + Judge ID, and `GET /dire/api/debug` returns 403. **DEBUG** = same plus the **[Debug]** loader (latest battle of the last 24 h). The older text below describing a 3-way switch / saved Battledata URL per mode is superseded for the Game URL; other `*_api_url.json` files (HRM etc.) still keep separate `live`/`debug` values.

Settings → API Mode switches every URL setting between three stored values (`{live, web, debug}` in each `data/*_api_url.json`; `api_mode.json` is the active mode; switching is server-wide and confirm-gated). **Visible in Settings: only the Battledata (Game) API and the HRM Server URL** (+ the refresh rate). The Post-Info, MVP Highlights, Winrate and Gold Info sections still exist but are hidden (`api-hidden-m8` class in `dashboard.html`) — Post Gold Distribution / Post Kill Events / MVP Highlights / Live Win Rate / Gold Graph V2 need those upstream APIs and show nothing without them; remove the class to bring a field back. **Every read/write of those files must go through `readUrlForMode(file, default)` / `writeUrlForMode(file, url)`** — never read the file's `.url` directly (`lib/pollers.js` and `lib/hrmPoller.js` read them too).

## Event log — Logs tab + Control-tab load status

`lib/eventLog.js` (ring of 2000 + `logs/events-YYYY-MM-DD.jsonl`) and `routes/eventLog.js` (`POST/GET /api/event-log`, `/days`, `/download`). Pollers call `eventLog.health(key,label,'ok'|'slow'|'down',info)` (logs only state changes). `event-log-client.js` auto-reports failed/slow fetches, broken media, JS errors; `OverlayLog.warn/critical` for explicit lines; `wrapScenes` (mplfs `olScenes`) gives one verdict per show. **Must stay zero-cost:** nothing awaits logging, never branch on it. `?preview=1` pages report as `preview`.

## Performance and rendering lessons (vMix)

- Headless Edge can't reproduce vMix; measure with `Emulation.setCPUThrottlingRate` ~20x + Tracing + rAF gap logger. **Always A/B** — plausible optimisations have made things worse; revert what doesn't measure better.
- **Cheap:** transform/opacity animation, `will-change` layers, canvas pre-paint, WebP copies with PNG fallback, `img.decode()` before fades, staggered swaps, pausing hidden videos. **Expensive:** full-screen 1080p60 VP9 loops (dominant idle cost), big PNG decode at swap time, animated SVG `d`/mask/clip-path/filter, repainting big tilting containers.
- **Videos:** never `autoplay` an idle full-res loop. `hideSceneVideo()` `.pause()`s ~400ms after fade-out (guard by the captured element's class); `showSceneVideo` skips re-assigning an unchanged `src` and is called in `transitionToImpl` **after** `hideActiveFeature()` is awaited (before, the outgoing scene's delayed hide killed the new layer). `#bg-video` is paused on first frame by design. The playoffs corner-shapes overlay was removed entirely.
- **Baked alpha:** (from the old Draft page) a hero reveal used WebM with real alpha (pre-baked offline) + `destination-in` compositing instead of per-pixel JS. ffmpeg's default VP9 decoder ignores alpha — pass `-c:v libvpx-vp9` to verify. No ffmpeg on this machine (installing needs user OK), so videos can't be re-encoded here.
- **Never size/fit content by measuring a possibly-hidden element** (`scrollWidth/clientWidth/getBoundingClientRect` are meaningless under `display:none`). Use canvas `measureText()` (detached canvas, e.g. `annivTextWidth`) or compute from known values. Same bug class as the theme-apply race.

## Data, assets, fonts

- Game data: `campid` 1 = blue/left/team1, 2 = red/right/team2 everywhere. MVP data from `game-mvp/view` (`/api/highlights-url`, `hlFetchMvp`/`hlExtractPlayer`); match/game number from `/match/state`.
- Paths: `/assets/hero/mvp/MVP_<heroid>.png`, `/assets/hero/highlights/<heroid>heromvp.png`, `/assets/game/items/<id>.png`, `/assets/game/role/<role>.png`, `/assets/team/logos/<TRI>.png`, `/assets/game/emblem/square_<id>_RUNES.png`, player photo via `hlPhotoUrl(name)`.
- **Any `fetch()` of runtime-changing JSON needs `{ cache: 'no-store' }`** (hard refresh doesn't bypass fetch cache).
- **`cache-bust.js` appends `?v=` to every `img.src`** — never compare `img.src`; use a flag/`dataset`. Re-assigning an `<img src>` to a missing file every poll flickers; remember applied/missing URLs (`sbSetImgWithFallback`, `mvSetImgWithFallback`).
- Fonts: **Anton** (black `#0a0a0a`) for big numbers/titles; **General Sans** bold for names, semibold uppercase for labels.

## Gotchas

- Removing CSS with a script can leave orphan declarations that swallow the next rule — render the scene and check neighbours; the syntax check only parses JS.
- Apostrophes in asset paths (`/assets/overlay/Today's Schedule/…`) break inline `onerror="…'…'"` → write `%27`.
- `transform` on a clipped parent doesn't change layout — for scaled groups set the layout box at native size and scale around a fixed origin (mpltag Map Selection scales 0.84 / 0.72 at 6 / 7 games, `applyMapselScale`).
- Sequenced behaviour that reads a measurement, theme, or broadcast before it exists fails deterministically but looks flaky — look for the async gap.

## Verifying with a real browser (no Playwright dependency)

Headless Edge over raw CDP (Node has native `fetch`/`WebSocket`):
```
"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" --headless=new --remote-debugging-port=9222 \
  --user-data-dir=<scratch> --autoplay-policy=no-user-gesture-required about:blank &
```
Get the target's `webSocketDebuggerUrl` from `http://localhost:9222/json`, then `Page.navigate` / `Runtime.evaluate`. Use `--virtual-time-budget` only for short synchronous checks; for video or timer-paced work use a real background process and real sleeps. Never `await` a `Runtime.evaluate` that sets `location.href` (wrap in `setTimeout(...,10);1`). Kill orphaned harness Edge processes (by `--user-data-dir`) before trusting perf numbers.

**Tests must not leave real shared state changed** (`state.mplfsScene`, `checkOverlays`, `api_mode.json`, the `*_api_url.json` files): capture first, restore after (`curl .../fs/hide` fully resets mplfs). Prefer an isolated harness: extract the real `<script>` from the file into a scratch page and expose internals via `window.__test`. Stub fetches via `Page.addScriptToEvaluateOnNewDocument`; jump to a scene's end state by adding its final CSS class. For mpltag.html, a regex `<script>` extraction fails on a comment containing `<script` (ignore) — slice the IIFE by `indexOf` and append `window.__t = {...}`.

## Images are WebP-only for hero / MVP / player photos

Hero icons, MVP art, hero post/highlight art and all player photos exist **only as WebP** (the PNG originals and the old `_web` fallback logic were removed — `hero-web.js` no longer has a PNG fallback, `mvSetImg()` in postgame.html just hides the `<img>` if the file is missing). Add new art with `python3 Tools/png2webp.py lossy <dir>` (quality 90, alpha kept) and keep the filename convention above; `/api/player-photos`, `/api/signature-photos` and `/api/photo-manifest` list `*.webp`. UI art under `assets/overlay/**` is still PNG (theme variants and built-up paths such as `wsTvcAsset(name + '.png')` make a blind rename unsafe).

## Sponsor sets — MAIN / ID / MY / PH (one per country feed)

The Sponsors tab (`html/sponsors-dashboard.html`) has four tabs, one per set; each edits that set's categories / logo order / durations and the logos come from `assets/sponsor/<SET>/` (+ `white/`). `data/sponsors_config.json` = `{ sets: { MAIN, ID, MY, PH } }` (a legacy flat file is read as MAIN); saving one set never touches the others. Server: `/api/sponsors?set=` (play list, honours `ingame=1`), `/api/sponsors-config?set=` (GET) and POST `{ token, set, data }` — `sponsorSet()` in `routes/devapi.js` validates the name and falls back to MAIN. **Pages choose their set from their own URL: `html/js/sponsor-set.js` → `SponsorSet.name` (`?set=ID`, default MAIN); every sponsor fetch must append `SponsorSet.qs()`** (done in postgame.html's `makeSponsorLoop` + Credit Reel and in `overlay-scoreboard.js`). So a country gets its own browser sources: `postgame.html?set=MY`, `ingame.html?set=MY`. The dashboard's Control-tab previews open without `?set`, i.e. they preview MAIN. A new overlay with a sponsor loop must include `sponsor-set.js` and use `SponsorSet.qs()`.

## Event sponsors per country (Ingame) — `overlay-eventsponsors.js`

Besides the rotating loop, Ingame has event-specific sponsors that differ per country set: kill-event logos (Double Kill, Triple Kill, Turtle Slain — Turtle stays unsponsored under the 10th Anniversary theme) and the Gold Diff chip. Per set, in `data/sponsors_config.json` -> `sets.<SET>.events` = `{ doublekill, triplekill, turtleslain, golddiff }`, each `''` (no sponsor), `'builtin'` (golddiff only: the themed chip shipped in `assets/overlay/ingame/<theme>/golddiffsmart.png`) or `assets/sponsor/<SET>/events/<file>` (the server rejects anything else). MAIN is pre-filled with the old Smart/Visa art (moved to `assets/sponsor/MAIN/events/`); ID/MY/PH start empty = events run unsponsored. Edit them in the Sponsors tab ("Event sponsors" panel); `GET /api/event-sponsors?set=`; `html/js/overlay-eventsponsors.js` (`EventSponsors.get(slot)` / `.onChange`) loads it for the page's `?set=` and re-reads every 20 s. Art is plain transparent PNG/WebP fitted into the existing box (`object-fit: contain` on `#kill-event-sponsor-logo` and `.gdc-smart-img`; positions stay in the Edit tab). All show/hide state and automatic triggers stay global — every country feed fires together; only the sponsors differ. Short links `/ingame/<SET>` and `/postgame/<SET>` redirect to the right page with `?set=`; the Sponsors tab has copy-URL buttons.

## DiredudeAPI built in — self-hosted game API (both LIVE and DEBUG; see API Mode above) (`lib/dire.js`, `routes/dire.js`)

DiredudeAPI (`~/Desktop/DiredudeAPI`, a standalone Express service) now lives inside this server. It polls the MLBB esports `battledata` upstream (auth key from the auth worker, judge id / battle id) and serves the cached battle in the enriched `seat_N` format (its own `parseGameData`: ranks, kp, team stats, observed EXP thresholds, …). **Pressing DEBUG in Settings → API Mode switches the whole server to it automatically:** `lib/gameUrl.js` makes the game poller / `/api/gamedata-proxy` read `http://127.0.0.1:<port>/dire/api/gamedata` (the Battledata URL field is locked, `POST /api/game-url` returns 409), and `dire.onModeChange('debug')` starts its polling (also at server start if the mode is already DEBUG); leaving DEBUG stops it. While DEBUG is active the Settings page shows **[Debug]** (`GET /dire/api/debug` — newest battle of the last 24 h, nothing saved, for testing without a live game) and **[Refresh]** (`GET /dire/api/refresh` — the judge's current battle from `judgeIds.global`, saves its battleId, restarts polling) plus a live status line (`GET /dire/api/status`). Other routes: `/dire/api/gamedata`, `/dire/api/battledata` (raw upstream).
- **Config:** `data/dire_config.json` is **git-ignored** (it holds `localAuthKey`); `data/dire_config.example.json` is the template. **The auth key is hosted locally only — no cloud auth worker:** edit `localAuthKey` by hand in `data/dire_config.json` (no Settings field; env `DIRE_LOCAL_AUTH_KEY` / `AUTH_KEY` also work). The file is re-read when the key is missing or rejected, so a new key needs no restart. An expired key can't self-refresh. Keys: `localAuthKey`, `judgeIds.global`, `servers.battleList`, `battleId`, `dataId`, `pollInterval` (seconds), `mapName`, `matchCnt`.
- **Seat order / roles:** `data/dire_roster.json` (roleid -> role, copied from DiredudeAPI) first; players it doesn't know get a lane from `rawAdapter.resolveRoles` (Retribution = jungle, roam-equipment gold = roamer, most minion gold = gold lane, EXP/MID by pos) — `annotateRoles` in lib/dire.js. `blessing_gold` uses `gold_map_passive`, falling back to `gold_map[5]`.
- Not ported from DiredudeAPI: events store, draft timer, recap/compare, scoreboard-by-team, the two dashboards. The overlays' LIVE/WEB modes are unchanged (raw feed through `lib/rawAdapter.js`).
