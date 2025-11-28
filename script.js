"use strict";

/* ----------------------
  Production-ready Tetris
  Features:
   - DPI-correct canvas
   - Smooth falling (fractional visual)
   - Gravity in cells/sec & adjustable
   - 7-bag next queue
   - Hold piece
   - Soft/hard drop
   - DAS + ARR (hold left/right auto repeat)
   - Lock delay (with reset on move/rotate)
   - Ghost piece
   - Score, lines, level, highscore (localStorage)
   - Performance mode that throttles render FPS
   - Sound (WebAudio) with mute toggle
   - Touch controls + buttons
-------------------------*/

/* ------------------------
   Constants & Canvas Setup
---------------------------*/
const COLS = 12;
const ROWS = 20;
const TILE = 20; // logical tile size in CSS px

const canvas = document.getElementById("tetris");
const ctx = canvas.getContext("2d");
const nextCanvas = document.getElementById("next");
const nextCtx = nextCanvas && nextCanvas.getContext("2d");
const holdCanvas = document.getElementById("hold");
const holdCtx = holdCanvas && holdCanvas.getContext("2d");

function setupCanvas() {
  const dpr = window.devicePixelRatio || 1;
  // main canvas CSS size
  canvas.style.width = `${COLS * TILE}px`;
  canvas.style.height = `${ROWS * TILE}px`;
  // backing store
  canvas.width = COLS * TILE * dpr;
  canvas.height = ROWS * TILE * dpr;
  // map 1 drawing unit to 1 tile
  ctx.setTransform(dpr * TILE, 0, 0, dpr * TILE, 0, 0);

  if (nextCanvas && nextCtx) {
    nextCanvas.style.width = `80px`;
    nextCanvas.style.height = `80px`;
    const nDpr = dpr;
    nextCanvas.width = 80 * nDpr;
    nextCanvas.height = 80 * nDpr;
    // we draw in pixels (not tiles) for preview; scale accordingly
    nextCtx.setTransform(nDpr, 0, 0, nDpr, 0, 0);
  }
  if (holdCanvas && holdCtx) {
    holdCanvas.style.width = `80px`;
    holdCanvas.style.height = `80px`;
    const hDpr = dpr;
    holdCanvas.width = 80 * hDpr;
    holdCanvas.height = 80 * hDpr;
    holdCtx.setTransform(hDpr, 0, 0, hDpr, 0, 0);
  }
}
setupCanvas();
window.addEventListener("resize", setupCanvas);

/* ------------------------
   State & Settings
---------------------------*/
let neonGlow = true;
let performanceMode = false;
let targetFPS = 60;
let minFrameTime = 1000 / targetFPS;

let gravityCPS = 1; // cells per second (default gentle)
let dropAccumulator = 0; // ms
let lastTime = 0;
let lastRender = 0;

let gameOver = false;
let paused = false;

// DAS (delayed auto shift) settings
const DAS_DELAY = 160; // ms before auto-repeat begins
const ARR = 60; // ms between auto-shifts
let dasState = { left: false, right: false, holdStart: 0, nextMoveAt: 0 };

// Lock delay
const LOCK_DELAY = 500; // ms before piece is locked once it touches ground
let lockTimer = 0;
let onGround = false;

// Soft drop multiplier
const SOFT_DROP_MULT = 20; // increases gravity when soft-dropping

// Game entities
const arena = createMatrix(COLS, ROWS);
const player = { pos: { x: 0, y: 0 }, matrix: null, id: 0 };
let nextQueue = [];
const QUEUE_SIZE = 5;
let holdPiece = null;
let holdUsed = false;

// Scoring / level
let score = 0;
let level = 0;
let lines = 0;
const scoreEl = document.getElementById("score");
const linesEl = document.getElementById("lines");
const levelEl = document.getElementById("level");
const HIGH_SCORE_KEY = "neon_tetris_highscore";
let highscore = Number(localStorage.getItem(HIGH_SCORE_KEY) || 0);

