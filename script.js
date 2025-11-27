const canvas = document.getElementById("tetris");
const ctx = canvas.getContext("2d");
ctx.scale(20, 20);

let neonGlow = true;
let performanceMode = false;

// Smooth falling
let dropInterval = 1000;

/* -------------------------
   SETTINGS PANEL LOGIC
---------------------------- */
const settingsBtn = document.getElementById("settings-btn");
const settingsPanel = document.getElementById("settings-panel");
const perfToggle = document.getElementById("perf-toggle");
const glowToggle = document.getElementById("glow-toggle");
const speedSlider = document.getElementById("speed-slider");
const closeSettings = document.getElementById("close-settings");

settingsBtn.addEventListener("click", () => {
  settingsPanel.classList.remove("hidden");
});

closeSettings.addEventListener("click", () => {
  settingsPanel.classList.add("hidden");
});

perfToggle.addEventListener("change", () => {
  performanceMode = perfToggle.checked;
  dropInterval = performanceMode ? 1600 : speedSlider.value;
});

glowToggle.addEventListener("change", () => {
  neonGlow = glowToggle.checked;
});

speedSlider.addEventListener("input", () => {
  if (!performanceMode) dropInterval = speedSlider.value;
});

/* -------------------------
   GAME LOGIC
---------------------------- */

function arenaSweep() {
  outer: for (let y = arena.length - 1; y > 0; --y) {
    for (let x = 0; x < arena[y].length; ++x) {
      if (arena[y][x] === 0) continue outer;
    }
    const row = arena.splice(y, 1)[0].fill(0);
    arena.unshift(row);
    ++y;
  }
}

function collide(arena, player) {
  const [m, o] = [player.matrix, player.pos];
  for (let y = 0; y < m.length; ++y) {
    for (let x = 0; x < m[y].length; ++x) {
      if (
        m[y][x] !== 0 &&
        (arena[y + o.y] && arena[y + o.y][x + o.x]) !== 0
      ) return true;
    }
  }
  return false;
}

function createMatrix(w, h) {
  const matrix = [];
  while (h--) matrix.push(new Array(w).fill(0));
  return matrix;
}

function createPiece(type) {
  switch (type) {
    case "T": return [[0,1,0],[1,1,1],[0,0,0]];
    case "O": return [[1,1],[1,1]];
    case "L": return [[0,0,1],[1,1,1],[0,0,0]];
    case "J": return [[1,0,0],[1,1,1],[0,0,0]];
    case "I": return [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]];
    case "S": return [[0,1,1],[1,1,0],[0,0,0]];
    case "Z": return [[1,1,0],[0,1,1],[0,0,0]];
  }
}

function drawMatrix(matrix, offset) {
  matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value !== 0) {
        ctx.fillStyle = "#0ff";

        ctx.fillRect(x + offset.x, y + offset.y, 1, 1);

        if (neonGlow) {
          ctx.shadowBlur = 18;
          ctx.shadowColor = "#0ff";
        } else {
          ctx.shadowBlur = 0;
        }
      }
    });
  });
}

function draw() {
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawMatrix(arena, { x: 0, y: 0 });
  drawMatrix(player.matrix, player.pos);
}

function merge(arena, player) {
  player.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value !== 0)
        arena[y + player.pos.y][x + player.pos.x] = value;
    });
  });
}

function rotate(matrix) {
  for (let y = 0; y < matrix.length; ++y) {
    for (let x = 0; x < y; ++x) {
      [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
    }
  }
  matrix.forEach(row => row.reverse());
}

function playerReset() {
  const pieces = "ILJOTSZ";
  player.matrix = createPiece(pieces[(pieces.length * Math.random()) | 0]);
  player.pos.y = 0;
  player.pos.x = ((arena[0].length / 2) | 0) -
                 ((player.matrix[0].length / 2) | 0);

  if (collide(arena, player)) arena.forEach(row => row.fill(0));
}

function playerDrop() {
  player.pos.y++;
  if (collide(arena, player)) {
    player.pos.y--;
    merge(arena, player);
    playerReset();
    arenaSweep();
  }
  dropCounter = 0;
}

function playerMove(dir) {
  player.pos.x += dir;
  if (collide(arena, player)) player.pos.x -= dir;
}

let dropCounter = 0;
let lastTime = 0;

function update(time = 0) {
  const delta = time - lastTime;
  lastTime = time;
  dropCounter += delta;

  if (dropCounter > dropInterval) {
    playerDrop();
  }

  draw();
  requestAnimationFrame(update);
}

/* -------------------------
   KEYBOARD + TOUCH
---------------------------- */
document.addEventListener("keydown", e => {
  if (e.key === "ArrowLeft") playerMove(-1);
  if (e.key === "ArrowRight") playerMove(1);
  if (e.key === "ArrowDown") playerDrop();
  if (e.key === "ArrowUp") rotate(player.matrix);
});

function bindControl(id, action) {
  const btn = document.getElementById(id);
  btn.addEventListener("pointerdown", () => {
    btn.classList.add("pressed");
    action();
  });
  btn.addEventListener("pointerup", () => btn.classList.remove("pressed"));
  btn.addEventListener("pointerleave", () => btn.classList.remove("pressed"));
}

bindControl("left-btn", () => playerMove(-1));
bindControl("right-btn", () => playerMove(1));
bindControl("down-btn", () => playerDrop());
bindControl("rotate-btn", () => rotate(player.matrix));

/* -------------------------
   START GAME
---------------------------- */
const arena = createMatrix(12, 20);
const player = { pos: { x: 0, y: 0 }, matrix: null };

playerReset();
update();
