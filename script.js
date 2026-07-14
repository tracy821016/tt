const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const roomCodeEl = document.getElementById("roomCode");
const playerCountEl = document.getElementById("playerCount");
const statusText = document.getElementById("statusText");
const overlay = document.getElementById("overlay");
const startButton = document.getElementById("startButton");
const restartButton = document.getElementById("restartButton");
const copyRoomButton = document.getElementById("copyRoomButton");
const createRoomButton = document.getElementById("createRoomButton");
const joinRoomButton = document.getElementById("joinRoomButton");
const roomInput = document.getElementById("roomInput");
const playerNameInput = document.getElementById("playerName");
const scoreboard = document.getElementById("scoreboard");
const touchButtons = document.querySelectorAll("[data-direction]");

const gridSize = 20;
const tileCount = canvas.width / gridSize;
const playerIdKey = "snake-online-player-id";
const playerNameKey = "snake-online-player-name";
const colors = {
  board: "#1f232b",
  grid: "rgba(255, 255, 255, 0.055)",
  food: "#facc15",
  text: "#f4f7fb",
  dead: "rgba(255, 255, 255, 0.22)",
};

let playerId = localStorage.getItem(playerIdKey) || crypto.randomUUID();
let roomId = new URLSearchParams(location.search).get("room") || "";
let latestState = null;
let pollTimer = null;
let statusMessage = "尚未連線";

localStorage.setItem(playerIdKey, playerId);
playerNameInput.value =
  localStorage.getItem(playerNameKey) || `玩家${Math.floor(Math.random() * 90 + 10)}`;
roomInput.value = roomId;

const directionMap = {
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
};

function api(path, options = {}) {
  return fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "連線失敗");
    return data;
  });
}

