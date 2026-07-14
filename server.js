const http = require("http");
const fs = require("fs");
const path = require("path");

const port = process.env.PORT || 3000;
const publicDir = __dirname;
const tileCount = 24;
const tickMs = 120;
const maxPlayers = 4;

const rooms = new Map();
const directions = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const palette = [
  { body: "#6ee7b7", head: "#34d399" },
  { body: "#93c5fd", head: "#60a5fa" },
  { body: "#f9a8d4", head: "#f472b6" },
  { body: "#fde68a", head: "#facc15" },
];

function createRoom() {
  let roomId;
  do {
    roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
  } while (rooms.has(roomId));

  const room = {
    roomId,
    status: "waiting",
    players: new Map(),
    food: { x: 12, y: 8 },
    updatedAt: Date.now(),
  };
  rooms.set(roomId, room);
  return room;
}

function addPlayer(room, playerId, name) {
  if (!playerId || typeof playerId !== "string") {
    throw new Error("缺少玩家 ID");
  }

  if (room.players.has(playerId)) {
    const player = room.players.get(playerId);
    player.name = cleanName(name);
    player.lastSeen = Date.now();
    return player;
  }

  if (room.players.size >= maxPlayers) {
    throw new Error("房間已滿");
  }

  const index = room.players.size;
  const spawn = getSpawn(index);
  const color = palette[index % palette.length];
  const player = {
    id: playerId,
    name: cleanName(name),
    snake: spawn.snake,
    direction: spawn.direction,
    nextDirection: spawn.direction,
    score: 0,
    alive: true,
    color: color.body,
    headColor: color.head,
    lastSeen: Date.now(),
  };
  room.players.set(playerId, player);
  room.food = createFood(room);
  return player;
}

function getSpawn(index) {
  const spawns = [
    {
      snake: [
        { x: 7, y: 12 },
        { x: 6, y: 12 },
        { x: 5, y: 12 },
      ],
      direction: directions.right,
    },
    {
      snake: [
        { x: 16, y: 11 },
        { x: 17, y: 11 },
        { x: 18, y: 11 },
      ],
      direction: directions.left,
    },
    {
      snake: [
        { x: 12, y: 7 },
        { x: 12, y: 6 },
        { x: 12, y: 5 },
      ],
      direction: directions.down,
    },
    {
      snake: [
        { x: 11, y: 16 },
        { x: 11, y: 17 },
        { x: 11, y: 18 },
      ],
      direction: directions.up,
    },
  ];
  return structuredClone(spawns[index % spawns.length]);
}

function cleanName(name) {
  const value = String(name || "玩家").trim().slice(0, 12);
  return value || "玩家";
}

function setDirection(room, playerId, directionName) {
  const player = room.players.get(playerId);
  const next = directions[directionName];
  if (!player || !next || !player.alive) return;

  const isReverse = next.x + player.direction.x === 0 && next.y + player.direction.y === 0;
  if (isReverse) return;

  player.nextDirection = next;
  player.lastSeen = Date.now();
}

function startRoom(room) {
  if (room.players.size === 0) throw new Error("房間裡還沒有玩家");
  if (room.status === "over") resetRoom(room);
  room.status = "playing";
}

function resetRoom(room) {
  const existingPlayers = [...room.players.values()].map((player) => ({
    id: player.id,
    name: player.name,
  }));
  room.players.clear();
  room.status = "waiting";
  existingPlayers.forEach((player) => addPlayer(room, player.id, player.name));
  room.food = createFood(room);
}

function tickRooms() {
  rooms.forEach((room) => {
    if (room.status !== "playing") return;
    tickRoom(room);
  });
}

