/* =====================================================================
   BLINDPATH — game.js  (30-level edition)
   A mysterious precision platformer. Learn by falling.
   ===================================================================== */

/* ── 1. CONFIGURATION / CONSTANTS ───────────────────────────────────── */
const CFG = {
  GRAVITY:           0.60,
  JUMP_FORCE:       -13.0,
  JUMP_CUT:          0.38,
  MOVE_ACCEL:        2.2,
  MOVE_MAX:          4.5,
  FRICTION:          0.70,
  AIR_FRICTION:      0.88,
  FALL_GRAV_MULT:    0.55,
  COYOTE_FRAMES:   7,
  JUMP_BUFFER:     10,
  TILE_W:          32,
  TILE_H:          16,
  PLAYER_W:        14,
  PLAYER_H:        22,
  CAM_LERP:        0.12,
  CAM_OFFSET_X:    0.38,
  CAM_OFFSET_Y:    0.60,
  CRUMBLE_WARN:    30,
  CRUMBLE_GONE:    180,
  FAKE_DELAY:      4,
  REVEAL_STILL:    60,
  FALSE_SAFE_TTL:  240,  // frames standing on false-safe tile before it turns lethal
  FALSE_SAFE_WARN: 120,  // frames before warming hint appears (halfway point)
  FALSE_SAFE_GRACE: 30,
  GHOST_RADIUS:    96,
  PATIENCE_FRAMES: 90,   // frames player must stand still before a patience trigger activates
  RESPAWN_DELAY:   22,
  MASTER_VOL:      0.18,
};

/* ── 2. STATE ────────────────────────────────────────────────────────── */
let state = {};
let currentLevel = null;
let currentLevelIndex = 0;
let deaths = 0;
let gamePhase = 1;   // 1 = Reality, 2 = Dream Phase 1, 3 = Dream Phase 2

/* ── 2b. PROGRESS PERSISTENCE ───────────────────────────────────────── */
const SAVE_KEY = 'blindpath_progress';

function saveProgress() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      phase: gamePhase,
      levelIndex: currentLevelIndex,
      deaths: deaths,
    }));
  } catch (_) {}
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function clearProgress() {
  try { localStorage.removeItem(SAVE_KEY); } catch (_) {}
}

/* ── 2a. PHASE NAMES ─────────────────────────────────────────────────── */
const DREAM_NAMES_2 = [
  'falling again',    'the same ground',   'familiar stranger',
  'wrong direction',  'remember this',     'behind the wall',
  'lost footing',     'drifting',          'the floor shifts',
  'backwards',        'not this way',      'dissolving',
  'half remembered',  'trust nothing',     'fading path',
  'echoes',           'the light moved',   'weightless',
  'something changed','not here',          'unsteady',
  'drift',            'silence',           'between steps',
  'the path hides',   'wavering',          'hollow ground',
  'memory breaks',    'nowhere left',      'the end was here',
];
const DREAM_NAMES_3 = [
  'the cost',         'give something',    'what remains',
  'choose',           'step here',         'burn through',
  'no safe path',     'accept this',       'it asks',
  'fall forward',     'the exchange',      'taken',
  'the wrong memory', 'pay it',            'hazard',
  'broken ground',    'lost again',        'the test',
  'what you carried', 'let go',            'splinter',
  'the last try',     'accept the trap',   'borrowed time',
  'cannot avoid',     'the toll',          'everything costs',
  'even this',        'sacrifice',         'through',
];

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
const continueBtn  = document.getElementById('continue-btn');

/* ── 4. INPUT ────────────────────────────────────────────────────────── */
const keys = { left: false, right: false, jump: false };
let _jumpWasDown = false;

document.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.code === 'ArrowLeft'  || e.code === 'KeyA') keys.left  = true;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = true;
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') keys.jump = true;
});
document.addEventListener('keyup', e => {
  if (e.code === 'ArrowLeft'  || e.code === 'KeyA') keys.left  = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') keys.jump = false;
});

function bindTouch(el, flag) {
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); el.setPointerCapture(e.pointerId);
    el.classList.add('pressed'); keys[flag] = true;
  });
  const release = e => { e.preventDefault(); el.classList.remove('pressed'); keys[flag] = false; };
  el.addEventListener('pointerup',     release);
  el.addEventListener('pointercancel', release);
}
bindTouch(touchLeft,  'left');
bindTouch(touchRight, 'right');
bindTouch(touchJump,  'jump');

/* ── 5. AUDIO ────────────────────────────────────────────────────────── */
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playTone(freq, type, duration, gain, when) {
  try {
    const ctx = getAudioCtx();
    const t   = when || ctx.currentTime;
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.connect(vol); vol.connect(ctx.destination);
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    vol.gain.setValueAtTime(gain * CFG.MASTER_VOL, t);
    vol.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.start(t); osc.stop(t + duration);
  } catch (_) {}
}
function sfxJump()  { playTone(340,'square',0.12,0.7); playTone(480,'square',0.07,0.4); }
function sfxLand()  { playTone(120,'square',0.08,0.6); }
function sfxDeath() {
  if (gamePhase === 2) {
    const t = (audioCtx||{currentTime:0}).currentTime;
    playTone(330,'sine',0.30,0.5);
    playTone(220,'sine',0.45,0.4, t+0.10);
    playTone(165,'sine',0.60,0.3, t+0.22);
    return;
  }
  if (gamePhase === 3) {
    const t = (audioCtx||{currentTime:0}).currentTime;
    playTone(180,'sawtooth',0.12,0.9);
    playTone(120,'sawtooth',0.20,0.8, t+0.07);
    playTone(80, 'sawtooth',0.30,0.7, t+0.16);
    return;
  }
  const t = (audioCtx||{currentTime:0}).currentTime;
  playTone(220,'sawtooth',0.10,0.9);
  playTone(160,'sawtooth',0.18,0.8, t+0.07);
  playTone(100,'sawtooth',0.25,0.7, t+0.14);
}
function sfxReveal(){ playTone(600,'sine',0.09,0.3); }
function sfxGoal()  {
  if (gamePhase === 2) {
    const t = (audioCtx||{currentTime:0}).currentTime;
    playTone(330,'sine',0.50,0.4);
    playTone(440,'sine',0.60,0.3, t+0.15);
    playTone(330,'sine',0.80,0.2, t+0.35);
    return;
  }
  if (gamePhase === 3) {
    const t = (audioCtx||{currentTime:0}).currentTime;
    playTone(220,'triangle',0.50,0.4);
    playTone(280,'triangle',0.65,0.3, t+0.18);
    return;
  }
  const t = (audioCtx||{currentTime:0}).currentTime;
  playTone(440,'sine',0.15,0.6);
  playTone(550,'sine',0.15,0.5, t+0.12);
  playTone(660,'sine',0.22,0.7, t+0.24);
}

/* ── 6. LEVEL BUILDER HELPERS ────────────────────────────────────────── */
/*
  Tile types:
    solid      – permanent safe ground
    fake       – dissolves on landing (same visual as solid)
    invisible  – solid but invisible
    crumble    – shakes then falls; light:true = lighter colour;
                 warnFrames overrides CFG.CRUMBLE_WARN;
                 instantCrumble:true vanishes on first contact;
                 reveal:true = hidden until player stands still
    reveal     – appears after player stands still (purely visual type)
    false-safe – becomes lethal after timer; fastTTL/fastWarn override defaults
    trigger    – appears when trigger zone activates
    trap       – looks solid (dark), kills instantly on landing
    goal       – exit portal

  Level object:
    { name, worldW, worldH, spawnX, spawnY, darkMode,
      tiles[], spikes[], triggers[], gravityZones[], dangerZones[] }

  Trigger zone: { id, x, y, w, h, minStillFrames, glow }
  Danger zone:  { x, y, w, h, glow }  — feet contact = instant death
  Gravity zone: { x, y, w, h, gravMult, jumpMult }
*/

