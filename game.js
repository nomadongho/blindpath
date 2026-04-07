/* =====================================================================
   BLINDPATH — game.js
   A mysterious precision platformer. Learn by falling.
   ===================================================================== */

/* ── 1. CONFIGURATION / CONSTANTS ───────────────────────────────────── */
const CFG = {
  // Physics
  GRAVITY:          0.60,
  JUMP_FORCE:      -13.0,
  JUMP_CUT:         0.38,   // velocity multiplier on jump release (lower = shorter short-hop)
  MOVE_ACCEL:       2.2,
  MOVE_MAX:         4.5,
  FRICTION:         0.70,   // deceleration on ground (lower = stops faster / tighter)
  AIR_FRICTION:     0.88,
  FALL_GRAV_MULT:   0.55,   // extra gravity fraction applied while airborne and falling (vy > 0); makes descent faster than ascent

  // Timing (frames)
  COYOTE_FRAMES:  7,
  JUMP_BUFFER:    10,

  // Display
  TILE_W:         32,
  TILE_H:         16,
  PLAYER_W:       14,
  PLAYER_H:       22,

  // Camera
  CAM_LERP:       0.12,
  CAM_OFFSET_X:   0.38,  // player sits at 38% from left edge

  // Traps
  CRUMBLE_WARN:   30,   // frames of shaking before gone
  CRUMBLE_GONE:   180,  // frames before respawn
  FAKE_DELAY:     4,    // frames before fake tile disappears
  REVEAL_STILL:   60,   // frames standing still before reveal tile shows
  FALSE_SAFE_TTL: 200,  // frames before false-safe becomes dangerous
  FALSE_SAFE_WARN: 100, // frames before warming hint appears (halfway point)
  FALSE_SAFE_GRACE: 30, // frames between danger warning and actual kill
  TRIGGER_DIST:   40,   // pixels from trigger zone to activate triggered tile
  REVEAL_RADIUS:  120,  // px proximity for standing-still reveal trigger
  GHOST_RADIUS:    96,  // px proximity before trigger bridge ghost appears

  // Respawn
  RESPAWN_DELAY:  22,   // ~0.37s at 60fps

  // Audio
  MASTER_VOL:     0.18,
};

/* ── 2. STATE ────────────────────────────────────────────────────────── */
let state = {};          // game state, reset on restart
let currentLevel = null; // active level data
let deaths = 0;          // persists across level restarts

/* ── 3. DOM REFERENCES ───────────────────────────────────────────────── */
const titleScreen  = document.getElementById('title-screen');
const gameWrapper  = document.getElementById('game-wrapper');
const gameViewport = document.getElementById('game-viewport');
const gameWorld    = document.getElementById('game-world');
const flashOverlay = document.getElementById('flash-overlay');
const levelTitleEl = document.getElementById('level-title-overlay');
const deathCountEl = document.getElementById('death-count');
const endScreen    = document.getElementById('end-screen');
const endDeathsEl  = document.getElementById('end-deaths');
const touchLeft    = document.getElementById('touch-left');
const touchRight   = document.getElementById('touch-right');
const touchJump    = document.getElementById('touch-jump');

/* ── 4. INPUT ────────────────────────────────────────────────────────── */
const keys = {
  left: false, right: false, jump: false,
  jumpDown: false,   // true only the first frame jump is pressed
  jumpUp:   false,   // true only the first frame jump is released
};
let _jumpWasDown = false;

document.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.code === 'ArrowLeft'  || e.code === 'KeyA') keys.left  = true;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = true;
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
    keys.jump = true;
  }
});

document.addEventListener('keyup', e => {
  if (e.code === 'ArrowLeft'  || e.code === 'KeyA') keys.left  = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
    keys.jump = false;
  }
});

// Touch controls
function bindTouch(el, flag) {
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('pressed');
    keys[flag] = true;
  });
  const release = e => {
    e.preventDefault();
    el.classList.remove('pressed');
    keys[flag] = false;
  };
  el.addEventListener('pointerup',     release);
  el.addEventListener('pointercancel', release);
}

bindTouch(touchLeft,  'left');
bindTouch(touchRight, 'right');
bindTouch(touchJump,  'jump');