// Sound
let soundEnabled = true;
const audioCtx = (window.AudioContext || window.webkitAudioContext) ? new (window.AudioContext || window.webkitAudioContext)() : null;

/* ------------------------
   DOM & Settings UI
---------------------------*/
const settingsBtn = document.getElementById("settings-btn");
const settingsPanel = document.getElementById("settings-panel");
const perfToggle = document.getElementById("perf-toggle");
const glowToggle = document.getElementById("glow-toggle");
const fpsSlider = document.getElementById("fps-slider");
const gravitySlider = document.getElementById("gravity-slider");
const gravityValue = document.getElementById("gravity-value");
const soundToggle = document.getElementById("sound-toggle");
const closeSettings = document.getElementById("close-settings");
const pauseBtn = document.getElementById("pause-btn");
const restartBtn = document.getElementById("restart-btn");
const muteBtn = document.getElementById("mute-btn");

function onIf(el, ev, fn) { if (el) el.addEventListener(ev, fn); }

onIf(settingsBtn, "click", () => settingsPanel.classList.remove("hidden"));
onIf(closeSettings, "click", () => settingsPanel.classList.add("hidden"));

onIf(perfToggle, "change", () => {
  performanceMode = perfToggle.checked;
  if (performanceMode) {
    targetFPS = Number(fpsSlider ? fpsSlider.value : 30);
  } else {
    targetFPS = 60;
  }
  minFrameTime = 1000 / targetFPS;
  // disable glow when performance mode
  neonGlow = !performanceMode && (glowToggle ? glowToggle.checked : true);
});

onIf(fpsSlider, "input", () => {
  if (perfToggle && perfToggle.checked) {
    targetFPS = Number(fpsSlider.value);
    minFrameTime = 1000 / targetFPS;
  }
});

onIf(glowToggle, "change", () => neonGlow = glowToggle.checked && !performanceMode);
onIf(soundToggle, "change", () => soundEnabled = soundToggle.checked);

onIf(gravitySlider, "input", () => {
  gravityCPS = Number(gravitySlider.value);
  if (gravityValue) gravityValue.textContent = `${gravityCPS} cps`;
});

// mute / pause / restart
onIf(pauseBtn, "click", () => { paused = !paused; pauseBtn.textContent = paused ? "Resume" : "Pause"; });
onIf(restartBtn, "click", () => resetGame());
onIf(muteBtn, "click", () => { soundEnabled = !soundEnabled; muteBtn.textContent = soundEnabled ? "Mute" : "Unmute"; });

/* initialize UI values */
if (gravityValue) gravityValue.textContent = `${gravityCPS} cps`;
if (fpsSlider) fpsSlider.value = String(Math.max(15, Math.min(60, targetFPS)));
if (perfToggle) perfToggle.checked = performanceMode;
if (glowToggle) glowToggle.checked = neonGlow;
if (soundToggle) soundToggle.checked = soundEnabled;

/* ------------------------
   Pieces & Random (7-bag)
---------------------------*/
function createMatrix(w, h) {
  return Array.from({ length: h }, () => Array(w).fill(0));
}

function createPiece(type) {
  const shapes = {
    T: [[0,1,0],[1,1,1],[0,0,0]],
    O: [[1,1],[1,1]],
    L: [[0,0,1],[1,1,1],[0,0,0]],
    J: [[1,0,0],[1,1,1],[0,0,0]],
    I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    S: [[0,1,1],[1,1,0],[0,0,0]],
    Z: [[1,1,0],[0,1,1],[0,0,0]]
  };
  const shape = shapes[type];
  return shape ? shape.map(r => r.slice()) : null;
}

const PIECE_IDS = { I:1, O:2, T:3, S:4, Z:5, J:6, L:7 };
const PALETTE = { 1: "#0ff", 2:"#f0f", 3:"#ff0", 4:"#0f0", 5:"#09f", 6:"#f90", 7:"#f09" };

