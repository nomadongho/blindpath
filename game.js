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
  CRUMBLE_WARN_FAST: 55,        // faster crumble warn for harder levels (L10)
  REVEAL_CRUMBLE_WARN: 22,      // warn frames for reveal-crumble tiles (L15, L28)
  FAKE_DELAY:      4,
  REVEAL_STILL:    60,
  FALSE_SAFE_TTL:  240,  // frames standing on false-safe tile before it turns lethal
  FALSE_SAFE_WARN: 120,  // frames before warming hint appears (halfway point)
  FALSE_SAFE_GRACE: 30,
  FALSE_SAFE_FAST_TTL:  100,    // compressed timer for L25
  FALSE_SAFE_FAST_WARN:  50,    // warn for compressed timer
  PHASE2_CRUMBLE_FREQ:    4,    // every Nth solid tile crumbles in Phase 2
  PHASE2_CRUMBLE_WARN:   70,    // warn frames for Phase-2 induced crumble
  PHASE3_TRAP_FREQ:       3,    // every Nth solid tile becomes a trap in Phase 3
  PHASE3_FALSE_SAFE_TTL:  60,   // false-safe TTL compression in Phase 3
  PHASE3_FALSE_SAFE_WARN: 30,   // false-safe warn compression in Phase 3
  GHOST_RADIUS:    96,
  PATIENCE_FRAMES: 90,   // frames player must stand still before a patience trigger activates
  RESPAWN_DELAY:   22,
  MASTER_VOL:      0.18,
};

/* ── 1b. VOLUME PERSISTENCE ──────────────────────────────────────────── */
const VOL_KEY = 'blindpath_vol';
(function initVolume() {
  try {
    const stored = localStorage.getItem(VOL_KEY);
    if (stored !== null) CFG.MASTER_VOL = Math.max(0, Math.min(1, parseFloat(stored)));
  } catch (_) {}
}());

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

  /* compound tile helpers (shared across multiple levels) */
  const RC = (x,y) => tiles.push({type:'crumble',x,y,w:T,h:H,
    id:tiles.length,state:'idle',timer:0,reveal:true,visible:false,warnFrames:CFG.REVEAL_CRUMBLE_WARN});
  const fc = (x,y) => tiles.push({type:'crumble',x,y,w:T,h:H,
    id:tiles.length,state:'idle',timer:0,warnFrames:CFG.CRUMBLE_WARN_FAST});
  const ic = (x,y) => tiles.push({type:'crumble',x,y,w:T,h:H,
    id:tiles.length,state:'idle',timer:0,instantCrumble:true});
  const FS = (x,y,w,h,fast) => {
    const t = {type:'false-safe',x,y,w:w||T,h:h||H,id:tiles.length,
               timer:0,dangerous:false,dangerTimer:0,_warming:false};
    if(fast){ t.fastTTL = CFG.FALSE_SAFE_FAST_TTL; t.fastWarn = CFG.FALSE_SAFE_FAST_WARN; }
    tiles.push(t);
  };

  return { tiles,spikes,triggers,gravityZones,dangerZones,
           S,F,I,C,R,Z,TR,TP,SL,G,spike,trig,grav,dzone,RC,fc,ic,FS };
}

/* ═══════════════════════════════════════════════════════════════════════
   PHASE 1 — INTRODUCTION (Levels 1–5)
   One mechanic per level — but every level has a sting.
   ═══════════════════════════════════════════════════════════════════════ */