/* ── 5. AUDIO ────────────────────────────────────────────────────────── */
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playTone(freq, type, duration, gain, when) {
  try {
    const ctx = getAudioCtx();
    const t   = when || ctx.currentTime;
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.connect(vol);
    vol.connect(ctx.destination);
    osc.type      = type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    vol.gain.setValueAtTime(gain * CFG.MASTER_VOL, t);
    vol.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.start(t);
    osc.stop(t + duration);
  } catch (_) { /* audio blocked — silently ignore */ }
}

function sfxJump()   { playTone(340, 'square',   0.12, 0.7); playTone(480, 'square', 0.07, 0.4); }
function sfxLand()   { playTone(120, 'square',   0.08, 0.6); }
function sfxDeath()  {
  playTone(220, 'sawtooth', 0.10, 0.9);
  playTone(160, 'sawtooth', 0.18, 0.8, (audioCtx || { currentTime: 0 }).currentTime + 0.07);
  playTone(100, 'sawtooth', 0.25, 0.7, (audioCtx || { currentTime: 0 }).currentTime + 0.14);
}
function sfxReveal() { playTone(600, 'sine', 0.09, 0.3); }
function sfxGoal()   {
  playTone(440, 'sine', 0.15, 0.6);
  playTone(550, 'sine', 0.15, 0.5, (audioCtx || { currentTime: 0 }).currentTime + 0.12);
  playTone(660, 'sine', 0.22, 0.7, (audioCtx || { currentTime: 0 }).currentTime + 0.24);
}

/* ── 6. LEVEL DATA ───────────────────────────────────────────────────── */
/*
  Tile types:
    S  = solid
    F  = fake floor (falls through after contact)
    I  = invisible bridge (solid but invisible)
    C  = crumble (delayed crumble)
    R  = reveal (appears after standing still)
    Z  = false safe zone (becomes dangerous)
    T  = triggered tile (needs nearby activation)
    G  = goal / exit
    _  = empty / void (background)
    X  = spike (hazard)

  Each tile row describes a horizontal strip.
  levelW and levelH define world pixel dimensions.

  spawnX, spawnY  — player start position in pixels
  tiles[]         — array of { type, col, row } or { type, x, y, w, h }
  triggers[]      — { x, y, r, targetId } activation zones for T-tiles
*/

const LEVEL_1 = {
  name: 'Stage I  ·  The Blind Path',
  spawnX: 60,
  spawnY: 340,

  /* World size in pixels */
  worldW: 3200,
  worldH: 480,

  /*
   * Tiles are described as objects with pixel coordinates.
   * w defaults to CFG.TILE_W (32), h defaults to CFG.TILE_H (16).
   */
  tiles: buildLevel1Tiles(),
};