function tickRoom(room) {
  const players = [...room.players.values()];
  const moves = new Map();
  const occupied = new Map();

  players.forEach((player) => {
    if (!player.alive) return;
    player.direction = player.nextDirection;
    const head = player.snake[0];
    const nextHead = {
      x: head.x + player.direction.x,
      y: head.y + player.direction.y,
    };
    moves.set(player.id, {
      player,
      nextHead,
      grows: nextHead.x === room.food.x && nextHead.y === room.food.y,
    });
  });

  moves.forEach(({ player, grows }) => {
    const body = grows ? player.snake : player.snake.slice(0, -1);
    body.forEach((part) => addOccupied(occupied, part.x, part.y, player.id));
  });

  moves.forEach((move) => {
    const key = cellKey(move.nextHead.x, move.nextHead.y);
    addOccupied(occupied, move.nextHead.x, move.nextHead.y, move.player.id);
    move.headCollision = occupied.get(key).length > 1;
  });

  let foodWasEaten = false;
  moves.forEach((move) => {
    const { player, nextHead, grows, headCollision } = move;
    const hitsWall =
      nextHead.x < 0 || nextHead.x >= tileCount || nextHead.y < 0 || nextHead.y >= tileCount;

    if (hitsWall || headCollision) {
      player.alive = false;
      return;
    }

    player.snake.unshift(nextHead);
    if (grows) {
      player.score += 10;
      foodWasEaten = true;
    } else {
      player.snake.pop();
    }
  });

  if (foodWasEaten) {
    room.food = createFood(room);
  }

  if (players.every((player) => !player.alive)) {
    room.status = "over";
  }
  room.updatedAt = Date.now();
}

function addOccupied(occupied, x, y, playerId) {
  const key = cellKey(x, y);
  if (!occupied.has(key)) occupied.set(key, []);
  occupied.get(key).push(playerId);
}

function cellKey(x, y) {
  return `${x},${y}`;
}

function createFood(room) {
  const occupied = new Set();
  room.players.forEach((player) => {
    player.snake.forEach((part) => occupied.add(cellKey(part.x, part.y)));
  });

  let food;
  do {
    food = {
      x: Math.floor(Math.random() * tileCount),
      y: Math.floor(Math.random() * tileCount),
    };
  } while (occupied.has(cellKey(food.x, food.y)));

  return food;
}

function roomState(room) {
  return {
    roomId: room.roomId,
    status: room.status,
    food: room.food,
    players: Object.fromEntries(
      [...room.players.entries()].map(([id, player]) => [
        id,
        {
          id,
          name: player.name,
          snake: player.snake,
          score: player.score,
          alive: player.alive,
          color: player.color,
          headColor: player.headColor,
        },
      ])
    ),
  };
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10000) request.destroy();
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const pathname = decodeURIComponent(requestUrl.pathname);
  const safePath =
    pathname === "/"
      ? "index.html"
      : path.normalize(pathname).replace(/^[/\\]+/, "").replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, { "Content-Type": getContentType(filePath) });
    response.end(data);
  });
}

function getContentType(filePath) {
  const ext = path.extname(filePath);
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
    }[ext] || "application/octet-stream"
  );
}

async function handleApi(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const parts = requestUrl.pathname.split("/").filter(Boolean);

  try {
    if (request.method === "POST" && requestUrl.pathname === "/api/rooms") {
      const room = createRoom();
      sendJson(response, 200, { roomId: room.roomId });
      return;
    }

    if (parts[0] === "api" && parts[1] === "rooms" && parts[2]) {
      const room = rooms.get(parts[2].toUpperCase());
      if (!room) throw new Error("找不到房間");

      if (request.method === "GET" && parts[3] === "state") {
        sendJson(response, 200, { state: roomState(room) });
        return;
      }

      const body = await readJson(request);
      if (request.method === "POST" && parts[3] === "join") {
        addPlayer(room, body.playerId, body.name);
        sendJson(response, 200, { roomId: room.roomId, state: roomState(room) });
        return;
      }

      if (request.method === "POST" && parts[3] === "direction") {
        setDirection(room, body.playerId, body.direction);
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && parts[3] === "start") {
        startRoom(room);
        sendJson(response, 200, { state: roomState(room) });
        return;
      }

      if (request.method === "POST" && parts[3] === "reset") {
        resetRoom(room);
        sendJson(response, 200, { state: roomState(room) });
        return;
      }
    }

    sendJson(response, 404, { error: "找不到 API" });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "伺服器錯誤" });
  }
}

const server = http.createServer((request, response) => {
  if (request.url.startsWith("/api/")) {
    handleApi(request, response);
    return;
  }

  serveStatic(request, response);
});

setInterval(tickRooms, tickMs);
server.listen(port, () => {
  console.log(`Snake server running at http://localhost:${port}`);
});