// ── Level 1 "One Step" — long safe corridor; one fake tile right before the goal.
function buildLevel1() {
  const {S,F,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 540, 16);
  F(580, 400);
  S(620, 400, 120, 16);
  G(698, 372, 32, 28);
  spike(580, 410, 2);
  return {name:'01 · One Step', worldW:840, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 2 "The Gap" — spike pit to jump; the safe landing zone is crumble. Keep moving.
function buildLevel2() {
  const {S,C,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 120, 16);
  spike(160, 410, 9);
  C(304,400); C(336,400); C(368,400); C(400,400); C(432,400); C(464,400);
  S(496, 400, 200, 16);
  G(654, 372, 32, 28);
  return {name:'02 · The Gap', worldW:760, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 3 "First Lie" — irregular fake/solid pattern across two separate sections.
function buildLevel3() {
  const {S,F,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 100, 16);
  F(182,400); F(214,400); S(246,400); F(278,400); S(310,400); F(342,400); S(374,400);
  S(406, 400, 60, 16);
  F(522,400); S(554,400); F(586,400); F(618,400); S(650,400); F(682,400); S(714,400);
  S(746, 400, 120, 16);
  G(824, 372, 32, 28);
  spike(140, 410, 17);
  spike(478, 410, 16);
  return {name:'03 · First Lie', worldW:940, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 4 "Safe Color" — light=crumble; a 3-tile cluster mid-level demands a sprint.
function buildLevel4() {
  const {S,C,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 80, 16);
  S(160,400); C(212,400,32,16,true); C(244,400,32,16,true); S(296,400);
  C(348,400,32,16,true); S(400,400); C(452,400,32,16,true); S(504,400);
  S(556, 400, 40, 16);
  C(648,400,32,16,true); C(680,400,32,16,true); C(712,400,32,16,true);
  S(764,400); C(816,400,32,16,true); S(868,400);
  S(920, 400, 100, 16);
  G(978, 372, 32, 28);
  spike(140, 410, 29);
  spike(598, 410, 20);
  return {name:'04 · Safe Color', worldW:1080, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 5 "Double Cross" — entire first bridge is fake; second bridge hides one real tile.
function buildLevel5() {
  const {S,F,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 140, 16);
  F(180,400); F(212,400); F(244,400); F(276,400); F(308,400);
  S(352, 400, 60, 16);
  F(468,400); F(500,400); S(532,400); F(564,400); F(596,400); F(628,400);
  S(672, 400, 120, 16);
  G(750, 372, 32, 28);
  spike(178, 410, 11);
  spike(466, 410, 13);
  return {name:'05 · Double Cross', worldW:880, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

/* ═══════════════════════════════════════════════════════════════════════
   PHASE 2 — DISCOVERY (Levels 6–10)
   Larger maps. Two sections each. Earned surprises.
   ═══════════════════════════════════════════════════════════════════════ */

// ── Level 6 "Empty Air" — invisible platforms; irregular spacing across two sections.
function buildLevel6() {
  const {S,I,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 100, 16);
  spike(140, 410, 7);
  I(252, 400); I(392, 400); I(492, 400);
  spike(284, 410, 7); spike(424, 410, 4); spike(524, 410, 4);
  S(576, 400, 60, 16);
  spike(636, 410, 3);
  I(684, 400); I(780, 400); I(908, 400);
  spike(716, 410, 4); spike(812, 410, 6); spike(940, 410, 4);
  S(992, 400, 120, 16);
  G(1070, 372, 32, 28);
  return {name:'06 · Empty Air', worldW:1200, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 7 "Patient Ground" — ascending crumble staircase; flat 6-tile sprint at top; descend.
function buildLevel7() {
  const {S,C,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 80, 16);
  C(160,380); C(200,360); C(240,340); C(280,320);
  S(320, 320, 40, 16);
  C(400,320); C(440,320); C(480,320); C(520,320); C(560,320); C(600,320);
  S(640, 320, 40, 16);
  C(720,340); C(760,360); C(800,380); C(840,400); C(880,400);
  S(920, 400, 120, 16);
  G(998, 372, 32, 28);
  spike(120, 420, 51);
  return {name:'07 · Patient Ground', worldW:1120, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 8 "Friendly Fire" — wide open platform; seven invisible danger zones to jump.
function buildLevel8() {
  const {S,G,dzone,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 80, 16);
  spike(120, 410, 4);
  S(184, 400, 600, 16);
  spike(784, 410, 2);
  S(820, 400, 100, 16);
  G(878, 372, 32, 28);
  dzone(194, 368, 52, 40);
  dzone(298, 368, 40, 40);
  dzone(382, 368, 58, 40);
  dzone(490, 368, 44, 40);
  dzone(580, 368, 54, 40);
  dzone(678, 368, 44, 40);
  dzone(752, 368, 36, 40);
  return {name:'08 · Friendly Fire', worldW:980, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 9 "The False Bottom" — vertical shaft; fake at 380; invisible real floor at 530; side exit.
function buildLevel9() {
  const {S,F,I,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 100, 200, 16);
  S(40, 116, 16, 960);
  S(208, 116, 16, 380);
  S(208, 570, 16, 506);
  F(56, 380, 152, 16);
  I(56, 530, 152, 16);
  S(224, 530, 220, 16);
  G(504, 502, 32, 28);
  F(56, 760, 152, 16);
  spike(56, 1000, 9);
  return {name:'09 · The False Bottom', worldW:680, worldH:1076, spawnX:80, spawnY:78,
          initialCamOffsetY: 0.9,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 10 "Unstable Trust" — fast crumble everywhere; only four true solids hidden among many.
function buildLevel10() {
  const {S,G,fc,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 80, 16);
  fc(160,400); fc(210,400); fc(262,400);
  S(314,400);
  fc(366,400); fc(418,400); fc(470,400); fc(522,400);
  S(574,400);
  fc(626,400); fc(678,400);
  S(730,400);
  fc(782,400); fc(834,400); fc(886,400);
  S(938, 400, 120, 16);
  G(1016, 372, 32, 28);
  spike(140, 410, 50);
  return {name:'10 · Unstable Trust', worldW:1140, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

/* ═══════════════════════════════════════════════════════════════════════
   PHASE 3 — REINFORCEMENT (Levels 11–15)
   Two mechanics per level. False rest areas. Forced memorisation.
   ═══════════════════════════════════════════════════════════════════════ */

// ── Level 11 "The Trigger" — patience zone opens crumble bridge; sprint immediately after.
function buildLevel11() {
  const {S,C,TR,G,trig,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 160, 16);
  trig('B1', 110, 332, 80, 88, CFG.PATIENCE_FRAMES);
  spike(200, 410, 2);
  TR(240,400,32,16,'B1');
  C(272,400); C(304,400); C(336,400); C(368,400); C(400,400); C(432,400);
  S(464, 400, 80, 16);
  trig('B2', 494, 340, 80, 80, CFG.PATIENCE_FRAMES);
  spike(544, 410, 2);
  TR(640,400,32,16,'B2');
  C(672,400); C(704,400); C(736,400); C(768,400); C(800,400);
  S(832, 400, 120, 16);
  G(910, 372, 32, 28);
  spike(238, 410, 14);
  spike(638, 410, 11);
  return {name:'11 · The Trigger', worldW:1040, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 12 "Still Waters" — reveal-crumble tiles; three sections, each longer than last.
function buildLevel12() {
  const {S,RC,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 80, 16);
  RC(170,400); RC(210,400); RC(250,400); RC(290,400); RC(330,400);
  S(370, 400, 80, 16);
  RC(530,400); RC(570,400); RC(610,400); RC(650,400);
  S(690, 400, 60, 16);
  RC(830,400); RC(870,400); RC(910,400); RC(950,400); RC(990,400); RC(1030,400);
  S(1070, 400, 120, 16);
  G(1148, 372, 32, 28);
  spike(120, 410, 16);
  spike(450, 410, 15);
  spike(750, 410, 19);
  return {name:'12 · Still Waters', worldW:1280, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 13 "Cascade" — trigger chain; false dead-end fork ahead of second trigger.
function buildLevel13() {
  const {S,C,F,TR,G,trig,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 120, 16);
  trig('PA', 100, 330, 70, 90);
  spike(160, 410, 4);
  TR(220,400,32,16,'PA');
  C(252,400); C(292,400); C(332,400); C(372,400); C(412,400);
  S(452, 400, 60, 16);
  F(572,400);
  trig('PB', 462, 330, 70, 90);
  spike(512, 410, 4);
  TR(608,400,32,16,'PB');
  C(640,400); C(680,400); C(720,400); C(760,400); C(800,400);
  S(840, 400, 160, 16);
  G(958, 372, 32, 28);
  spike(216, 410, 14);
  spike(604, 410, 13);
  return {name:'13 · Cascade', worldW:1080, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 14 "Memory Pit" — dense fake grid; far more fakes than solids; three sections to map.
function buildLevel14() {
  const {S,F,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 100, 16);
  F(182,400); F(214,400); F(246,400); S(278,400); F(310,400); F(342,400);
  S(374, 400, 60, 16);
  F(490,400); F(522,400); S(554,400); F(586,400); F(618,400); F(650,400); S(682,400);
  S(714, 400, 60, 16);
  F(836,400); S(868,400); F(900,400); F(932,400); S(964,400); F(996,400);
  S(1028, 400, 120, 16);
  G(1106, 372, 32, 28);
  spike(140, 410, 16);
  spike(434, 410, 18);
  spike(774, 410, 16);
  return {name:'14 · Memory Pit', worldW:1240, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 15 "The Patience Tax" — false-safe rest in the middle; reveal-crumble either side.
function buildLevel15() {
  const {S,RC,FS,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 80, 16);
  RC(170,400); RC(210,400); RC(250,400); RC(290,400); RC(330,400);
  FS(380, 400, 96, 16);
  RC(496,400); RC(536,400); RC(576,400); RC(616,400); RC(656,400); RC(696,400);
  S(736, 400, 120, 16);
  G(814, 372, 32, 28);
  spike(120, 410, 16);
  spike(476, 410, 16);
  return {name:'15 · The Patience Tax', worldW:960, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

/* ═══════════════════════════════════════════════════════════════════════
   PHASE 4 — SUBVERSION (Levels 16–20)
   Rules inverted. Every learned habit punished.
   ═══════════════════════════════════════════════════════════════════════ */

// ── Level 16 "The Betrayal" — entire visible bridge is fake; invisible stepping stone mid-span.
function buildLevel16() {
  const {S,F,I,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 180, 16);
  F(220,400); F(252,400); F(284,400); F(316,400); F(348,400);
  F(380,400); F(412,400); F(444,400);
  I(476,400);
  F(508,400); F(540,400); F(572,400);
  S(608, 400, 200, 16);
  G(766, 372, 32, 28);
  spike(218, 410, 18);
  return {name:'16 · The Betrayal', worldW:880, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 17 "Dark Side" — light=safe, dark=trap; long gauntlet with clustered traps.
function buildLevel17() {
  const {S,SL,TP,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 80, 16);
  TP(160,400); TP(192,400); SL(244,400); TP(296,400); TP(328,400);
  SL(380,400); TP(432,400); SL(484,400); TP(536,400); TP(568,400);
  SL(620,400); TP(672,400); TP(704,400); SL(756,400); TP(808,400);
  SL(860,400); SL(892,400); TP(944,400); SL(996,400);
  S(1048, 400, 120, 16);
  G(1126, 372, 32, 28);
  spike(140, 410, 59);
  return {name:'17 · Dark Side', worldW:1260, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 18 "Gravity Drift" — gravity doubles halfway; ascending then descending path.
function buildLevel18() {
  const {S,G,grav,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 120, 16);
  S(200,380); S(260,360); S(320,340); S(380,320);
  grav(420, 0, 620, 480, 2.0, 0.65);
  S(420,320); S(470,320); S(520,320); S(570,320); S(620,300); S(670,300);
  S(720,320); S(770,340); S(820,360); S(870,380); S(920,400,200,16);
  G(1078,372,32,28);
  spike(160, 420, 2);
  spike(196, 420, 14);
  spike(418, 420, 31);
  return {name:'18 · Gravity Drift', worldW:1180, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 19 "Safe No More" — three identical glow zones; two deadly, middle one real trigger.
function buildLevel19() {
  const {S,TR,G,trig,dzone,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 140, 16);
  dzone(200, 375, 52, 40, true);
  S(300, 400, 60, 16);
  trig('K1', 310, 358, 52, 62, 0, true);
  TR(430,400,32,16,'K1'); TR(462,400,32,16,'K1'); TR(494,400,32,16,'K1');
  S(530, 400, 80, 16);
  dzone(660, 375, 52, 40, true);
  S(730, 400, 200, 16);
  G(888, 372, 32, 28);
  spike(180, 410, 3);
  spike(390, 410, 2);
  spike(612, 410, 3);
  return {name:'19 · Safe No More', worldW:960, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 20 "Double Fake" — fake+invisible combo; second section has a fake with no invisible below.
function buildLevel20() {
  const {S,F,I,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 140, 16);
  F(220,400); F(260,400); F(300,400); F(340,400);
  I(220,424); I(260,424); I(300,424); I(340,424);
  S(380,424,40,16);
  S(420,408,80,16);
  F(560,400); F(600,400); F(640,400);
  I(600,424);
  S(680,424,40,16);
  S(740,400,160,16);
  G(858,372,32,28);
  spike(180,456,2);
  spike(216,456,10);
  spike(520,456,2);
  spike(556,456,2);
  spike(644,456,2);
  return {name:'20 · Double Fake', worldW:980, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

/* ═══════════════════════════════════════════════════════════════════════
   PHASE 5 — MASTERY (Levels 21–30)
   Everything combined. Long maps. Unforgiving.
   ═══════════════════════════════════════════════════════════════════════ */

// ── Level 21 "Chain Reaction" — patience trigger → crumble sprint → heavy-gravity descent.
function buildLevel21() {
  const {S,C,TR,G,trig,grav,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 100, 16);
  trig('Q1', 80, 340, 80, 80, CFG.PATIENCE_FRAMES);
  spike(140, 410, 2);
  TR(180,400,32,16,'Q1'); TR(212,400,32,16,'Q1');
  C(244,400); C(276,400); C(308,400); C(340,400); C(372,400);
  S(404,400,40,16);
  C(484,400); C(516,400); C(548,400); C(580,400);
  S(612,400,40,16);
  grav(700,0,500,480,1.8,0.68);
  S(700,400); S(740,380); S(780,360); S(820,360);
  C(860,360); C(900,360); C(940,360);
  S(980,360,160,16);
  G(1098,332,32,28);
  spike(178,410,2);
  spike(212,410,12);
  spike(444,410,5);
  spike(700,420,20);
  return {name:'21 · Chain Reaction', worldW:1200, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 22 "The Hesitation Path" — patience bridge each time; fake tile waits right after.
function buildLevel22() {
  const {S,F,TR,G,trig,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 80, 16);
  trig('H1', 50, 358, 70, 62, CFG.PATIENCE_FRAMES);
  spike(120, 410, 4);
  TR(200,400,32,16,'H1');
  F(240,400);
  S(280,400,60,16);
  trig('H2', 298, 358, 60, 62, CFG.PATIENCE_FRAMES);
  spike(340, 410, 4);
  TR(428,400,32,16,'H2');
  F(466,400); F(498,400);
  S(538,400,60,16);
  trig('H3', 556, 358, 60, 62, CFG.PATIENCE_FRAMES);
  spike(598, 410, 4);
  TR(680,400,32,16,'H3');
  F(716,400);
  S(754,400,60,16);
  trig('H4', 772, 358, 60, 62, CFG.PATIENCE_FRAMES);
  spike(814, 410, 4);
  TR(892,400,32,16,'H4');
  S(932,400,120,16);
  G(1010,372,32,28);
  spike(196,410,2);
  spike(236,410,2);
  spike(424,410,2);
  spike(462,410,4);
  spike(676,410,2);
  spike(712,410,2);
  spike(888,410,2);
  return {name:'22 · The Hesitation Path', worldW:1140, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 23 "False Memory" — invisible platforms; asymmetric wide gaps; second section surprising.
function buildLevel23() {
  const {S,I,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 80, 16);
  spike(120, 410, 7);
  I(232, 400);
  spike(264, 410, 4);
  I(332, 400);
  spike(364, 410, 5);
  I(444, 400);
  S(524, 400, 80, 16);
  spike(604, 410, 5);
  I(684, 400);
  spike(716, 410, 8);
  I(844, 400);
  I(924, 400);
  spike(956, 410, 4);
  S(988, 400, 160, 16);
  G(1106,372,32,28);
  return {name:'23 · False Memory', worldW:1260, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 24 "The Mirror" — left half dark=safe/light=crumble; right half inverted.
function buildLevel24() {
  const {S,C,SL,TP,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 80, 16);
  S(160,400); C(212,400,32,16,true); S(264,400);
  C(316,400,32,16,true); S(368,400); C(420,400,32,16,true);
  S(472,400,40,16);
  S(520,400,40,16);
  SL(620,400); TP(672,400); TP(704,400); SL(756,400);
  TP(808,400); SL(860,400); TP(912,400); TP(944,400); SL(996,400);
  S(1048, 400, 120, 16);
  G(1126, 372, 32, 28);
  spike(140, 410, 1);
  spike(160, 410, 20);
  spike(512, 410, 2);
  spike(578, 410, 30);
  return {name:'24 · The Mirror', worldW:1260, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 25 "Slow Burn" — crumble approach; wide false-safe trap; crumble exit.
function buildLevel25() {
  const {S,C,FS,G,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 80, 16);
  spike(120, 410, 3);
  C(168,400); C(200,400);
  FS(232, 400, 320, 16, true);
  C(552,400); C(584,400);
  spike(616, 410, 2);
  S(648, 400, 160, 16);
  G(766, 372, 32, 28);
  return {name:'25 · Slow Burn', worldW:940, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 26 "Trigger Happy" — three glow zones; outer two deadly, middle one real trigger.
function buildLevel26() {
  const {S,TR,G,trig,dzone,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 120, 16);
  dzone(200, 377, 52, 38, true);
  S(300, 400, 80, 16);
  trig('K1', 330, 358, 52, 52, 0, true);
  TR(450,400,32,16,'K1'); TR(482,400,32,16,'K1');
  TR(514,400,32,16,'K1'); TR(546,400,32,16,'K1');
  TR(578,400,32,16,'K1');
  S(618, 400, 80, 16);
  dzone(748, 377, 52, 38, true);
  S(850, 400, 160, 16);
  G(968, 372, 32, 28);
  spike(160, 410, 3);
  spike(192, 410, 7);
  spike(380, 410, 4);
  spike(698, 410, 3);
  spike(744, 410, 7);
  return {name:'26 · Trigger Happy', worldW:1080, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 27 "Ghostwalk" — light gravity; instant-crumble ascending chain; no margin to pause.
function buildLevel27() {
  const {S,ic,G,grav,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  grav(0, 0, 560, 820, 0.45, 1.25);
  S(40, 720, 200, 16);
  ic(60, 640); ic(160, 570); ic(80, 500); ic(200, 440);
  ic(80, 370); ic(220, 310); ic(80, 250); ic(200, 190);
  ic(100, 130);
  S(60, 80, 200, 16);
  G(100, 52, 32, 28);
  spike(40, 740, 12);
  return {name:'27 · Ghostwalk', worldW:560, worldH:820, spawnX:100, spawnY:698,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 28 "The Patience Gauntlet" — reveal-crumble; false-safe trap; two patience triggers.
function buildLevel28() {
  const {S,TR,RC,FS,G,trig,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();
  S(40, 400, 80, 16);
  RC(170,400); RC(210,400); RC(250,400); RC(290,400); RC(330,400);
  S(370,400,60,16);
  FS(430, 400, 96, 16);
  S(526,400,60,16);
  trig('G1', 556, 340, 70, 80, CFG.PATIENCE_FRAMES);
  spike(586, 410, 2);
  TR(660,400,32,16,'G1'); RC(692,400); RC(732,400); RC(772,400);
  TR(812,400,32,16,'G1');
  S(852,400,60,16);
  trig('G2', 880, 340, 70, 80, CFG.PATIENCE_FRAMES);
  spike(912, 410, 2);
  RC(1000,400); RC(1040,400); RC(1080,400); RC(1120,400); RC(1160,400);
  S(1200,400,120,16);
  G(1278,372,32,28);
  spike(120,410,33);
  spike(656,410,11);
  spike(996,410,13);
  return {name:'28 · The Patience Gauntlet', worldW:1400, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 29 "Everything You Know" — five sections echoing every Phase 4 subversion, harder.
function buildLevel29() {
  const {S,F,I,C,SL,TP,TR,RC,fc,ic,FS,G,trig,grav,dzone,spike,
         tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();

  // §1 — fake bridge with hidden invisible mid-span (L5/L16 echo)
  S(40,400,120,16);
  F(200,400); F(232,400); F(264,400); F(296,400);
  I(332,400);
  F(364,400); F(396,400);
  S(440,400,40,16);
  spike(160,410,20);

  // §2 — inverted colours then patience trigger (L17/L22 echo)
  TP(540,400); SL(572,400); TP(604,400); SL(636,400); TP(668,400);
  S(700,400,40,16);
  trig('Z1',700,340,60,80,CFG.PATIENCE_FRAMES);
  spike(480,410,13);

  // §3 — patience bridge into reveal-crumble then deadly glow (L12/L19 echo)
  TR(820,400,32,16,'Z1');
  RC(860,400); RC(900,400); RC(940,400);
  dzone(988,375,48,38,true);
  S(1052,400,60,16);
  spike(816,410,11);

  // §4 — heavy gravity + instant crumble staircase (L18/L27 echo)
  grav(1172,0,400,480,1.9,0.66);
  ic(1172,400); ic(1232,380); ic(1292,360); ic(1352,360); ic(1412,380);
  S(1452,400,80,16);
  spike(1172,420,18);

  // §5 — false-safe then fast crumble exit (L25/L10 echo)
  FS(1592, 400, 192, 16, true);
  fc(1784,400); fc(1816,400); fc(1848,400);
  S(1880,400,120,16);
  G(1958,372,32,28);
  spike(1540,410,2);
  spike(1780,410,4);

  return {name:'29 · Everything You Know', worldW:2100, worldH:480, spawnX:50, spawnY:378,
          tiles, spikes, triggers, gravityZones, dangerZones};
}

// ── Level 30 "Blindpath" — complete darkness; all mechanics echoed; pure memory and trust.
function buildLevel30() {
  const {S,F,I,RC,fc,ic,G,grav,spike,tiles,spikes,triggers,gravityZones,dangerZones} = makeLevelParts();

  S(40,400,80,16);

  // §1 — fake approach (L3 echo)
  spike(120,410,4);
  F(188,400); F(220,400); S(252,400); F(284,400);
  S(316,400,80,16);

  // §2 — invisible bridge (L6 echo)
  spike(396,410,6);
  I(492,400); I(572,400); I(652,400);
  spike(524,410,4); spike(604,410,4);
  S(684,400,60,16);

  // §3 — fast crumble sprint (L10 echo)
  spike(744,410,4);
  fc(812,400); fc(844,400); fc(876,400); fc(908,400);
  S(940,400,60,16);

  // §4 — reveal-crumble (L12 echo)
  spike(1000,410,3);
  RC(1028,400); RC(1068,400); RC(1108,400); RC(1148,400);
  S(1188,400,60,16);

  // §5 — light gravity ascent with instant crumble (L27 echo)
  spike(1248,410,3);
  grav(1300,0,400,480,0.50,1.20);
  ic(1300,380); ic(1380,360); ic(1460,340); ic(1540,360); ic(1620,380);
  S(1700,400,100,16);
  G(1760,372,32,28);
  spike(1700,410,2);

  return {name:'30 · Blindpath', worldW:1920, worldH:480, spawnX:50, spawnY:378,
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
        if (sc % CFG.PHASE2_CRUMBLE_FREQ === 0) {
          tile.type      = 'crumble';
          tile.state     = 'idle';
          tile.timer     = 0;
          tile.warnFrames = CFG.PHASE2_CRUMBLE_WARN;
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
        if (sc % CFG.PHASE3_TRAP_FREQ === 0) tile.type = 'trap';
      }
    });
    tiles.forEach(tile => {
      if (tile.type === 'false-safe') {
        tile.fastTTL  = CFG.PHASE3_FALSE_SAFE_TTL;
        tile.fastWarn = CFG.PHASE3_FALSE_SAFE_WARN;
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

/* ── 20. VOLUME SLIDER ───────────────────────────────────────────────── */
(function initVolSlider() {
  const slider  = document.getElementById('vol-slider');
  const icon    = document.getElementById('vol-icon');
  if (!slider || !icon) return;

  const DEFAULT_VOL = 0.18;

  function applyVol(v) {
    CFG.MASTER_VOL   = v;
    slider.value     = v;
    icon.textContent = v === 0 ? '♪̶' : '♪';
    try { localStorage.setItem(VOL_KEY, String(v)); } catch (_) {}
  }

  applyVol(CFG.MASTER_VOL);

  slider.addEventListener('input', () => applyVol(parseFloat(slider.value)));

  icon.addEventListener('click', () => applyVol(CFG.MASTER_VOL > 0 ? 0 : DEFAULT_VOL));
}());