function buildLevel1Tiles() {
  const T  = CFG.TILE_W;  // 32  – tile width
  const H  = CFG.TILE_H;  // 16  – tile height
  const tiles = [];

  // ── Helper shortcuts ──────────────────────────────────────────────
  function solid(x, y, w, h) {
    tiles.push({ type: 'solid', x, y, w: w || T, h: h || H, id: tiles.length });
  }
  function fake(x, y, w, h) {
    tiles.push({ type: 'fake', x, y, w: w || T, h: h || H, id: tiles.length });
  }
  function invisible(x, y, w, h) {
    tiles.push({ type: 'invisible', x, y, w: w || T, h: h || H, id: tiles.length });
  }
  function crumble(x, y, w, h) {
    tiles.push({ type: 'crumble', x, y, w: w || T, h: h || H, id: tiles.length,
                 state: 'idle', timer: 0 });
  }
  function reveal(x, y, w, h) {
    tiles.push({ type: 'reveal', x, y, w: w || T, h: h || H, id: tiles.length,
                 visible: false, timer: 0 });
  }
  function falseSafe(x, y, w, h) {
    tiles.push({ type: 'false-safe', x, y, w: w || T, h: h || H, id: tiles.length,
                 timer: 0, dangerous: false, dangerTimer: 0, _warming: false });
  }
  function triggered(x, y, w, h, trigId) {
    tiles.push({ type: 'trigger', x, y, w: w || T, h: h || H, id: tiles.length,
                 trigId, active: false });
  }
  function goal(x, y, w, h) {
    tiles.push({ type: 'goal', x, y, w: w || T, h: h || H, id: tiles.length });
  }

  // ── ZONE 1 – Safe introduction (x: 40–400) ────────────────────────
  // Ground floor
  solid( 40, 380, 340, H);   // start platform
  // A few steps going up, all normal and solid — teaches basic movement
  solid(400, 360, T, H);
  solid(440, 340, T, H);
  solid(480, 320, T, H);
  // Continue stepping down
  solid(540, 340, T, H);
  solid(580, 360, T, H);
  solid(620, 380, 100, H);

  // ── ZONE 2 – First betrayal: fake floor (x: 720–900) ──────────────
  // A visual "safe" looking wide floor — it's fake!
  fake(720, 380, 160, H);    // looks solid, falls through into spikes
  // The real path: a single invisible bridge one step above the fake floor.
  // Player must jump from the previous solid platform to discover it.
  // Once standing on "nothing" at y=364, the aha moment clicks.
  // Width = fake floor width (160) + 64 px of overhang to reach the Zone-3 solid.
  invisible(720, 364, 160 + 64, H); // spans the full fake section at one tile-height above
  solid(900, 380, T, H);     // visible safe beacon on the far side

  // ── ZONE 3 – Rising platforms + crumble mix (x: 940–1200) ─────────
  // First solid placed at y=364 to match invisible bridge height so the
  // transition from Zone 2 is geometrically seamless (no X-axis blocking).
  // x=944 aligns exactly with the invisible bridge end (720 + 224) so the
  // player steps off the bridge directly onto this platform.
  solid(944, 364, T, H);
  crumble(980, 340, T, H);   // crumble mid-air step
  solid(1020, 320, T, H);
  crumble(1060, 320, T, H);  // back-to-back crumble
  crumble(1100, 320, T, H);
  solid(1140, 320, T, H);
  solid(1180, 340, T, H);
  solid(1220, 360, T, H);
  solid(1260, 380, 60, H);

  // ── ZONE 4 – Movement-reveal section (x: 1340–1580) ───────────────
  // Gap — player must stand still on the edge to reveal the hidden path
  solid(1340, 380, T, H);    // edge platform — stand here to reveal
  // Reveal tiles appear when player stands still
  reveal(1380, 380, T, H);
  reveal(1412, 380, T, H);
  reveal(1444, 380, T, H);
  reveal(1476, 380, T, H);
  reveal(1508, 380, T, H);
  solid(1540, 380, T, H);    // visible safe landing

  // ── ZONE 5 – False safe zone + spike pit (x: 1580–1820) ───────────
  solid(1580, 380, T, H);
  falseSafe(1620, 380, 96, H);  // looks safe, becomes lethal
  solid(1730, 380, T, H);
  // Spike pit beneath false-safe zone (dead if you fall)
  // (spikes defined separately below)

  // ── ZONE 6 – Reverse expectation (x: 1830–2200) ───────────────────
  // Visible platforms are FAKE — invisible ones are REAL.
  // After zone 2 taught that invisible=real, this reinforces it.
  // Invisible staircase starts only 16 px below floor level (y=396) so
  // the catch is shallow and discoverable without a death-by-gap.
  fake(1830, 380, T, H);     // looks solid — trap!
  fake(1870, 360, T, H);
  fake(1910, 340, T, H);
  // The real invisible staircase (starts just below floor, then ascends)
  invisible(1830, 396, T, H);
  invisible(1875, 380, T, H);
  invisible(1920, 364, T, H);
  invisible(1965, 348, T, H);
  solid(2010, 336, T, H);     // solid landing visible — safe reward

  solid(2050, 336, T, H);
  solid(2090, 356, T, H);
  solid(2130, 376, T, H);
  solid(2170, 396, 80, H);

  // ── ZONE 7 – Triggered path (x: 2260–2520) ────────────────────────
  // Approaching the gap activates the hidden bridge.
  // As the player nears, a ghost silhouette of the bridge fades in,
  // hinting that proximity matters — solidifies on contact with the zone.
  solid(2260, 396, T, H);    // approach platform
  // Trigger zone: entering near x=2268 activates the bridge
  triggered(2300, 396, T, H,  'T1');
  triggered(2332, 396, T, H,  'T1');
  triggered(2364, 396, T, H,  'T1');
  triggered(2396, 396, T, H,  'T1');
  solid(2428, 396, T, H);    // safe landing
  solid(2470, 396, 80, H);

  // ── ZONE 8 – Final gauntlet: crumble + fake mix (x: 2570–2900) ────
  // All tiles at the same height (y=380) — the challenge is now purely
  // about remembering WHICH type each tile is, not WHERE to go.
  // Order tests all three learned rules: crumble → fake → crumble → solid
  // → crumble → crumble → invisible → solid descent.
  crumble(2570, 380, T, H);
  fake(2610, 380, T, H);
  crumble(2650, 380, T, H);
  solid(2690, 380, T, H);    // reward — solid rest
  crumble(2730, 380, T, H);
  crumble(2770, 380, T, H);
  invisible(2810, 380, T, H); // one last invisible step
  solid(2850, 380, T, H);
  solid(2890, 380, T, H);
  solid(2930, 380, 100, H);

  // ── GOAL (x: 3050) ────────────────────────────────────────────────
  solid(3040, 380, 100, H);
  goal(3060, 352, T, 28);   // exit portal

  return tiles;
}