function makeLevelParts() {
  const tiles = [], spikes = [], triggers = [], gravityZones = [], dangerZones = [];
  const T = CFG.TILE_W, H = CFG.TILE_H;

  /* tile shortcuts */
  const S  = (x,y,w,h)       => tiles.push({type:'solid',      x,y,w:w||T,h:h||H,id:tiles.length});
  const F  = (x,y,w,h)       => tiles.push({type:'fake',       x,y,w:w||T,h:h||H,id:tiles.length});
  const I  = (x,y,w,h)       => tiles.push({type:'invisible',  x,y,w:w||T,h:h||H,id:tiles.length});
  const C  = (x,y,w,h,light) => tiles.push({type:'crumble',    x,y,w:w||T,h:h||H,id:tiles.length,state:'idle',timer:0,light:!!light});
  const R  = (x,y,w,h)       => tiles.push({type:'reveal',     x,y,w:w||T,h:h||H,id:tiles.length,visible:false});
  const Z  = (x,y,w,h)       => tiles.push({type:'false-safe', x,y,w:w||T,h:h||H,id:tiles.length,timer:0,dangerous:false,dangerTimer:0,_warming:false});
  const TR = (x,y,w,h,tId)   => tiles.push({type:'trigger',    x,y,w:w||T,h:h||H,id:tiles.length,trigId:tId,active:false});
  const TP = (x,y,w,h)       => tiles.push({type:'trap',       x,y,w:w||T,h:h||H,id:tiles.length});
  const SL = (x,y,w,h)       => tiles.push({type:'solid',      x,y,w:w||T,h:h||H,id:tiles.length,light:true});
  const G  = (x,y,w,h)       => tiles.push({type:'goal',       x,y,w:w||T,h:h||H,id:tiles.length});

  const spike = (x,y,n) => { for(let i=0;i<n;i++) spikes.push({x:x+i*16,y,w:16,h:10}); };

  /* trigger zone helper */
  const trig = (id,x,y,w,h,minStill,glow) =>
    triggers.push({id,x,y,w:w||48,h:h||80,minStillFrames:minStill||0,glow:!!glow});

  /* gravity zone helper */
  const grav = (x,y,w,h,gm,jm) =>
    gravityZones.push({x,y,w,h,gravMult:gm,jumpMult:jm!==undefined?jm:1});

  /* danger zone helper (feet contact = death) */
  const dzone = (x,y,w,h,glow) => dangerZones.push({x,y,w,h,glow:!!glow});

  return { tiles,spikes,triggers,gravityZones,dangerZones,
           S,F,I,C,R,Z,TR,TP,SL,G,spike,trig,grav,dzone };
}

/* ═══════════════════════════════════════════════════════════════════════
   PHASE 1 — INTRODUCTION (Levels 1–5)
   One trap at a time. Build baseline trust.
   ═══════════════════════════════════════════════════════════════════════ */