function shuffleBag() {
  const bag = "ILJOTSZ".split('');
  for (let i = bag.length - 1; i > 0; --i) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

/* populate initial queue */
function refillQueue() {
  while (nextQueue.length < QUEUE_SIZE) {
    if (!refillQueue.bag || refillQueue.index >= refillQueue.bag.length) {
      refillQueue.bag = shuffleBag();
      refillQueue.index = 0;
    }
    nextQueue.push(refillQueue.bag[refillQueue.index++]);
  }
}

/* ------------------------
   Collision, rotation, wall kicks
---------------------------*/
function collide(arena, playerX, playerY, matrix) {
  for (let y = 0; y < matrix.length; ++y) {
    for (let x = 0; x < matrix[y].length; ++x) {
      if (!matrix[y][x]) continue;
      const ax = x + playerX, ay = y + playerY;
      if (ax < 0 || ax >= COLS || ay >= ROWS) return true;
      if (ay >= 0 && arena[ay][ax]) return true;
    }
  }
  return false;
}

/* rotate matrix clockwise (dir = 1) or ccw (dir = -1) */
function rotateMatrix(matrix, dir) {
  for (let y = 0; y < matrix.length; ++y)
    for (let x = 0; x < y; ++x)
      [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
  if (dir > 0) matrix.forEach(row => row.reverse());
  else matrix.reverse();
}

/* basic wall kicks: try offsets left/right/up to avoid collision */
function rotatePlayer(dir) {
  if (!player.matrix) return;
  const old = player.matrix.map(r => r.slice());
  rotateMatrix(player.matrix, dir);
  const originalX = player.pos.x;

  const kicks = [0, 1, -1, 2, -2];
  for (let i = 0; i < kicks.length; ++i) {
    player.pos.x = originalX + kicks[i];
    if (!collide(arena, player.pos.x, Math.round(player.pos.y), player.matrix)) {
      // reset ground/lock because rotation moved piece
      lockTimer = 0;
      onGround = false;
      return;
    }
  }
  // failed to rotate: restore
  player.matrix = old;
  player.pos.x = originalX;
}

/* ------------------------
   Merge / Sweep / Score
---------------------------*/
function mergeToArena() {
  for (let y = 0; y < player.matrix.length; ++y) {
    for (let x = 0; x < player.matrix[y].length; ++x) {
      if (!player.matrix[y][x]) continue;
      const ax = x + player.pos.x, ay = y + Math.floor(player.pos.y);
      if (ay >= 0 && ay < ROWS && ax >= 0 && ax < COLS) {
        arena[ay][ax] = player.matrix[y][x];
      }
    }
  }
}

function sweep() {
  let cleared = 0;
  outer: for (let y = ROWS - 1; y >= 0; --y) {
    for (let x = 0; x < COLS; ++x) {
      if (arena[y][x] === 0) continue outer;
    }
    arena.splice(y, 1);
    arena.unshift(new Array(COLS).fill(0));
    cleared++;
    y++;
  }
  if (cleared > 0) {
    const lineScores = [0, 40, 100, 300, 1200];
    score += (lineScores[cleared] || 0) * (level + 1);
    lines += cleared;
    level = Math.floor(lines / 10);
    // speed up gravity slightly per level (optional)
    // gravityCPS = Math.min(20, gravityCPS + cleared * 0.1);
    if (scoreEl) scoreEl.textContent = String(score);
    if (linesEl) linesEl.textContent = String(lines);
    if (levelEl) levelEl.textContent = String(level);
    if (score > highscore) {
      highscore = score;
      localStorage.setItem(HIGH_SCORE_KEY, String(highscore));
    }
    playSound('line');
  }
}

/* ------------------------
   Player lifecycle
---------------------------*/
function spawnPlayer() {
  refillQueue();
  const type = nextQueue.shift();
  refillQueue();
  const matrix = createPiece(type);
  // map 1's to id for color
  const id = PIECE_IDS[type] || 1;
  for (let y = 0; y < matrix.length; ++y) for (let x = 0; x < matrix[y].length; ++x) if (matrix[y][x]) matrix[y][x] = id;
  player.matrix = matrix;
  player.id = id;
  player.pos.x = Math.floor(COLS / 2) - Math.floor(matrix[0].length / 2);
  player.pos.y = -1; // spawn slightly above
  holdUsed = false;
  // reset lock/onGround
  lockTimer = 0;
  onGround = false;
  drawNext();
  drawHold();
}

function hardDrop() {
  if (!player.matrix || gameOver || paused) return;
  let drop = 0;
  while (!collide(arena, player.pos.x, Math.floor(player.pos.y + drop + 1), player.matrix)) drop++;
  player.pos.y += drop;
  mergeToArena();
  playSound('hard');
  sweep();
  spawnPlayer();
  dropAccumulator = 0;
}

function softDropStart() { /* handled by input state toggle */ }

/* hold piece */
function holdSwap() {
  if (!player.matrix || holdUsed || gameOver || paused) return;
  playSound('hold');
  if (!holdPiece) {
    holdPiece = Object.keys(PIECE_IDS)[Object.values(PIECE_IDS).indexOf(player.id)];
    // store id-type string
    const idType = holdPiece;
    spawnPlayer();
  } else {
    // swap current piece with hold
    const curType = Object.keys(PIECE_IDS)[Object.values(PIECE_IDS).indexOf(player.id)];
    const holdType = holdPiece;
    holdPiece = curType;
    // set player to holdType
    const matrix = createPiece(holdType);
    const id = PIECE_IDS[holdType];
    for (let y = 0; y < matrix.length; ++y) for (let x = 0; x < matrix[y].length; ++x) if (matrix[y][x]) matrix[y][x] = id;
    player.matrix = matrix;
    player.id = id;
    player.pos.x = Math.floor(COLS / 2) - Math.floor(matrix[0].length / 2);
    player.pos.y = -1;
  }
  holdUsed = true;
  drawHold();
}

/* ------------------------
   Ghost piece (show where it lands)
---------------------------*/
function computeGhostY() {
  if (!player.matrix) return Math.floor(player.pos.y);
  let drop = 0;
  while (!collide(arena, player.pos.x, Math.floor(player.pos.y + drop + 1), player.matrix)) drop++;
  return Math.floor(player.pos.y + drop);
}

/* ------------------------
   Drawing optimized
---------------------------*/
function drawMatrix(matrix, offsetX, offsetY, drawGhost=false) {
  // set shadow once
  if (neonGlow) {
    ctx.shadowBlur = 16;
    ctx.shadowColor = "#0ff";
  } else {
    ctx.shadowBlur = 0;
  }

  for (let y = 0; y < matrix.length; ++y) {
    for (let x = 0; x < matrix[y].length; ++x) {
      const val = matrix[y][x];
      if (!val) continue;
      ctx.fillStyle = PALETTE[val] || "#0ff";
      ctx.fillRect(x + offsetX, y + offsetY, 1, 1);
      ctx.fillStyle = "rgba(0,0,0,0.08)";
      ctx.fillRect(x + offsetX + 0.04, y + offsetY + 0.04, 0.92, 0.92);
    }
  }

  if (drawGhost) {
    // draw shadow of ghost piece
    const ghostY = computeGhostY();
    ctx.save();
    ctx.globalAlpha = 0.35;
    for (let y = 0; y < player.matrix.length; ++y) {
      for (let x = 0; x < player.matrix[y].length; ++x) {
        if (!player.matrix[y][x]) continue;
        ctx.fillStyle = PALETTE[player.matrix[y][x]] || "#0ff";
        ctx.fillRect(x + player.pos.x, y + ghostY, 1, 1);
      }
    }
    ctx.restore();
  }
}

function drawPreviewCanvas(cctx, type) {
  if (!cctx) return;
  // clear
  const px = cctx.canvas.width;
  const py = cctx.canvas.height;
  cctx.clearRect(0,0,px,py);
  cctx.fillStyle = "#000";
  cctx.fillRect(0,0,px,py);

  if (!type) return;
  const matrix = createPiece(type);
  const id = PIECE_IDS[type];
  // scale to canvas: cell size
  const cell = px / 4;
  const offsetX = (4 - matrix[0].length) / 2;
  const offsetY = (4 - matrix.length) / 2;
  cctx.save();
  cctx.fillStyle = "#0ff";
  for (let y = 0; y < matrix.length; ++y) {
    for (let x = 0; x < matrix[y].length; ++x) {
      if (matrix[y][x]) {
        cctx.fillStyle = PALETTE[id] || "#0ff";
        cctx.fillRect((x + offsetX) * cell, (y + offsetY) * cell, cell, cell);
        cctx.fillStyle = "rgba(0,0,0,0.08)";
        cctx.fillRect((x + offsetX) * cell + 2, (y + offsetY) * cell + 2, cell - 4, cell - 4);
      }
    }
  }
  cctx.restore();
}

/* Draw full scene (uses tile coordinates scale) */
function drawScene(interpYOffset = 0) {
  // background
  ctx.fillStyle = "#000";
  ctx.fillRect(0,0,COLS,ROWS);

  // arena
  drawMatrix(arena, 0, 0, false);

  // ghost
  if (player.matrix) {
    // ghost drawn via drawMatrix's ghost path
    // but we want to draw it on top of board and below piece
    // so compute ghost separately
    const ghostY = computeGhostY();
    ctx.save();
    ctx.globalAlpha = 0.25;
    for (let y = 0; y < player.matrix.length; ++y) {
      for (let x = 0; x < player.matrix[y].length; ++x) {
        if (!player.matrix[y][x]) continue;
        ctx.fillStyle = PALETTE[player.matrix[y][x]] || "#0ff";
        ctx.fillRect(x + player.pos.x, y + ghostY, 1, 1);
      }
    }
    ctx.restore();
  }

  // player with fractional y offset (interpYOffset)
  if (player.matrix && !gameOver) {
    ctx.save();
    if (neonGlow) {
      ctx.shadowBlur = 16;
      ctx.shadowColor = "#0ff";
    } else {
      ctx.shadowBlur = 0;
    }
    for (let y = 0; y < player.matrix.length; ++y) {
      for (let x = 0; x < player.matrix[y].length; ++x) {
        if (!player.matrix[y][x]) continue;
        ctx.fillStyle = PALETTE[player.matrix[y][x]] || "#0ff";
        ctx.fillRect(x + player.pos.x, y + player.pos.y + interpYOffset, 1, 1);
        ctx.fillStyle = "rgba(0,0,0,0.08)";
        ctx.fillRect(x + player.pos.x + 0.04, y + player.pos.y + interpYOffset + 0.04, 0.92, 0.92);
      }
    }
    ctx.restore();
  }
}

/* draw next / hold */
function drawNext() {
  if (!nextCtx) return;
  drawPreviewCanvas(nextCtx, nextQueue[0]);
}
function drawHold() {
  if (!holdCtx) return;
  drawPreviewCanvas(holdCtx, holdPiece);
}

/* ------------------------
   Sound (simple beeps)
---------------------------*/
function playBeep(freq = 440, length = 0.05, type = 'sine') {
  if (!audioCtx || !soundEnabled) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.value = freq;
  o.connect(g);
  g.connect(audioCtx.destination);
  g.gain.value = 0.0001;
  const now = audioCtx.currentTime;
  g.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + length);
  o.start(now);
  o.stop(now + length + 0.02);
}
function playSound(name) {
  if (!soundEnabled) return;
  switch (name) {
    case 'line': playBeep(880, 0.08, 'sawtooth'); break;
    case 'hard': playBeep(1200, 0.04); break;
    case 'hold': playBeep(600, 0.04); break;
    default: playBeep(440, 0.02); break;
  }
}

/* ------------------------
   Input Handling (keyboard + touch) + DAS/ARR
---------------------------*/
const keyState = {};
document.addEventListener("keydown", e => {
  if (e.repeat) return;
  keyState[e.key] = true;

  switch (e.key) {
    case "ArrowLeft":
      dasStart('left'); moveOnce(-1); break;
    case "ArrowRight":
      dasStart('right'); moveOnce(1); break;
    case "ArrowDown":
      keyState.soft = true; break;
    case "ArrowUp":
      rotatePlayer(1); playSound('move'); break;
    case " ":
      e.preventDefault(); hardDrop(); break;
    case "c": case "C":
      holdSwap(); break;
    case "p": case "P":
      paused = !paused; if (pauseBtn) pauseBtn.textContent = paused ? "Resume" : "Pause"; break;
    case "Escape":
      paused = true; break;
  }
});

document.addEventListener("keyup", e => {
  keyState[e.key] = false;
  switch (e.key) {
    case "ArrowLeft": dasStop('left'); break;
    case "ArrowRight": dasStop('right'); break;
    case "ArrowDown": keyState.soft = false; break;
  }
});

/* DAS helpers */
function dasStart(dir) {
  dasState[dir] = true;
  dasState.holdStart = performance.now();
  dasState.nextMoveAt = performance.now() + DAS_DELAY;
}
function dasStop(dir) {
  dasState[dir] = false;
  dasState.holdStart = 0;
  dasState.nextMoveAt = 0;
}
function moveOnce(dir) {
  if (!player.matrix || paused || gameOver) return;
  player.pos.x += dir;
  if (collide(arena, player.pos.x, Math.floor(player.pos.y), player.matrix)) player.pos.x -= dir;
  else { lockTimer = 0; onGround = false; playSound('move'); }
}

/* Touch button binds */
function bindBtn(id, cb) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener("pointerdown", e => { e.preventDefault(); btn.classList.add("pressed"); cb(); });
  btn.addEventListener("pointerup", () => btn.classList.remove("pressed"));
  btn.addEventListener("pointerleave", () => btn.classList.remove("pressed"));
  btn.addEventListener("touchstart", e => { e.preventDefault(); btn.classList.add("pressed'); cb(); }, {passive:false});
  btn.addEventListener("touchend", () => btn.classList.remove("pressed"));
}
bindBtn("left-btn", () => moveOnce(-1));
bindBtn("right-btn", () => moveOnce(1));
bindBtn("down-btn", () => keyState.soft = true);
bindBtn("rotate-btn", () => rotatePlayer(1));
bindBtn("hard-btn", () => hardDrop());
bindBtn("hold-btn", () => holdSwap());

/* ------------------------
   Game loop with fixed-physics + throttled render
---------------------------*/
function update(time = 0) {
  if (!lastTime) lastTime = time;
  const delta = time - lastTime;
  lastTime = time;

  if (!paused && !gameOver) {
    // gravity (cells per second) -> ms per cell
    let gravity = gravityCPS;
    // soft drop
    if (keyState.soft) gravity = gravity * SOFT_DROP_MULT;

    const msPerCell = 1000 / Math.max(0.001, gravity);
    dropAccumulator += delta;

    // while enough time has passed, move down one cell per cell ms
    while (dropAccumulator >= msPerCell) {
      player.pos.y += 1;
      dropAccumulator -= msPerCell;
      // collision check
      if (collide(arena, player.pos.x, Math.floor(player.pos.y), player.matrix)) {
        // revert
        player.pos.y -= 1;
        // start lock timer / or lock immediately if already on ground for a while
        if (!onGround) {
          onGround = true;
          lockTimer = 0;
        }
        break;
      } else {
        // in air
        onGround = false;
        lockTimer = 0;
      }
    }

    // DAS auto-repeat handling
    const now = performance.now();
    if (dasState.left || dasState.right) {
      if (now >= dasState.nextMoveAt) {
        const dir = dasState.left ? -1 : 1;
        moveOnce(dir);
        dasState.nextMoveAt = now + ARR;
      }
    }

    // lock delay handling
    if (onGround) {
      lockTimer += delta;
      if (lockTimer >= LOCK_DELAY) {
        // lock now
        mergeToArena();
        sweep();
        spawnPlayer();
        dropAccumulator = 0;
        lockTimer = 0;
        onGround = false;
      }
    } else {
      lockTimer = 0;
    }
  }

  // interp for smooth render: fraction progress to next cell
  const msPerCellRender = 1000 / Math.max(0.001, (keyState.soft ? gravityCPS * SOFT_DROP_MULT : gravityCPS));
  const interp = Math.min(1, dropAccumulator / msPerCellRender);

  // rendering throttled by performanceMode targetFPS
  if (performanceMode) {
    if (time - lastRender >= minFrameTime) {
      drawScene(interp);
      lastRender = time;
    }
  } else {
    drawScene(interp);
  }

  lastTime = time;
  requestAnimationFrame(update);
}

/* ------------------------
   Game control
---------------------------*/
function resetGame() {
  for (let y = 0; y < ROWS; ++y) arena[y].fill(0);
  nextQueue = [];
  refillQueue.bag = null;
  refillQueue.index = 0;
  refillQueue();
  score = 0; lines = 0; level = 0;
  if (scoreEl) scoreEl.textContent = "0";
  if (linesEl) linesEl.textContent = "0";
  if (levelEl) levelEl.textContent = "0";
  holdPiece = null;
  holdUsed = false;
  gameOver = false;
  spawnPlayer();
  playSound('start');
}

function spawnPlayer() { /* placeholder to be overwritten below */ }

/* ------------------------
   Queue, spawn and init
---------------------------*/
refillQueue.bag = null;
refillQueue.index = 0;
refillQueue();
function refillQueue() { /* overwritten earlier; kept for linter safety */ }

/* Re-declare the proper refillQueue and spawnPlayer into current scope (we defined earlier) */
(function finalizeSetup(){
  // reuse earlier functions defined above — they already exist in scope
  // refill queue initial fill
  refillQueue.bag = null;
  refillQueue.index = 0;
  refillQueue();
  // actual spawn player implementation from earlier
  spawnPlayer = function() {
    refillQueue();
    const type = nextQueue.shift();
    refillQueue();
    const matrix = createPiece(type);
    const id = PIECE_IDS[type] || 1;
    for (let y=0;y<matrix.length;++y) for(let x=0;x<matrix[y].length;++x) if (matrix[y][x]) matrix[y][x] = id;
    player.matrix = matrix;
    player.id = id;
    player.pos.x = Math.floor(COLS/2) - Math.floor(matrix[0].length/2);
    player.pos.y = -1;
    holdUsed = false;
    lockTimer = 0;
    onGround = false;
    drawNext();
    drawHold();
    // if immediate collision -> game over flow
    if (collide(arena, player.pos.x, Math.floor(player.pos.y), player.matrix)) {
      gameOver = true;
      playSound('line');
      setTimeout(() => {
        resetGame();
      }, 800);
    }
  };
})();

/* ------------------------
   Initialization
---------------------------*/
function init() {
  // prepare UI text
  if (scoreEl) scoreEl.textContent = String(score);
  if (linesEl) linesEl.textContent = String(lines);
  if (levelEl) levelEl.textContent = String(level);

  // queue fill & spawn
  refillQueue.bag = null;
  refillQueue.index = 0;
  refillQueue();
  spawnPlayer();
  lastTime = performance.now();
  lastRender = lastTime;
  requestAnimationFrame(update);
}

init();

/* End of file */