/* Spikes and hazard definitions for level 1 */
const LEVEL_1_SPIKES = buildLevel1Spikes();

function buildLevel1Spikes() {
  const spikes = [];
  function spike(x, y, count) {
    for (let i = 0; i < count; i++) {
      spikes.push({ x: x + i * 16, y, w: 16, h: 10 });
    }
  }

  // Pit under fake floor (zone 2)
  spike(720, 400, 10);

  // False safe zone pit (zone 5)
  spike(1620, 400, 6);

  // Pit under zone 6 fake path (raised to match shallower invisible catch)
  spike(1830, 416, 10);

  // Pit under triggered path approach
  spike(2300, 416, 8);

  // Final gauntlet pit (moved 4 px down so spike tips clear platform bottoms)
  spike(2570, 400, 14);

  return spikes;
}

/* Trigger zones for level 1 */
const LEVEL_1_TRIGGERS = [
  /* id, rect to detect player inside, activates tiles with matching trigId */
  { id: 'T1', x: 2268, y: 340, w: 48, h: 80 },
];

/* ── 7. VIEWPORT & CAMERA ────────────────────────────────────────────── */
let vpW = 0, vpH = 0;   // viewport pixel dimensions
let camX = 0, camY = 0; // camera top-left world position

function resizeViewport() {
  const totalH = window.innerHeight;
  const touchH = (window.matchMedia('(pointer: coarse)').matches ||
                  window.innerWidth <= 600) ? 108 : 0;
  vpH = Math.min(totalH - touchH, 480);
  vpW = Math.min(window.innerWidth, 640);

  gameViewport.style.width  = vpW + 'px';
  gameViewport.style.height = vpH + 'px';
}

window.addEventListener('resize', resizeViewport);

function updateCamera() {
  const target = {
    x: state.player.x - vpW * CFG.CAM_OFFSET_X,
    y: state.player.y - vpH * 0.6,
  };
  camX += (target.x - camX) * CFG.CAM_LERP;
  camY += (target.y - camY) * CFG.CAM_LERP;

  // Clamp to world bounds
  camX = Math.max(0, Math.min(camX, currentLevel.worldW - vpW));
  camY = Math.max(0, Math.min(camY, currentLevel.worldH - vpH));
}

/* ── 8. RENDERING ────────────────────────────────────────────────────── */
let domTiles = {};    // id -> DOM element
let domSpikes = [];
let playerEl = null;
let bgStars  = [];