// ── Level 1 "One Step" — flat corridor, no traps. Learn controls & exit.
function buildLevel1() {
  const {S,G,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 680, 16);
  G(668, 372, 32, 28);
  return {name:'01 · One Step', worldW:800, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 2 "The Gap" — visible spike pit; must jump to cross.
function buildLevel2() {
  const {S,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40,  400, 180, 16);
  S(400, 400, 340, 16);
  G(698, 372, 32, 28);
  spike(220, 410, 11);
  return {name:'02 · The Gap', worldW:840, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 3 "First Lie" — multiple fake tiles mixed with solids (identical look).
function buildLevel3() {
  const {S,F,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 160, 16);
  F(200, 400);        // fake
  F(232, 400);        // fake
  S(264, 400);        // solid — safe
  F(296, 400);        // fake
  S(328, 400);        // solid — safe
  F(360, 400);        // fake
  S(396, 400, 280, 16);
  G(634, 372, 32, 28);
  spike(200, 410, 14);
  return {name:'03 · First Lie', worldW:760, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 4 "Safe Color" — dark=solid safe; light=crumble dangerous.
function buildLevel4() {
  const {S,C,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 100, 16);
  S(160, 400);
  C(212, 400, 32, 16, true);
  C(244, 400, 32, 16, true);
  S(296, 400);
  C(348, 400, 32, 16, true);
  C(380, 400, 32, 16, true);
  C(412, 400, 32, 16, true);
  S(464, 400);
  C(516, 400, 32, 16, true);
  C(548, 400, 32, 16, true);
  S(600, 400);
  S(652, 400, 180, 16);
  G(790, 372, 32, 28);
  spike(140, 410, 40);
  return {name:'04 · Safe Color', worldW:960, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 5 "Double Cross" — fake-tile bridge over a jumpable pit.
function buildLevel5() {
  const {S,F,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 180, 16);
  F(220, 400); F(252, 400); F(284, 400); F(316, 400); F(348, 400);
  S(380, 400, 340, 16);
  G(668, 372, 32, 28);
  spike(220, 410, 11);
  return {name:'05 · Double Cross', worldW:800, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

/* ═══════════════════════════════════════════════════════════════════════
   PHASE 2 — DISCOVERY (Levels 6–10)
   Break assumptions. Reward curiosity.
   ═══════════════════════════════════════════════════════════════════════ */

// ── Level 6 "Empty Air" — gap seems impassable; invisible platforms cross it.
function buildLevel6() {
  const {S,I,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40,  400, 160, 16);
  I(280, 400);
  I(370, 400);
  I(460, 400);
  S(550, 400, 200, 16);
  G(708, 372, 32, 28);
  spike(200, 410, 22);
  return {name:'06 · Empty Air', worldW:860, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 7 "Patient Ground" — crumble + solid mix; keep moving.
function buildLevel7() {
  const {S,C,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 80, 16);
  C(160, 380); C(200, 360); C(240, 340);
  S(280, 340);
  C(320, 340); C(360, 340); C(400, 340); C(440, 340);
  S(480, 340);
  C(520, 340); C(560, 340); C(600, 340);
  S(640, 360); S(680, 380); S(720, 400, 160, 16);
  G(838, 372, 32, 28);
  spike(120, 420, 42);
  return {name:'07 · Patient Ground', worldW:980, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 8 "Friendly Fire" — open platform; edge danger zones are invisible.
function buildLevel8() {
  const {S,G,dzone,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40,  400, 80,  16);
  S(180, 400, 440, 16);
  S(680, 400, 80,  16);
  G(710, 372, 32, 28);
  dzone(180, 368, 52, 48);     // left-edge death strip
  dzone(568, 368, 52, 48);     // right-edge death strip
  spike(120, 410, 4);
  spike(640, 410, 4);
  return {name:'08 · Friendly Fire', worldW:820, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 9 "The False Bottom" — shaft: fake floor at bottom, invisible mid-platform.
function buildLevel9() {
  const {S,F,I,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40,  100, 200, 16);
  S(40,  116, 16,  920);    // left wall (extended full height)
  S(208, 116, 16,  462);    // right wall upper (y=116–578; gap at 578–600 for player exit)
  S(208, 600, 16,  436);    // right wall lower (y=600–1036)
  I(56,  600, 152, 16);     // invisible mid-shaft landing (real safe spot)
  S(224, 600, 200, 16);
  F(56,  1020, 152, 16);    // fake floor — hidden below initial viewport
  spike(56, 1036, 9);
  S(424, 600, 160, 16);
  G(544, 572, 32, 28);
  return {name:'09 · The False Bottom', worldW:680, worldH:1100, spawnX:80, spawnY:78,
          initialCamOffsetY: 0.9,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 10 "Unstable Trust" — dark tiles now crumble quickly; rules changed.
function buildLevel10() {
  const {S,C,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 80, 16);
  const sc = (x,y) => tiles.push({type:'crumble',x,y,w:CFG.TILE_W,h:CFG.TILE_H,
                                   id:tiles.length,state:'idle',timer:0,warnFrames:55});
  sc(160,400); sc(210,400); sc(262,400);
  C(314,400);
  sc(366,400); sc(418,400);
  C(470,400);
  sc(522,400); sc(574,400);
  S(630, 400, 200, 16);
  G(788, 372, 32, 28);
  spike(140, 410, 32);
  return {name:'10 · Unstable Trust', worldW:920, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

/* ═══════════════════════════════════════════════════════════════════════
   PHASE 3 — REINFORCEMENT (Levels 11–15)
   Combine mechanics. Demand memory and timing.
   ═══════════════════════════════════════════════════════════════════════ */

// ── Level 11 "The Trigger" — enter zone → bridge materialises; sprint across.
function buildLevel11() {
  const {S,TR,G,trig,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 160, 16);
  trig('B1', 130, 330, 70, 90);
  TR(240, 400, 32, 16, 'B1');
  TR(272, 400, 32, 16, 'B1');
  TR(304, 400, 32, 16, 'B1');
  TR(336, 400, 32, 16, 'B1');
  S(370, 400, 300, 16);
  G(628, 372, 32, 28);
  spike(200, 410, 10);
  return {name:'11 · The Trigger', worldW:760, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 12 "Still Waters" — stand completely still; path glows into view.
function buildLevel12() {
  const {S,R,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 80, 16);
  R(170, 400); R(210, 400); R(250, 400); R(290, 400); R(330, 400);
  S(370, 400, 300, 16);
  G(628, 372, 32, 28);
  spike(120, 410, 16);
  return {name:'12 · Still Waters', worldW:760, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 13 "Cascade" — trigger→crumble chain; plan full sequence before moving.
function buildLevel13() {
  const {S,C,TR,G,trig,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 120, 16);
  trig('PA', 110, 330, 70, 90);
  TR(220, 400, 32, 16, 'PA');
  C(260, 400); C(300, 400); C(340, 400); C(380, 400);
  S(420, 400);
  trig('PB', 430, 330, 70, 90);
  TR(540, 400, 32, 16, 'PB');
  C(580, 400); C(620, 400); C(660, 400);
  S(700, 400, 160, 16);
  G(818, 372, 32, 28);
  spike(160, 410, 39);
  return {name:'13 · Cascade', worldW:960, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 14 "Memory Pit" — mostly fake; one solid per group. Deaths map the safe tile.
function buildLevel14() {
  const {S,F,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 120, 16);
  F(200, 400); F(240, 400);
  S(280, 400);           // safe — slot 3
  F(320, 400); F(360, 400);
  S(400, 400, 60, 16);
  F(510, 400); F(550, 400); F(590, 400);
  S(630, 400);           // safe — slot 4
  F(670, 400);
  S(710, 400, 140, 16);
  G(808, 372, 32, 28);
  spike(160, 410, 28);
  spike(500, 410, 16);
  return {name:'14 · Memory Pit', worldW:920, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 15 "The Patience Tax" — reveal-crumble hybrids; act instantly after reveal.
function buildLevel15() {
  const {S,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 80, 16);
  const RC = (x,y) => tiles.push({type:'crumble',x,y,w:CFG.TILE_W,h:CFG.TILE_H,
                                   id:tiles.length,state:'idle',timer:0,
                                   reveal:true,visible:false,warnFrames:22});
  RC(170,400); RC(210,400); RC(250,400); RC(290,400); RC(330,400); RC(370,400);
  S(410, 400, 80, 16);
  RC(540,400); RC(580,400); RC(620,400); RC(660,400);
  S(700, 400, 140, 16);
  G(798, 372, 32, 28);
  spike(120, 410, 38);
  return {name:'15 · The Patience Tax', worldW:940, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

/* ═══════════════════════════════════════════════════════════════════════
   PHASE 4 — SUBVERSION (Levels 16–20)
   Break learned rules. Reverse expectations.
   ═══════════════════════════════════════════════════════════════════════ */

// ── Level 16 "The Betrayal" — looks like L2 but the bridge is entirely fake.
function buildLevel16() {
  const {S,F,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 220, 16);
  F(268, 400); F(300, 400); F(332, 400); F(364, 400);
  S(396, 400, 340, 16);
  G(694, 372, 32, 28);
  spike(260, 410, 9);
  return {name:'16 · The Betrayal', worldW:820, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 17 "Dark Side" — rules inverted: light=safe; dark=trap/kill.
function buildLevel17() {
  const {S,SL,TP,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 80, 16);
  TP(160, 400);
  TP(192, 400);
  SL(244, 400);
  TP(296, 400);
  TP(328, 400);
  TP(360, 400);
  SL(412, 400);
  TP(464, 400);
  SL(516, 400);
  SL(548, 400);
  TP(600, 400);
  TP(632, 400);
  SL(684, 400);
  S(736, 400, 160, 16);
  G(854, 372, 32, 28);
  spike(140, 410, 41);
  return {name:'17 · Dark Side', worldW:1000, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 18 "Gravity Drift" — gravity doubles halfway; jump arc shrinks.
function buildLevel18() {
  const {S,G,grav,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 160, 16);
  S(220, 380); S(270, 360); S(320, 340);
  grav(360, 0, 500, 480, 2.0, 0.68);
  S(380, 340); S(420, 340); S(460, 340);
  S(500, 360); S(540, 380); S(580, 400, 240, 16);
  G(778, 372, 32, 28);
  spike(160, 420, 28);
  return {name:'18 · Gravity Drift', worldW:920, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 19 "Safe No More" — glowing zone looks like L11's trigger but kills.
//    Real elevated platform is above/beyond it — jump over, not into.
function buildLevel19() {
  const {S,G,dzone,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 160, 16);
  dzone(240, 383, 48, 33, true);     // glow:true — identical look to L11 trigger
  S(320, 352, 200, 16);              // elevated real path above the danger zone
  S(560, 400, 200, 16);
  G(718, 372, 32, 28);
  spike(200, 420, 9);
  return {name:'19 · Safe No More', worldW:840, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 20 "Double Fake" — visible upper tiles fake; invisible lower ones real.
function buildLevel20() {
  const {S,F,I,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 140, 16);
  F(220, 400); F(260, 400); F(300, 400); F(340, 400);
  I(220, 424); I(260, 424); I(300, 424); I(340, 424);
  S(380, 424, 40, 16);
  S(420, 408, 80, 16);
  F(560, 400); F(600, 400); F(640, 400);
  I(560, 424); I(600, 424); I(640, 424);
  S(680, 400, 160, 16);
  G(798, 372, 32, 28);
  spike(180, 456, 33);
  return {name:'20 · Double Fake', worldW:920, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

/* ═══════════════════════════════════════════════════════════════════════
   PHASE 5 — MASTERY (Levels 21–30)
   Everything at once. Fast adaptation. Earned difficulty.
   ═══════════════════════════════════════════════════════════════════════ */

// ── Level 21 "Chain Reaction" — trigger+crumble sprint+gravity zone in sequence.
function buildLevel21() {
  const {S,C,TR,G,trig,grav,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 100, 16);
  trig('Q1', 100, 330, 60, 90);
  TR(180,400,32,16,'Q1'); TR(212,400,32,16,'Q1');
  C(252,400); C(292,400); C(332,400); S(372,400);
  C(412,400); C(452,400); S(492,400);
  grav(540, 0, 600, 480, 1.8, 0.70);
  S(540,400); S(580,380); S(620,360); S(660,360);
  C(700,360); C(740,360);
  S(780,360,160,16);
  G(898,332,32,28);
  spike(160,410,25);
  spike(540,420,15);
  return {name:'21 · Chain Reaction', worldW:1040, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 22 "The Hesitation Path" — patience triggers: wait 1 s on platform → next appears.
function buildLevel22() {
  const {S,TR,G,trig,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 80, 16);
  trig('H1',  60, 358, 60, 62, CFG.PATIENCE_FRAMES);
  TR(180,400,32,16,'H1');
  S(220,400,48,16);
  trig('H2', 228, 358, 48, 62, CFG.PATIENCE_FRAMES);
  TR(330,400,32,16,'H2');
  S(370,400,48,16);
  trig('H3', 378, 358, 48, 62, CFG.PATIENCE_FRAMES);
  TR(480,400,32,16,'H3');
  S(520,400,48,16);
  trig('H4', 528, 358, 48, 62, CFG.PATIENCE_FRAMES);
  TR(630,400,32,16,'H4');
  S(670,400,160,16);
  G(788,372,32,28);
  spike(120,410,36);
  return {name:'22 · The Hesitation Path', worldW:920, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 23 "False Memory" — invisible platforms; systematic elimination reveals path.
function buildLevel23() {
  const {S,I,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 80, 16);
  I(180, 400);          // real — slot 1
                        // slot 2 — gap (death)
  I(320, 400);          // real — slot 3
                        // slot 4 — gap
  I(460, 400);          // real — slot 5
  S(540, 400, 80, 16);
                        // slot 1 — gap
  I(680, 400);          // real — slot 2
                        // slot 3 — gap
  I(820, 400);          // real — slot 4
  S(900, 400, 160, 16);
  G(1018,372,32,28);
  spike(120,410,51);
  return {name:'23 · False Memory', worldW:1140, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 24 "The Mirror" — left half original rules; right half inverted.
function buildLevel24() {
  const {S,C,SL,TP,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 80, 16);
  // Left: dark=safe, light=crumble
  S(160,400); C(212,400,32,16,true); S(264,400);
  C(316,400,32,16,true); S(368,400);
  S(420,400,40,16);     // midpoint divider
  // Right: light=safe (SL), dark=trap (TP)
  SL(520,400); TP(572,400); SL(624,400);
  TP(676,400); TP(708,400); SL(760,400);
  S(820,400,160,16);
  G(938,372,32,28);
  spike(140,410,46);
  return {name:'24 · The Mirror', worldW:1080, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 25 "Slow Burn" — wide false-safe platform with compressed timer.
function buildLevel25() {
  const {S,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 80, 16);
  tiles.push({type:'false-safe',x:180,y:400,w:480,h:16,id:tiles.length,
              timer:0,dangerous:false,dangerTimer:0,_warming:false,
              fastTTL:100, fastWarn:50});
  S(700, 400, 160, 16);
  G(818, 372, 32, 28);
  spike(120, 420, 4);
  spike(680, 420, 4);
  return {name:'25 · Slow Burn', worldW:960, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 26 "Trigger Happy" — two identical glowing zones; one dangerous, one trigger.
function buildLevel26() {
  const {S,TR,G,trig,dzone,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 160, 16);
  dzone(240, 378, 48, 38, true);            // left zone — looks like trigger, is deadly
  trig('K1', 340, 378, 48, 38, 0, true);   // right zone — same glow, actually helpful
  S(340, 400, 48, 16);                      // ground under trigger so player doesn't fall after activating
  TR(390,400,32,16,'K1'); TR(422,400,32,16,'K1');
  TR(454,400,32,16,'K1'); TR(486,400,32,16,'K1');
  TR(518,400,32,16,'K1');
  S(560, 400, 200, 16);
  G(718, 372, 32, 28);
  spike(200, 420, 23);
  return {name:'26 · Trigger Happy', worldW:860, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 27 "Ghostwalk" — light gravity, instant-crumble invisible platforms; keep ascending.
function buildLevel27() {
  const {S,G,grav,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  grav(0, 0, 480, 760, 0.45, 1.25);
  S(40, 680, 200, 16);
  const ic = (x,y) => tiles.push({type:'crumble',x,y,w:CFG.TILE_W,h:CFG.TILE_H,
                                   id:tiles.length,state:'idle',timer:0,instantCrumble:true});
  ic(80, 600); ic(180, 530); ic(80,  460); ic(200, 400);
  ic(100,330); ic(220, 270); ic(80,  210);
  S(60, 150, 200, 16);
  G(120, 122, 32, 28);
  spike(40, 700, 12);
  return {name:'27 · Ghostwalk', worldW:480, worldH:760, spawnX:100, spawnY:658,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 28 "The Patience Gauntlet" — reveal-crumble + patience triggers + more reveal.
function buildLevel28() {
  const {S,C,TR,G,trig,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 80, 16);
  const RC = (x,y) => tiles.push({type:'crumble',x,y,w:CFG.TILE_W,h:CFG.TILE_H,
                                   id:tiles.length,state:'idle',timer:0,reveal:true,visible:false,warnFrames:22});
  RC(170,400); RC(210,400); RC(250,400); RC(290,400);
  S(330,400,60,16);
  trig('G1', 340, 340, 70, 80, CFG.PATIENCE_FRAMES);
  TR(450,400,32,16,'G1'); C(490,400); C(530,400); C(570,400);
  TR(610,400,32,16,'G1');
  S(650,400,60,16);
  trig('G2', 660, 340, 70, 80, CFG.PATIENCE_FRAMES);
  RC(780,400); RC(820,400); RC(860,400); RC(900,400);
  S(940,400,140,16);
  G(1040,372,32,28);
  spike(120,410,55);
  return {name:'28 · The Patience Gauntlet', worldW:1160, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 29 "Everything You Know" — five compact Phase-4 subversions in sequence.
function buildLevel29() {
  const {S,F,I,C,SL,TP,TR,G,trig,grav,dzone,spike,
         tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();

  // §1 — fake bridge (L16 echo)
  S(40,400,120,16);
  F(200,400); F(232,400); F(264,400);
  S(320,400,48,16);
  spike(160,410,11);

  // §2 — inverted colours (L17 echo)
  TP(420,400); SL(452,400); TP(484,400); SL(516,400);
  S(568,400,48,16);
  spike(400,410,11);

  // §3 — glowing danger zone masquerading as trigger (L19 echo)
  dzone(666,383,48,33,true);
  S(720,352,80,16);
  S(820,400,48,16);
  spike(640,420,7);

  // §4 — double fake / invisible below (L20 echo)
  F(920,400); F(952,400); F(984,400);
  I(920,424); I(952,424); I(984,424);
  S(1016,424,48,16);
  S(1080,400,48,16);
  spike(900,456,11);

  // §5 — heavy gravity (L18 echo)
  grav(1178,0,300,480, 2.0, 0.68);
  S(1178,400); S(1218,400); S(1258,400);
  S(1298,400,200,16);
  G(1456,372,32,28);
  spike(1178,420,6);

  return {name:'29 · Everything You Know', worldW:1580, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 30 "Blindpath" — complete darkness; pure memory and trust.
function buildLevel30() {
  const {S,F,C,I,G,grav,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();

  S(40,400,80,16);

  // Echo — fake floor
  F(180,400); F(212,400);
  S(244,400,80,16);

  // Echo — invisible bridge
  I(380,400); I(420,400); I(460,400);
  S(500,400,60,16);

  // Echo — reveal-crumble
  const RC = (x,y) => tiles.push({type:'crumble',x,y,w:CFG.TILE_W,h:CFG.TILE_H,
                                   id:tiles.length,state:'idle',timer:0,reveal:true,visible:false});
  RC(620,400); RC(660,400); RC(700,400);
  S(740,400,60,16);

  S(860,400,60,16);

  // Echo — light gravity ascent
  grav(980,0,400,480, 0.50, 1.20);
  I(980,380); I(1040,360); I(1100,340); I(1160,360); I(1220,380);
  S(1280,400,120,16);

  G(1360,372,32,28);

  spike(160,410,4);
  spike(340,410,8);
  spike(560,410,4);
  spike(800,410,4);
  spike(920,410,4);

  return {name:'30 · Blindpath', worldW:1520, worldH:480, spawnX:50, spawnY:378,
          darkMode:true,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

/* ── 7. LEVELS REGISTRY ──────────────────────────────────────────────── */
const LEVELS = [
  buildLevel1,  buildLevel2,  buildLevel3,  buildLevel4,  buildLevel5,
  buildLevel6,  buildLevel7,  buildLevel8,  buildLevel9,  buildLevel10,
  buildLevel11, buildLevel12, buildLevel13, buildLevel14, buildLevel15,
  buildLevel16, buildLevel17, buildLevel18, buildLevel19, buildLevel20,
  buildLevel21, buildLevel22, buildLevel23, buildLevel24, buildLevel25,
  buildLevel26, buildLevel27, buildLevel28, buildLevel29, buildLevel30,
];

/* ── 7a. PHASE MODIFIERS ─────────────────────────────────────────────── */
/*
  Applied on top of freshly-built level data when entering Phase 2 or 3.
  Each call receives a new object from the builder so modifications are safe.

  Phase 2 — Disorientation:
    • Every 5th individual solid tile (w=TILE_W) → slow crumble (warnFrames 90)
    • Camera offset is inverted in updateCamera() so player sees less ahead.

  Phase 3 — Designed to Lose:
    • Fake tiles → invisible  (memorised paths gone)
    • Crumble tiles (non-reveal) → instantCrumble
    • Every 4th individual solid tile (w=TILE_W) → trap
    • false-safe timers compressed to 80 / 40 frames
*/
function applyPhaseModifiers(level, phase) {
  if (phase === 1) return;
  const T  = CFG.TILE_W;
  const tiles = level.tiles;

  if (phase === 2) {
    let sc = 0;
    tiles.forEach(tile => {
      if (tile.type === 'solid' && tile.w === T) {
        sc++;
        if (sc % 4 === 0) {
          tile.type      = 'crumble';
          tile.state     = 'idle';
          tile.timer     = 0;
          tile.warnFrames = 70;
        }
      }
    });
  }

  if (phase === 3) {
    tiles.forEach(tile => {
      if (tile.type === 'fake') tile.type = 'invisible';
    });
    tiles.forEach(tile => {
      if (tile.type === 'crumble' && !tile.reveal) tile.instantCrumble = true;
    });
    let sc = 0;
    tiles.forEach(tile => {
      if (tile.type === 'solid' && tile.w === T) {
        sc++;
        if (sc % 3 === 0) tile.type = 'trap';
      }
    });
    tiles.forEach(tile => {
      if (tile.type === 'false-safe') {
        tile.fastTTL  = 60;
        tile.fastWarn = 30;
      }
    });
  }
}

/* ── 8. VIEWPORT & CAMERA ────────────────────────────────────────────── */
let vpW = 0, vpH = 0;
let camX = 0, camY = 0;

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
  // Phase 2: offset reversed so player sees more of what's behind (disorienting)
  const offsetX = gamePhase === 2 ? 0.62 : CFG.CAM_OFFSET_X;
  const offsetY = (currentLevel.initialCamOffsetY && !state.hasJumped)
    ? currentLevel.initialCamOffsetY : CFG.CAM_OFFSET_Y;
  const target = {
    x: state.player.x - vpW * offsetX,
    y: state.player.y - vpH * offsetY,
  };
  camX += (target.x - camX) * CFG.CAM_LERP;
  camY += (target.y - camY) * CFG.CAM_LERP;
  camX = Math.max(0, Math.min(camX, currentLevel.worldW - vpW));
  camY = Math.max(0, Math.min(camY, currentLevel.worldH - vpH));
}

/* ── 9. RENDERING ────────────────────────────────────────────────────── */
let domTiles = {};
let playerEl = null;

function buildDOM() {
  gameWorld.innerHTML = '';
  domTiles  = {};

  gameWorld.classList.toggle('dark-mode', !!currentLevel.darkMode);
  gameWorld.style.width  = currentLevel.worldW + 'px';
  gameWorld.style.height = currentLevel.worldH + 'px';

  for (let i = 0; i < 80; i++) {
    const s = document.createElement('div');
    s.className = 'bg-star';
    s.style.left    = Math.random() * currentLevel.worldW + 'px';
    s.style.top     = Math.random() * currentLevel.worldH * 0.85 + 'px';
    s.style.opacity = (0.3 + Math.random() * 0.5).toFixed(2);
    gameWorld.appendChild(s);
  }

  currentLevel.gravityZones.forEach(zone => {
    const el = document.createElement('div');
    el.className = 'gravity-zone ' + (zone.gravMult > 1 ? 'gravity-heavy' : 'gravity-light');
    el.style.cssText = `left:${zone.x}px;top:${zone.y}px;width:${zone.w}px;height:${zone.h}px;`;
    gameWorld.appendChild(el);
  });

  currentLevel.dangerZones.forEach(zone => {
    if (!zone.glow) return;
    const el = document.createElement('div');
    el.className = 'zone-glow';
    el.style.cssText = `left:${zone.x}px;top:${zone.y}px;width:${zone.w}px;height:${zone.h}px;`;
    gameWorld.appendChild(el);
  });

  currentLevel.triggers.forEach(zone => {
    if (!zone.glow) return;
    const el = document.createElement('div');
    el.className = 'zone-glow';
    el.style.cssText = `left:${zone.x}px;top:${zone.y}px;width:${zone.w}px;height:${zone.h}px;`;
    gameWorld.appendChild(el);
  });

  currentLevel.tiles.forEach(tile => {
    const el = document.createElement('div');
    el.className = 'tile tile-' + tile.type;
    if (tile.light) el.classList.add('light');
    el.style.cssText = `left:${tile.x}px;top:${tile.y}px;width:${tile.w}px;height:${tile.h}px;`;
    if (tile.type === 'goal') el.textContent = '\u25b2';
    gameWorld.appendChild(el);
    domTiles[tile.id] = el;
  });

  currentLevel.spikes.forEach(sp => {
    const wrapper = document.createElement('div');
    wrapper.className = 'spike';
    wrapper.style.cssText = `left:${sp.x}px;top:${sp.y}px;width:${sp.w}px;height:${sp.h}px;`;
    const inner = document.createElement('div');
    inner.className = 'spike-inner';
    inner.style.borderLeft   = (sp.w / 2) + 'px solid transparent';
    inner.style.borderRight  = (sp.w / 2) + 'px solid transparent';
    inner.style.borderBottom = sp.h + 'px solid #8a1a1a';
    wrapper.appendChild(inner);
    gameWorld.appendChild(wrapper);
  });

  playerEl = document.createElement('div');
  playerEl.id = 'player';
  gameWorld.appendChild(playerEl);
}

function renderFrame() {
  // Phase 2: slow sinusoidal world drift for disorientation
  let driftX = 0, driftY = 0;
  if (gamePhase === 2) {
    const t = Date.now() / 1000;
    driftX = Math.sin(t * 0.25) * 8;
    driftY = Math.cos(t * 0.18) * 4;
  }
  gameWorld.style.transform =
    `translate(${-Math.round(camX + driftX)}px, ${-Math.round(camY + driftY)}px)`;

  const p = state.player;
  playerEl.style.left      = Math.round(p.x) + 'px';
  playerEl.style.top       = Math.round(p.y) + 'px';
  playerEl.style.transform = p.facing === -1 ? 'scaleX(-1)' : '';

  currentLevel.tiles.forEach(tile => {
    const el = domTiles[tile.id];
    if (!el) return;
    if (tile.type === 'crumble') {
      const isVis = tile.reveal ? tile.visible : true;
      el.style.opacity = isVis ? '1' : '0';
      el.classList.toggle('shaking', tile.state === 'shaking' && isVis);
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

/* ── 10. PHYSICS HELPERS ─────────────────────────────────────────────── */
function rectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx+bw && ax+aw > bx && ay < by+bh && ay+ah > by;
}
function rectOverlapAmt(ax, ay, aw, ah, bx, by, bw, bh) {
  return {
    ox: Math.min(ax+aw, bx+bw) - Math.max(ax, bx),
    oy: Math.min(ay+ah, by+bh) - Math.max(ay, by),
  };
}

/* ── 11. PLAYER & PHYSICS ────────────────────────────────────────────── */
function initPlayer() {
  return {
    x: currentLevel.spawnX, y: currentLevel.spawnY,
    vx:0, vy:0, onGround:false, facing:1,
    coyote:0, jumpBuf:0, dead:false, respawnTimer:0,
    stillTimer:0, justLanded:false,
  };
}

function updatePlayer() {
  const p = state.player;

  const jumpNow  = keys.jump;
  const jumpDown = jumpNow && !_jumpWasDown;
  const jumpUp   = !jumpNow && _jumpWasDown;
  _jumpWasDown   = jumpNow;

  if (p.dead) {
    p.respawnTimer--;
    if (p.respawnTimer <= 0) respawn();
    return;
  }

  const pw = CFG.PLAYER_W, ph = CFG.PLAYER_H;

  // Gravity zone lookup
  let gravMult = 1.0, jumpMult = 1.0;
  currentLevel.gravityZones.forEach(zone => {
    if (rectOverlap(p.x, p.y, pw, ph, zone.x, zone.y, zone.w, zone.h)) {
      gravMult = zone.gravMult;
      jumpMult = zone.jumpMult;
    }
  });

  // Horizontal movement
  let moveX = 0;
  if (keys.left)  moveX = -1;
  if (keys.right) moveX =  1;

  if (moveX !== 0) {
    p.facing = moveX;
    p.vx += moveX * CFG.MOVE_ACCEL;
    p.vx  = Math.max(-CFG.MOVE_MAX, Math.min(CFG.MOVE_MAX, p.vx));
    p.stillTimer = 0;
  } else {
    p.vx *= p.onGround ? CFG.FRICTION : CFG.AIR_FRICTION;
    if (Math.abs(p.vx) < 0.1) p.vx = 0;
    p.stillTimer++;
  }

  // Jump buffer & coyote time
  if (jumpDown) p.jumpBuf = CFG.JUMP_BUFFER;
  else if (p.jumpBuf > 0) p.jumpBuf--;
  if (p.onGround) p.coyote = CFG.COYOTE_FRAMES;
  else if (p.coyote > 0) p.coyote--;

  if (p.jumpBuf > 0 && p.coyote > 0) {
    p.vy      = CFG.JUMP_FORCE * jumpMult;
    p.coyote  = 0;
    p.jumpBuf = 0;
    sfxJump();
    state.hasJumped = true;
  }
  if (jumpUp && p.vy < 0) p.vy *= CFG.JUMP_CUT;

  // Gravity (zone-modified)
  p.vy += CFG.GRAVITY * gravMult;
  if (!p.onGround && p.vy > 0) p.vy += CFG.GRAVITY * CFG.FALL_GRAV_MULT * gravMult;
  if (p.vy > 24) p.vy = 24;

  const prevOnGround = p.onGround;
  p.onGround = false;
  p.x += p.vx;
  resolveCollisionsX(p);
  p.y += p.vy;
  resolveCollisionsY(p);

  if (p.onGround && !prevOnGround) { sfxLand(); p.justLanded = true; }
  else { p.justLanded = false; }

  if (p.y > currentLevel.worldH + 80) { hurtPlayer(); return; }

  updateTraps(p);
}

/* ── 12. COLLISION RESOLUTION ────────────────────────────────────────── */
function getTileRect(tile) { return {x:tile.x,y:tile.y,w:tile.w,h:tile.h}; }

function isTileSolid(tile) {
  switch (tile.type) {
    case 'solid':      return true;
    case 'trap':       return true;
    case 'invisible':  return true;
    case 'fake':       return !tile._touched;
    case 'crumble':    return tile.state !== 'gone' && (tile.reveal ? tile.visible : true);
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
    const {x,y,w,h} = getTileRect(tile);
    if (!rectOverlap(p.x,p.y,pw,ph,x,y,w,h)) return;
    const {ox} = rectOverlapAmt(p.x,p.y,pw,ph,x,y,w,h);
    if (p.vx > 0) p.x -= ox; else if (p.vx < 0) p.x += ox;
    p.vx = 0;
  });
}

function resolveCollisionsY(p) {
  const pw = CFG.PLAYER_W, ph = CFG.PLAYER_H;
  p.onGround = false;
  currentLevel.tiles.forEach(tile => {
    if (!isTileSolid(tile)) return;
    const {x,y,w,h} = getTileRect(tile);
    if (!rectOverlap(p.x,p.y,pw,ph,x,y,w,h)) return;
    const {oy} = rectOverlapAmt(p.x,p.y,pw,ph,x,y,w,h);
    if (p.vy > 0) {
      const prevBottom = p.y + ph - p.vy;
      if (prevBottom <= y + 2) {
        p.y -= oy; p.vy = 0; p.onGround = true;
        onLandOn(tile, p);
      }
    } else if (p.vy < 0) {
      p.y += oy; p.vy = 0;
    }
  });
}

/* ── 13. TRAP LOGIC ──────────────────────────────────────────────────── */
function onLandOn(tile, p) {
  if (tile.type === 'fake') {
    tile._touched = true;
    const el = domTiles[tile.id];
    if (el) el.classList.add('dissolving');
  }
  if (tile.type === 'trap') { hurtPlayer(); return; }
  if (tile.type === 'crumble' && tile.state === 'idle') {
    tile.state = 'shaking';
    tile.timer = tile.instantCrumble ? 1 : (tile.warnFrames || CFG.CRUMBLE_WARN);
  }
  if (tile.type === 'goal') { reachGoal(); }
}

function updateTraps(p) {
  const pw = CFG.PLAYER_W, ph = CFG.PLAYER_H;

  currentLevel.tiles.forEach(tile => {

    // Crumble (incl. reveal-crumble hybrid)
    if (tile.type === 'crumble') {
      if (tile.reveal && !tile.visible) {
        const inRange = p.x + pw > tile.x - 160 && p.x < tile.x + tile.w + 160;
        if (p.onGround && inRange && p.stillTimer >= CFG.REVEAL_STILL) {
          tile.visible = true; tile.state = 'idle'; tile.timer = 0;
          sfxReveal();
        }
      }
      if (tile.state === 'shaking') {
        tile.timer--;
        if (tile.timer <= 0) {
          tile.state = 'gone'; tile.timer = CFG.CRUMBLE_GONE;
          if (tile.reveal) tile.visible = false;
        }
      } else if (tile.state === 'gone') {
        tile.timer--;
        if (tile.timer <= 0) tile.state = 'idle';
      }
    }

    // Pure reveal tiles
    if (tile.type === 'reveal') {
      const inRange = p.x + pw > tile.x - 160 && p.x < tile.x + tile.w + 160;
      if (p.onGround && inRange && p.stillTimer >= CFG.REVEAL_STILL) {
        if (!tile.visible) { tile.visible = true; sfxReveal(); }
      }
    }

    // False-safe
    if (tile.type === 'false-safe') {
      const ttl  = tile.fastTTL  || CFG.FALSE_SAFE_TTL;
      const warn = tile.fastWarn || CFG.FALSE_SAFE_WARN;
      const onThis = p.onGround &&
        rectOverlap(p.x, p.y, pw, ph, tile.x, tile.y, tile.w, tile.h);
      if (onThis) {
        tile.timer++;
        if (tile.timer >= warn && !tile._warming && !tile.dangerous) tile._warming = true;
        if (tile.timer >= ttl  && !tile.dangerous) {
          tile.dangerous = true; tile.dangerTimer = 0; tile._warming = false;
        }
        if (tile.dangerous) {
          tile.dangerTimer++;
          if (tile.dangerTimer >= CFG.FALSE_SAFE_GRACE) hurtPlayer();
        }
      } else if (!tile.dangerous) {
        tile.timer = Math.max(0, tile.timer - 2);
        if (tile.timer < warn) tile._warming = false;
      }
    }

    // Triggered tiles
    if (tile.type === 'trigger' && !tile.active) {
      currentLevel.triggers.forEach(zone => {
        if (zone.id !== tile.trigId) return;
        const inZone = rectOverlap(p.x, p.y, pw, ph, zone.x, zone.y, zone.w, zone.h);
        if (inZone) {
          if (zone.minStillFrames > 0) {
            if (p.stillTimer >= zone.minStillFrames) tile.active = true;
          } else {
            tile.active = true;
          }
        }
        const nearZone = p.x + pw > zone.x - CFG.GHOST_RADIUS &&
                         p.x < zone.x + zone.w + CFG.GHOST_RADIUS;
        tile._near = nearZone;
      });
    }

    // Goal
    if (tile.type === 'goal') {
      if (rectOverlap(p.x, p.y, pw, ph, tile.x, tile.y, tile.w, tile.h)) reachGoal();
    }
  });

  // Spike collisions (feet)
  currentLevel.spikes.forEach(sp => {
    if (rectOverlap(p.x, p.y + ph - 6, pw - 2, 6, sp.x, sp.y, sp.w, sp.h)) hurtPlayer();
  });

  // Danger zone collisions (feet)
  currentLevel.dangerZones.forEach(zone => {
    if (rectOverlap(p.x, p.y + ph - 6, pw - 2, 6, zone.x, zone.y, zone.w, zone.h)) hurtPlayer();
  });
}

/* ── 14. DEATH & RESPAWN ─────────────────────────────────────────────── */
function hurtPlayer() {
  if (state.player.dead) return;
  state.player.dead = true;
  state.player.respawnTimer = CFG.RESPAWN_DELAY;
  state.player.vx = state.player.vy = 0;

  deaths++;
  deathCountEl.textContent = deaths;
  sfxDeath();

  flashOverlay.classList.remove('flash');
  void flashOverlay.offsetWidth;
  flashOverlay.classList.add('flash');

  gameViewport.classList.remove('shake');
  void gameViewport.offsetWidth;
  gameViewport.classList.add('shake');
  setTimeout(() => gameViewport.classList.remove('shake'), 300);

  resetTraps();
}

function respawn() {
  const p = state.player;
  p.dead = false;
  p.x = currentLevel.spawnX; p.y = currentLevel.spawnY;
  p.vx = p.vy = 0;
  p.onGround = false;
  p.coyote = p.jumpBuf = p.stillTimer = 0;
  state.hasJumped = false;
}

function resetTraps() {
  currentLevel.tiles.forEach(tile => {
    if (tile.type === 'crumble') {
      tile.state = 'idle'; tile.timer = 0;
      if (tile.reveal) tile.visible = false;
    }
    if (tile.type === 'fake') {
      tile._touched = false;
      const el = domTiles[tile.id];
      if (el) el.classList.remove('dissolving');
    }
    if (tile.type === 'false-safe') {
      tile.timer = 0; tile.dangerous = false;
      tile.dangerTimer = 0; tile._warming = false;
    }
    if (tile.type === 'trigger') { tile.active = false; tile._near = false; }
    // reveal tiles keep state once found (fairness)
  });
}

/* ── 15. GOAL / LEVEL COMPLETE ───────────────────────────────────────── */
let goalReached = false;

let _toastTimer = null;
function showSaveToast() {
  const toast = document.getElementById('save-toast');
  clearTimeout(_toastTimer);
  toast.classList.add('show');
  _toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

function reachGoal() {
  if (goalReached) return;
  goalReached = true;
  sfxGoal();
  saveProgress();
  showSaveToast();

  setTimeout(() => {
    cancelAnimationFrame(state.rafId);
    if (currentLevelIndex + 1 < LEVELS.length) {
      currentLevelIndex++;
      loadLevel(currentLevelIndex);
    } else {
      // End of current phase
      if (gamePhase === 1) {
        showFakeEnding();
      } else if (gamePhase === 2) {
        showWakeTransition(() => startPhase3());
      } else {
        showTrueEnding();
      }
    }
  }, 700);
}

/* ── 16. GAME LOOP ───────────────────────────────────────────────────── */
function gameLoop() {
  state.rafId = requestAnimationFrame(gameLoop);
  updatePlayer();
  updateCamera();
  renderFrame();
}

/* ── 17. LEVEL LOADING ───────────────────────────────────────────────── */
function loadLevel(index) {
  goalReached  = false;
  _jumpWasDown = false;

  currentLevel = LEVELS[index]();
  applyPhaseModifiers(currentLevel, gamePhase);

  saveProgress();

  resizeViewport();
  buildDOM();

  const offsetX = gamePhase === 2 ? 0.62 : CFG.CAM_OFFSET_X;
  const offsetY = currentLevel.initialCamOffsetY ?? CFG.CAM_OFFSET_Y;
  state.player = initPlayer();
  state.hasJumped = false;
  camX = currentLevel.spawnX - vpW * offsetX;
  camY = currentLevel.spawnY - vpH * offsetY;
  camX = Math.max(0, Math.min(camX, currentLevel.worldW - vpW));
  camY = Math.max(0, Math.min(camY, currentLevel.worldH - vpH));

  let displayName;
  if (gamePhase === 2) {
    displayName = DREAM_NAMES_2[index] || '. . .';
  } else if (gamePhase === 3) {
    displayName = DREAM_NAMES_3[index] || '. . .';
  } else {
    displayName = currentLevel.name;
  }
  levelTitleEl.textContent = displayName;
  levelTitleEl.classList.add('visible');
  setTimeout(() => levelTitleEl.classList.remove('visible'), 2200);

  gameLoop();
}

function startGame() {
  clearProgress();
  deaths = 0;
  currentLevelIndex = 0;
  gamePhase = 1;
  deathCountEl.textContent = 0;
  document.body.classList.remove('phase-2', 'phase-3');
  gameViewport.classList.remove('dream-1', 'dream-2');
  loadLevel(0);
}

/* ── 18. PHASE TRANSITION FUNCTIONS ─────────────────────────────────── */
function showFakeEnding() {
  const screen = document.getElementById('fake-end-screen');
  screen.classList.remove('hidden');
  // Slight delay so the opacity transition fires
  requestAnimationFrame(() => requestAnimationFrame(() => {
    screen.classList.add('visible');
  }));
  // Calm completion tones
  try {
    const ctx = getAudioCtx();
    const t   = ctx.currentTime;
    playTone(330, 'sine', 2.0, 0.35, t);
    playTone(440, 'sine', 2.5, 0.25, t + 0.6);
    playTone(330, 'sine', 3.0, 0.18, t + 1.6);
  } catch (_) {}
  // Reveal continue button after a calm pause
  setTimeout(() => {
    document.getElementById('fake-continue-btn').classList.add('ready');
  }, 3600);
}

function startPhase2() {
  const screen = document.getElementById('fake-end-screen');
  screen.classList.add('glitching');
  setTimeout(() => {
    screen.classList.add('hidden');
    screen.classList.remove('visible', 'glitching');
    gamePhase = 2;
    deaths = 0;
    currentLevelIndex = 0;
    deathCountEl.textContent = 0;
    document.body.classList.add('phase-2');
    gameViewport.classList.add('dream-1');
    loadLevel(0);
  }, 1150);
}

function showWakeTransition(callback) {
  const screen = document.getElementById('wake-screen');
  screen.classList.remove('hidden');
  screen.classList.add('wake-flash');
  // Short, sharp high-pitched tones — like jolting awake
  try {
    const ctx = getAudioCtx();
    const t   = ctx.currentTime;
    playTone(1760, 'sine', 0.12, 0.55, t);
    playTone(880,  'sine', 0.25, 0.38, t + 0.09);
    playTone(440,  'sine', 0.42, 0.22, t + 0.20);
  } catch (_) {}
  setTimeout(() => {
    screen.classList.remove('wake-flash');
    screen.classList.add('wake-fade');
    setTimeout(() => {
      screen.classList.add('hidden');
      screen.classList.remove('wake-fade');
      callback();
    }, 720);
  }, 320);
}

function startPhase3() {
  gamePhase = 3;
  deaths = 0;
  currentLevelIndex = 0;
  deathCountEl.textContent = 0;
  document.body.classList.remove('phase-2');
  document.body.classList.add('phase-3');
  gameViewport.classList.remove('dream-1');
  gameViewport.classList.add('dream-2');
  loadLevel(0);
}

function showTrueEnding() {
  // Quiet, sparse tones — a breath, not a fanfare
  try {
    const ctx = getAudioCtx();
    const t   = ctx.currentTime;
    playTone(220, 'sine', 3.0, 0.28, t);
    playTone(330, 'sine', 3.5, 0.18, t + 0.4);
    playTone(165, 'sine', 4.2, 0.12, t + 1.0);
  } catch (_) {}
  document.getElementById('true-end-deaths').textContent = `${deaths} falls`;
  document.getElementById('true-end-screen').classList.remove('hidden');
}

/* ── 18b. INTRO STORY ANIMATION ──────────────────────────────────────── */
function showIntroAnimation(callback) {
  const intro  = document.getElementById('intro-screen');
  const textEl = document.getElementById('intro-text');
  intro.classList.remove('hidden');

  let cancelled = false;

  // Delay adding the click listener so that a ghost tap (mobile) or the
  // original click event cannot immediately cancel the animation.
  let clickListenerAdded = false;
  const clickDelayTimer = setTimeout(() => {
    clickListenerAdded = true;
    intro.addEventListener('click', onSkip);
  }, 300);

  function finish() {
    if (cancelled) return;
    cancelled = true;
    clearTimeout(clickDelayTimer);
    document.removeEventListener('keydown', onSkip);
    if (clickListenerAdded) intro.removeEventListener('click', onSkip);
    intro.style.transition = 'opacity 0.45s ease';
    intro.style.opacity    = '0';
    setTimeout(() => {
      intro.classList.add('hidden');
      intro.style.transition = '';
      intro.style.opacity    = '';
      intro.style.background = '';
      textEl.innerHTML = '';
      callback();
    }, 460);
  }

  // Ignore key-repeat events (holding Enter/Space to activate START would
  // otherwise fire repeated keydown events that skip the animation).
  // Click events never have e.repeat, so they always pass through.
  function onSkip(e) { if (e && e.repeat) return; finish(); }
  document.addEventListener('keydown', onSkip);

  // Scenes: each slide in the story arc
  // phase  0 = neutral, 1 = reality, 2 = dream, 3 = final
  const scenes = [
    {
      lines:    ['you walk blind.'],
      duration: 1250,
      bg:       '#0a0a0f',
      color:    '#c0b898',
    },
    {
      lines:    ['you fall.', 'you learn.'],
      duration: 1250,
      bg:       '#0a0a0f',
      color:    '#7a7060',
    },
    {
      // Mirrors the fake-end-screen (level 30 milestone)
      lines:     ['— path cleared —', 'you found the way through.'],
      duration:  1500,
      bg:        '#0a0a0f',
      color:     '#c8b870',
      onEnter() {
        try {
          const ctx = getAudioCtx();
          const t   = ctx.currentTime;
          playTone(330, 'sine', 2.0, 0.30, t);
          playTone(440, 'sine', 2.5, 0.20, t + 0.5);
        } catch (_) {}
      },
    },
    {
      // Wake-transition flash (level 60 milestone)
      lines:    [],
      duration: 340,
      bg:       '#ffffff',
      color:    '#ffffff',
      onEnter() {
        try {
          const ctx = getAudioCtx();
          const t   = ctx.currentTime;
          playTone(1760, 'sine', 0.12, 0.45, t);
          playTone(880,  'sine', 0.22, 0.30, t + 0.08);
        } catch (_) {}
      },
    },
    {
      // Phase-2 dream continuation hint
      lines:    ['but the path', 'continues in darkness.'],
      duration: 1250,
      bg:       '#04060e',
      color:    '#405888',
      italic:   true,
    },
    {
      // True ending (echoes showTrueEnding)
      lines:    ['every path leads somewhere.', 'even the ones that hurt.'],
      duration: 1600,
      bg:       '#060404',
      color:    '#6a6060',
      onEnter() {
        try {
          const ctx = getAudioCtx();
          const t   = ctx.currentTime;
          playTone(220, 'sine', 2.8, 0.22, t);
          playTone(330, 'sine', 3.2, 0.14, t + 0.35);
        } catch (_) {}
      },
    },
  ];

  let sceneIdx = 0;

  function runScene() {
    if (cancelled) return;
    if (sceneIdx >= scenes.length) { finish(); return; }

    const scene = scenes[sceneIdx++];
    intro.style.background = scene.bg || '#0a0a0f';

    textEl.innerHTML = '';

    const lineEls = scene.lines.map(line => {
      const el        = document.createElement('span');
      el.className    = 'intro-line';
      if (scene.italic) el.classList.add('italic');
      el.textContent  = line;
      el.style.color  = scene.color || '#d0c8b0';
      textEl.appendChild(el);
      return el;
    });

    if (scene.onEnter) scene.onEnter();

    // Fade in — force a reflow so the browser computes the initial opacity:0
    // state before adding .visible, ensuring the CSS transition fires.
    requestAnimationFrame(() => {
      lineEls.forEach(el => void el.offsetWidth);
      lineEls.forEach(el => el.classList.add('visible'));
    });

    // Hold → fade out → next scene
    setTimeout(() => {
      if (cancelled) return;
      lineEls.forEach(el => {
        el.classList.remove('visible');
        el.classList.add('fading');
      });
      setTimeout(() => {
        if (cancelled) return;
        runScene();
      }, 480);
    }, scene.duration);
  }

  runScene();
}

/* ── 19. UI EVENTS ───────────────────────────────────────────────────── */
document.getElementById('start-btn').addEventListener('click', () => {
  try { getAudioCtx(); } catch (_) {}
  const saved = loadProgress();
  if (saved && (saved.phase > 1 || saved.levelIndex > 0)) {
    const modal = document.getElementById('reset-confirm-modal');
    modal.classList.remove('hidden');
    return;
  }
  initiateGameStart();
});

function initiateGameStart() {
  titleScreen.classList.add('hidden');
  showIntroAnimation(() => {
    gameWrapper.classList.remove('hidden');
    startGame();
  });
}

document.getElementById('reset-confirm-yes').addEventListener('click', () => {
  document.getElementById('reset-confirm-modal').classList.add('hidden');
  initiateGameStart();
});

document.getElementById('reset-confirm-no').addEventListener('click', () => {
  document.getElementById('reset-confirm-modal').classList.add('hidden');
});

continueBtn.addEventListener('click', () => {
  try { getAudioCtx(); } catch (_) {}
  const saved = loadProgress();
  if (!saved) { startGame(); return; }
  gamePhase        = saved.phase;
  currentLevelIndex = saved.levelIndex;
  deaths           = saved.deaths;
  deathCountEl.textContent = deaths;
  document.body.classList.remove('phase-2', 'phase-3');
  gameViewport.classList.remove('dream-1', 'dream-2');
  if (gamePhase === 2) {
    document.body.classList.add('phase-2');
    gameViewport.classList.add('dream-1');
  } else if (gamePhase === 3) {
    document.body.classList.add('phase-3');
    gameViewport.classList.add('dream-2');
  }
  titleScreen.classList.add('hidden');
  gameWrapper.classList.remove('hidden');
  loadLevel(currentLevelIndex);
});

document.getElementById('restart-btn').addEventListener('click', () => {
  endScreen.classList.add('hidden');
  startGame();
});

document.getElementById('fake-continue-btn').addEventListener('click', () => {
  startPhase2();
});

document.getElementById('true-restart-btn').addEventListener('click', () => {
  document.getElementById('true-end-screen').classList.add('hidden');
  startGame();
});

/* Show CONTINUE button on title screen if saved progress exists */
(function initTitleScreen() {
  const saved = loadProgress();
  if (saved && (saved.phase > 1 || saved.levelIndex > 0)) {
    continueBtn.classList.remove('hidden');
  }
}());
