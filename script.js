"use strict";

// ----- Canvas Setup -----
const canvas = document.getElementById("tetris");
const ctx = canvas.getContext("2d");
ctx.scale(20, 20);

// ----- Game State -----
let neonGlow = true;
let performanceMode = false;
let dropInterval = 1000;
let dropCounter = 0;
let lastTime = 0;
let gameOver = false;

// ----- Game Entities -----
const arena = createMatrix(12, 20);
const player = { pos: { x: 0, y: 0 }, matrix: null };

// ----- Settings Panel -----
const settingsBtn = document.getElementById("settings-btn");
const settingsPanel = document.getElementById("settings-panel");
const perfToggle = document.getElementById("perf-toggle");
const glowToggle = document.getElementById("glow-toggle");
const speedSlider = document.getElementById("speed-slider");
const closeSettings = document.getElementById("close-settings");

// ----- Settings Events -----
settingsBtn && settingsBtn.addEventListener("click", () => settingsPanel.classList.remove("hidden"));
closeSettings && closeSettings.addEventListener("click", () => settingsPanel.classList.add("hidden"));

perfToggle && perfToggle.addEventListener("change", () => {
  performanceMode = perfToggle.checked;
  dropInterval = performanceMode ? 1600 : Number(speedSlider.value);
  if (speedSlider) speedSlider.disabled = performanceMode;
});

glowToggle && glowToggle.addEventListener("change", () => neonGlow = glowToggle.checked);

// Debounce slider changes for smooth interval update
let speedDebounce;
speedSlider && speedSlider.addEventListener("input", () => {
  if (!performanceMode) {
    clearTimeout(speedDebounce);
    speedDebounce = setTimeout(() => {
      dropInterval = Number(speedSlider.value);
    }, 80);
  }
});

// ----- Utility Functions -----
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
  return shapes[type];
}

// ----- Game Functions -----
function arenaSweep() {
  for (let y = arena.length - 1; y >= 0; --y) {
    if (arena[y].every(v => v !== 0)) {
      arena.splice(y, 1);
      arena.unshift(Array(arena[0].length).fill(0));
      ++y; // Check same row again after insert
    }
  }
}

function collide(arena, player) {
  const [m, o] = [player.matrix, player.pos];
  for (let y = 0; y < m.length; ++y)
    for (let x = 0; x < m[y].length; ++x)
      if (
        m[y][x] !== 0 &&
        (
          arena[y + o.y] &&
          arena[y + o.y][x + o.x]
        ) !== 0
      ) return true;
  return false;
}

function drawMatrix(matrix, offset) {
  matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (!value) return;
      ctx.save();
      ctx.fillStyle = "#0ff";
      if (neonGlow) {
        ctx.shadowBlur = 18;
        ctx.shadowColor = "#0ff";
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.fillRect(x + offset.x, y + offset.y, 1, 1);
      ctx.restore();
    });
  });
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawMatrix(arena, { x: 0, y: 0 });
  if (player.matrix && !gameOver) {
    drawMatrix(player.matrix, player.pos);
  }
}

function merge(arena, player) {
  player.matrix.forEach((row, y) =>
    row.forEach((val, x) => {
      if (val !== 0) arena[y + player.pos.y][x + player.pos.x] = val;
    })
  );
}

function rotate(matrix) {
  // Transpose
  for (let y = 0; y < matrix.length; ++y)
    for (let x = 0; x < y; ++x)
      [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
  // Reverse
  matrix.forEach(row => row.reverse());
}

function playerReset() {
  const pieces = "ILJOTSZ";
  player.matrix = createPiece(pieces[(pieces.length * Math.random()) | 0]);
  player.pos.y = 0;
  player.pos.x = Math.floor(arena[0].length / 2) - Math.floor(player.matrix[0].length / 2);

  if (collide(arena, player)) {
    arena.forEach(row => row.fill(0));
    gameOver = true;
    setTimeout(() => {
      gameOver = false;
      playerReset();
    }, 1200); // Restart after 1.2s for Game Over effect
  }
}

function playerDrop() {
  if (gameOver) return;
  ++player.pos.y;
  if (collide(arena, player)) {
    --player.pos.y;
    merge(arena, player);
    arenaSweep();
    playerReset();
  }
  dropCounter = 0;
}

function playerMove(dir) {
  if (gameOver) return;
  player.pos.x += dir;
  if (collide(arena, player)) player.pos.x -= dir;
}

function update(time = 0) {
  if (gameOver) {
    draw();
    return requestAnimationFrame(update);
  }
  const delta = time - lastTime;
  lastTime = time;
  dropCounter += delta;
  if (dropCounter > dropInterval) playerDrop();
  draw();
  requestAnimationFrame(update);
}

// ----- Controls -----
document.addEventListener("keydown", e => {
  if (gameOver) return;
  switch (e.key) {
    case "ArrowLeft": playerMove(-1); break;
    case "ArrowRight": playerMove(1); break;
    case "ArrowDown": playerDrop(); break;
    case "ArrowUp": rotate(player.matrix); break;
  }
});

// ----- Touch / Pointer Controls -----
function bindControl(id, action) {
  const btn = document.getElementById(id);
  if (!btn) return;
  ["pointerdown", "touchstart"].forEach(evt => btn.addEventListener(evt, e => {
    e.preventDefault();
    btn.classList.add("pressed");
    action();
  }));
  ["pointerup", "touchend", "pointerleave", "touchcancel"].forEach(evt => btn.addEventListener(evt, () => {
    btn.classList.remove("pressed");
  }));
}

bindControl("left-btn", () => playerMove(-1));
bindControl("right-btn", () => playerMove(1));
bindControl("down-btn", () => playerDrop());
bindControl("rotate-btn", () => rotate(player.matrix));

// ----- Start Game -----
playerReset();
update();