function buildDOM() {
  // Clear world
  gameWorld.innerHTML = '';
  domTiles  = {};
  domSpikes = [];

  gameWorld.style.width  = currentLevel.worldW + 'px';
  gameWorld.style.height = currentLevel.worldH + 'px';

  // Background stars
  for (let i = 0; i < 80; i++) {
    const s = document.createElement('div');
    s.className = 'bg-star';
    s.style.left = Math.random() * currentLevel.worldW + 'px';
    s.style.top  = Math.random() * currentLevel.worldH * 0.85 + 'px';
    s.style.opacity = (0.3 + Math.random() * 0.5).toFixed(2);
    gameWorld.appendChild(s);
    bgStars.push(s);
  }

  // Tiles
  currentLevel.tiles.forEach(tile => {
    const el = document.createElement('div');
    el.className = 'tile tile-' + tile.type;
    el.style.left   = tile.x + 'px';
    el.style.top    = tile.y + 'px';
    el.style.width  = tile.w + 'px';
    el.style.height = tile.h + 'px';
    if (tile.type === 'goal') el.textContent = '▲';
    gameWorld.appendChild(el);
    domTiles[tile.id] = el;
  });

  // Spikes
  LEVEL_1_SPIKES.forEach((sp, i) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'spike';
    wrapper.style.left   = sp.x + 'px';
    wrapper.style.top    = sp.y + 'px';
    wrapper.style.width  = sp.w + 'px';
    wrapper.style.height = sp.h + 'px';
    const inner = document.createElement('div');
    inner.className = 'spike-inner';
    inner.style.borderLeft  = (sp.w / 2) + 'px solid transparent';
    inner.style.borderRight = (sp.w / 2) + 'px solid transparent';
    inner.style.borderBottom = sp.h + 'px solid #8a1a1a';
    wrapper.appendChild(inner);
    gameWorld.appendChild(wrapper);
    domSpikes.push(wrapper);
  });

  // Player
  playerEl = document.createElement('div');
  playerEl.id = 'player';
  gameWorld.appendChild(playerEl);
}

function renderFrame() {
  // Apply camera transform
  gameWorld.style.transform =
    `translate(${-Math.round(camX)}px, ${-Math.round(camY)}px)`;

  const p = state.player;
  playerEl.style.left = Math.round(p.x) + 'px';
  playerEl.style.top  = Math.round(p.y) + 'px';

  // Flip player sprite when moving left
  playerEl.style.transform = p.facing === -1 ? 'scaleX(-1)' : '';

  // Sync crumble, reveal, false-safe, trigger tile DOM classes
  currentLevel.tiles.forEach(tile => {
    const el = domTiles[tile.id];
    if (!el) return;
    if (tile.type === 'crumble') {
      el.classList.toggle('shaking', tile.state === 'shaking');
      el.classList.toggle('gone',    tile.state === 'gone');
    } else if (tile.type === 'reveal') {
      el.classList.toggle('visible', tile.visible);
    } else if (tile.type === 'false-safe') {
      el.classList.toggle('danger',  tile.dangerous);
      el.classList.toggle('warming', !!tile._warming && !tile.dangerous);
    } else if (tile.type === 'trigger') {
      el.classList.toggle('active', tile.active);
      el.classList.toggle('ghost',  !tile.active && !!tile._near);
    }
  });
}

/* ── 9. PHYSICS HELPERS ──────────────────────────────────────────────── */
function rectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx &&
         ay < by + bh && ay + ah > by;
}

function rectOverlapAmt(ax, ay, aw, ah, bx, by, bw, bh) {
  const ox = Math.min(ax + aw, bx + bw) - Math.max(ax, bx);
  const oy = Math.min(ay + ah, by + bh) - Math.max(ay, by);
  return { ox, oy };
}

/* ── 10. PLAYER & PHYSICS ────────────────────────────────────────────── */
function initPlayer() {
  return {
    x:       currentLevel.spawnX,
    y:       currentLevel.spawnY,
    vx:      0,
    vy:      0,
    onGround: false,
    facing:   1,
    coyote:   0,      // coyote time counter
    jumpBuf:  0,      // jump buffer counter
    dead:     false,
    respawnTimer: 0,
    stillTimer:   0,  // how many frames player hasn't moved horizontally
    justLanded:   false,
  };
}