async function createRoom() {
  try {
    const data = await api("/api/rooms", { method: "POST" });
    roomInput.value = data.roomId;
    await joinRoom(data.roomId);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function joinRoom(nextRoomId = roomInput.value) {
  const code = nextRoomId.trim().toUpperCase();
  if (!code) {
    setStatus("請輸入房間代碼", true);
    return;
  }

  localStorage.setItem(playerNameKey, playerNameInput.value.trim() || "玩家");

  try {
    const data = await api(`/api/rooms/${code}/join`, {
      method: "POST",
      body: JSON.stringify({
        playerId,
        name: playerNameInput.value.trim() || "玩家",
      }),
    });
    statusMessage = "";
    roomId = data.roomId;
    roomInput.value = roomId;
    history.replaceState(null, "", `?room=${roomId}`);
    startPolling();
    applyState(data.state);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(fetchState, 130);
  fetchState();
}

async function fetchState() {
  if (!roomId) return;

  try {
    const data = await api(`/api/rooms/${roomId}/state?playerId=${encodeURIComponent(playerId)}`);
    applyState(data.state);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function sendDirection(direction) {
  if (!roomId) return;

  try {
    await api(`/api/rooms/${roomId}/direction`, {
      method: "POST",
      body: JSON.stringify({ playerId, direction }),
    });
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function startGame() {
  if (!roomId) {
    await createRoom();
  }

  try {
    await api(`/api/rooms/${roomId}/start`, {
      method: "POST",
      body: JSON.stringify({ playerId }),
    });
    overlay.classList.add("is-hidden");
    fetchState();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function restartGame() {
  if (!roomId) return;

  try {
    await api(`/api/rooms/${roomId}/reset`, {
      method: "POST",
      body: JSON.stringify({ playerId }),
    });
    overlay.classList.remove("is-hidden");
    fetchState();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function copyRoomCode() {
  if (!roomId) return;
  const url = `${location.origin}${location.pathname}?room=${roomId}`;

  try {
    await navigator.clipboard.writeText(url);
    setStatus("已複製邀請連結", false);
  } catch {
    setStatus(`房號 ${roomId}`, false);
  }
}

function applyState(state) {
  latestState = state;
  const players = Object.values(state.players);
  const me = state.players[playerId];

  roomCodeEl.textContent = state.roomId;
  playerCountEl.textContent = String(players.length);
  statusText.classList.toggle("danger", state.status === "over");
  statusText.textContent =
    statusMessage && state.status === "waiting" ? statusMessage : getStatusLabel(state.status);

  renderScoreboard(players);
  draw(state);

  if (state.status === "playing") {
    overlay.classList.add("is-hidden");
  } else if (state.status === "over") {
    const winner = players
      .filter((player) => player.score === Math.max(...players.map((p) => p.score)))
      .map((player) => player.name)
      .join("、");
    showOverlay("遊戲結束", `勝利者：${winner || "無"}`, "再玩一次");
  } else {
    showOverlay(
      "連線貪食蛇",
      me ? "等待開始，分享房號給朋友" : "開房間或輸入代碼加入",
      me ? "開始遊戲" : "開新房間"
    );
  }
}

function renderScoreboard(players) {
  scoreboard.innerHTML = "";
  players
    .sort((a, b) => b.score - a.score)
    .forEach((player) => {
      const item = document.createElement("div");
      item.className = "score-item";
      item.innerHTML = `
        <span class="player-dot" style="background:${player.color}"></span>
        <span>${escapeHtml(player.name)}${player.id === playerId ? "（你）" : ""}</span>
        <strong>${player.score}</strong>
      `;
      if (!player.alive) item.classList.add("is-dead");
      scoreboard.appendChild(item);
    });
}

function draw(state = latestState) {
  ctx.fillStyle = colors.board;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  if (!state) return;

  drawFood(state.food);
  Object.values(state.players).forEach(drawSnake);
}

function drawGrid() {
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;

  for (let i = 1; i < tileCount; i += 1) {
    const position = i * gridSize;
    ctx.beginPath();
    ctx.moveTo(position, 0);
    ctx.lineTo(position, canvas.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, position);
    ctx.lineTo(canvas.width, position);
    ctx.stroke();
  }
}

function drawSnake(player) {
  player.snake.forEach((part, index) => {
    const inset = index === 0 ? 2 : 3;
    ctx.fillStyle = player.alive ? (index === 0 ? player.headColor : player.color) : colors.dead;
    roundRect(
      part.x * gridSize + inset,
      part.y * gridSize + inset,
      gridSize - inset * 2,
      gridSize - inset * 2,
      6
    );
    ctx.fill();
  });
}

function drawFood(food) {
  ctx.fillStyle = colors.food;
  ctx.beginPath();
  ctx.arc(
    food.x * gridSize + gridSize / 2,
    food.y * gridSize + gridSize / 2,
    gridSize * 0.34,
    0,
    Math.PI * 2
  );
  ctx.fill();
}

function roundRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function showOverlay(title, message, buttonText) {
  overlay.querySelector("h1").textContent = title;
  overlay.querySelector("p").textContent = message;
  startButton.textContent = buttonText;
  overlay.classList.remove("is-hidden");
}

function setStatus(message, isError) {
  statusMessage = message;
  statusText.textContent = message;
  statusText.classList.toggle("danger", isError);
}

function getStatusLabel(status) {
  return {
    waiting: "等待",
    playing: "進行中",
    over: "結束",
  }[status];
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char];
  });
}

document.addEventListener("keydown", (event) => {
  const direction = directionMap[event.code];
  if (!direction) return;
  event.preventDefault();
  sendDirection(direction);
});

touchButtons.forEach((button) => {
  button.addEventListener("click", () => sendDirection(button.dataset.direction));
});

createRoomButton.addEventListener("click", createRoom);
joinRoomButton.addEventListener("click", () => joinRoom());
startButton.addEventListener("click", startGame);
restartButton.addEventListener("click", restartGame);
copyRoomButton.addEventListener("click", copyRoomCode);
playerNameInput.addEventListener("change", () => {
  localStorage.setItem(playerNameKey, playerNameInput.value.trim() || "玩家");
});

draw();
if (roomId) joinRoom(roomId);