function updatePlayer(dt) {
  const p = state.player;

  // --- Jump edge detection ---
  const jumpNow  = keys.jump;
  const jumpDown = jumpNow && !_jumpWasDown;
  const jumpUp   = !jumpNow && _jumpWasDown;
  _jumpWasDown   = jumpNow;

  if (p.dead) {
    p.respawnTimer--;
    if (p.respawnTimer <= 0) respawn();
    return;
  }

  // --- Horizontal movement ---
  let moveX = 0;
  if (keys.left)  moveX = -1;
  if (keys.right)  moveX =  1;

  if (moveX !== 0) {
    p.facing = moveX;
    p.vx += moveX * CFG.MOVE_ACCEL;
    p.vx  = Math.max(-CFG.MOVE_MAX, Math.min(CFG.MOVE_MAX, p.vx));
    p.stillTimer = 0;
  } else {
    // Friction
    p.vx *= p.onGround ? CFG.FRICTION : CFG.AIR_FRICTION;
    if (Math.abs(p.vx) < 0.1) p.vx = 0;
    p.stillTimer++;
  }

  // --- Jump buffer ---
  if (jumpDown) p.jumpBuf = CFG.JUMP_BUFFER;
  else if (p.jumpBuf > 0) p.jumpBuf--;

  // --- Coyote time ---
  if (p.onGround) p.coyote = CFG.COYOTE_FRAMES;
  else if (p.coyote > 0) p.coyote--;

  // --- Execute jump ---
  if (p.jumpBuf > 0 && p.coyote > 0) {
    p.vy      = CFG.JUMP_FORCE;
    p.coyote  = 0;
    p.jumpBuf = 0;
    sfxJump();
  }

  // --- Jump cut (variable height) ---
  if (jumpUp && p.vy < 0) {
    p.vy *= CFG.JUMP_CUT;
  }

  // --- Gravity (extra pull while airborne and falling so descent is faster than ascent) ---
  p.vy += CFG.GRAVITY;
  if (!p.onGround && p.vy > 0) p.vy += CFG.GRAVITY * CFG.FALL_GRAV_MULT; // skip when grounded to avoid fighting with floor collision
  if (p.vy > 20) p.vy = 20; // terminal velocity

  // --- Move X then resolve collisions ---
  const prevOnGround = p.onGround;
  p.onGround = false;

  p.x += p.vx;
  resolveCollisionsX(p);

  p.y += p.vy;
  resolveCollisionsY(p);

  // --- Landing SFX ---
  if (p.onGround && !prevOnGround) {
    sfxLand();
    p.justLanded = true;
  } else {
    p.justLanded = false;
  }

  // --- Fall into pit (below world) ---
  if (p.y > currentLevel.worldH + 60) {
    killPlayer();
    return;
  }

  // --- Update trap states ---
  updateTraps(p);
}

/* ── 11. COLLISION RESOLUTION ────────────────────────────────────────── */
function getTileRect(tile) {
  return { x: tile.x, y: tile.y, w: tile.w, h: tile.h };
}

function isTileSolid(tile) {
  switch (tile.type) {
    case 'solid':      return true;
    case 'invisible':  return true;
    case 'fake':       return tile._touched ? false : true;
    case 'crumble':    return tile.state !== 'gone';
    case 'reveal':     return tile.visible;
    case 'false-safe': return true;
    case 'trigger':    return tile.active;
    default:           return false;
  }
}

function resolveCollisionsX(p) {
  const pw = CFG.PLAYER_W, ph = CFG.PLAYER_H;
  currentLevel.tiles.forEach(tile => {
    if (!isTileSolid(tile)) return;
    const { x, y, w, h } = getTileRect(tile);
    if (!rectOverlap(p.x, p.y, pw, ph, x, y, w, h)) return;
    const { ox } = rectOverlapAmt(p.x, p.y, pw, ph, x, y, w, h);
    if (p.vx > 0) p.x -= ox;
    else if (p.vx < 0) p.x += ox;
    p.vx = 0;
  });
}

function resolveCollisionsY(p) {
  const pw = CFG.PLAYER_W, ph = CFG.PLAYER_H;
  p.onGround = false;

  currentLevel.tiles.forEach(tile => {
    if (!isTileSolid(tile)) return;

    const { x, y, w, h } = getTileRect(tile);
    if (!rectOverlap(p.x, p.y, pw, ph, x, y, w, h)) return;

    const { oy } = rectOverlapAmt(p.x, p.y, pw, ph, x, y, w, h);

    if (p.vy > 0) {
      // Falling — only land on top of tile
      const prevBottom = p.y + ph - p.vy;
      if (prevBottom <= y + 2) {
        p.y -= oy;
        p.vy = 0;
        p.onGround = true;
        // Touch-activate tile events
        onLandOn(tile, p);
      }
    } else if (p.vy < 0) {
      // Rising — only hit underside
      p.y += oy;
      p.vy = 0;
    }
  });
}

/* ── 12. TRAP LOGIC ──────────────────────────────────────────────────── */
function onLandOn(tile, p) {
  /* Called the moment the player lands on a tile */
  if (tile.type === 'fake') {
    // Start dissolving
    tile._touched = true;
    tile._dissolveTimer = CFG.FAKE_DELAY;
    const el = domTiles[tile.id];
    if (el) el.classList.add('dissolving');
  }

  if (tile.type === 'crumble' && tile.state === 'idle') {
    tile.state = 'shaking';
    tile.timer = CFG.CRUMBLE_WARN;
  }

  if (tile.type === 'goal') {
    reachGoal();
  }
}

function updateTraps(p) {
  const pw = CFG.PLAYER_W, ph = CFG.PLAYER_H;

  currentLevel.tiles.forEach(tile => {
    // ── Crumble ──────────────────────────────────────────────────────
    if (tile.type === 'crumble') {
      if (tile.state === 'shaking') {
        tile.timer--;
        if (tile.timer <= 0) {
          tile.state = 'gone';
          tile.timer = CFG.CRUMBLE_GONE;
        }
      } else if (tile.state === 'gone') {
        tile.timer--;
        if (tile.timer <= 0) {
          tile.state = 'idle';
        }
      }
    }

    // ── Reveal ───────────────────────────────────────────────────────
    if (tile.type === 'reveal') {
      // Reveal if player is standing still AND within the reveal zone.
      // Use a wide radius (120 px) so standing on the edge platform at
      // the gap's left side reliably triggers the hidden path.
      const withinX = p.x + pw > tile.x - CFG.REVEAL_RADIUS && p.x < tile.x + tile.w + CFG.REVEAL_RADIUS;
      if (p.onGround && withinX && p.stillTimer >= CFG.REVEAL_STILL) {
        if (!tile.visible) {
          tile.visible = true;
          sfxReveal();
        }
      }
      // Hide again when player moves away (after a delay)
      if (!withinX && tile.visible) {
        // Don't hide — let it stay once revealed (fairness)
      }
    }

    // ── False-safe ───────────────────────────────────────────────────
    if (tile.type === 'false-safe') {
      const onThis = p.onGround && rectOverlap(
        p.x, p.y, pw, ph,
        tile.x, tile.y, tile.w, tile.h
      );
      if (onThis) {
        tile.timer++;
        // Warming hint at the halfway point — subtle colour shift signals danger
        if (tile.timer >= CFG.FALSE_SAFE_WARN && !tile._warming && !tile.dangerous) {
          tile._warming = true;
        }
        // Become dangerous at TTL — CSS red glow fires, grace period begins
        if (tile.timer >= CFG.FALSE_SAFE_TTL && !tile.dangerous) {
          tile.dangerous = true;
          tile.dangerTimer = 0;
          tile._warming = false;
        }
        // Kill only after the grace window so the visual warning has time to read
        if (tile.dangerous) {
          tile.dangerTimer++;
          if (tile.dangerTimer >= CFG.FALSE_SAFE_GRACE) {
            killPlayer();
          }
        }
      } else {
        // Reset timer when off the tile
        if (!tile.dangerous) {
          tile.timer = Math.max(0, tile.timer - 2);
          if (tile.timer < CFG.FALSE_SAFE_WARN) tile._warming = false;
        }
      }
    }

    // ── Triggered tile ────────────────────────────────────────────────
    if (tile.type === 'trigger' && !tile.active) {
      // Find matching trigger zone
      LEVEL_1_TRIGGERS.forEach(zone => {
        if (zone.id !== tile.trigId) return;
        const inZone = rectOverlap(p.x, p.y, pw, ph, zone.x, zone.y, zone.w, zone.h);
        // Activate on any contact with the trigger zone (no jump required).
        // A ghost outline fades in as the player approaches, so they can
        // see the bridge silhouette before they understand how to summon it.
        if (inZone) {
          tile.active = true;
        }
        // Ghost visibility: show faint outline when player is within 96 px
        const nearZone = p.x + pw > zone.x - CFG.GHOST_RADIUS && p.x < zone.x + zone.w + CFG.GHOST_RADIUS;
        tile._near = nearZone;
      });
    }

    // ── Goal overlap ──────────────────────────────────────────────────
    if (tile.type === 'goal') {
      if (rectOverlap(p.x, p.y, pw, ph, tile.x, tile.y, tile.w, tile.h)) {
        reachGoal();
      }
    }
  });

  // ── Spike collisions ─────────────────────────────────────────────────
  LEVEL_1_SPIKES.forEach(sp => {
    if (rectOverlap(p.x, p.y + ph - 6, pw - 2, 6,
                    sp.x, sp.y, sp.w, sp.h)) {
      killPlayer();
    }
  });
}

/* ── 13. DEATH & RESPAWN ─────────────────────────────────────────────── */
function killPlayer() {
  if (state.player.dead) return;
  state.player.dead = true;
  state.player.respawnTimer = CFG.RESPAWN_DELAY;
  state.player.vx = 0;
  state.player.vy = 0;

  deaths++;
  deathCountEl.textContent = deaths;

  sfxDeath();

  // Flash & shake
  flashOverlay.classList.remove('flash');
  void flashOverlay.offsetWidth; // reflow to restart animation
  flashOverlay.classList.add('flash');

  gameViewport.classList.remove('shake');
  void gameViewport.offsetWidth;
  gameViewport.classList.add('shake');
  setTimeout(() => gameViewport.classList.remove('shake'), 300);

  // Reset traps for fairness
  resetTraps();
}

function respawn() {
  const p = state.player;
  p.dead  = false;
  p.x     = currentLevel.spawnX;
  p.y     = currentLevel.spawnY;
  p.vx    = 0;
  p.vy    = 0;
  p.onGround  = false;
  p.coyote    = 0;
  p.jumpBuf   = 0;
  p.stillTimer = 0;
}

function resetTraps() {
  currentLevel.tiles.forEach(tile => {
    if (tile.type === 'crumble') {
      tile.state = 'idle';
      tile.timer = 0;
    }
    if (tile.type === 'fake') {
      tile._touched = false;
      tile._dissolveTimer = 0;
      const el = domTiles[tile.id];
      if (el) el.classList.remove('dissolving');
    }
    if (tile.type === 'false-safe') {
      tile.timer = 0;
      tile.dangerous = false;
      tile.dangerTimer = 0;
      tile._warming = false;
    }
    if (tile.type === 'trigger') {
      tile.active = false;
      tile._near  = false;
    }
    // Reveal tiles stay visible once discovered (by design — fairness)
  });
}

/* ── 14. GOAL / LEVEL COMPLETE ───────────────────────────────────────── */
let goalReached = false;

function reachGoal() {
  if (goalReached) return;
  goalReached = true;
  sfxGoal();

  setTimeout(() => {
    endDeathsEl.textContent = `Deaths: ${deaths}`;
    endScreen.classList.remove('hidden');
    cancelAnimationFrame(state.rafId);
  }, 600);
}

/* ── 15. GAME LOOP ───────────────────────────────────────────────────── */
function gameLoop() {
  state.rafId = requestAnimationFrame(gameLoop);
  updatePlayer(1);
  updateCamera();
  renderFrame();
}

/* ── 16. LEVEL INIT & START ──────────────────────────────────────────── */
function startGame() {
  deaths = 0;
  goalReached = false;
  deathCountEl.textContent = 0;
  _jumpWasDown = false;

  currentLevel = LEVEL_1;
  // Deep-clone tile state fields so restarts are clean
  currentLevel.tiles = buildLevel1Tiles();

  resizeViewport();
  buildDOM();

  state.player = initPlayer();
  camX = currentLevel.spawnX - vpW * CFG.CAM_OFFSET_X;
  camY = currentLevel.spawnY - vpH * 0.6;
  camX = Math.max(0, Math.min(camX, currentLevel.worldW - vpW));
  camY = Math.max(0, Math.min(camY, currentLevel.worldH - vpH));

  // Show level title briefly
  levelTitleEl.textContent = currentLevel.name;
  levelTitleEl.classList.add('visible');
  setTimeout(() => levelTitleEl.classList.remove('visible'), 2200);

  gameLoop();
}

/* ── 17. UI EVENTS ───────────────────────────────────────────────────── */
document.getElementById('start-btn').addEventListener('click', () => {
  // Unlock audio context on first interaction
  try { getAudioCtx(); } catch (_) {}
  titleScreen.classList.add('hidden');
  gameWrapper.classList.remove('hidden');
  startGame();
});

document.getElementById('restart-btn').addEventListener('click', () => {
  endScreen.classList.add('hidden');
  startGame();
});
