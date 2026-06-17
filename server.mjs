import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 4174);
const host = process.env.HOST || "0.0.0.0";
const CLANS = ["Rose", "Beast"];
const CLAN_NAMES = { Rose: "玫瑰氏族", Beast: "野兽氏族" };
const CLUE_BY_CLAN = { Rose: "玫瑰纹章", Beast: "野兽纹章" };
const VALID_PLAYER_COUNTS = [6, 8, 10];

const ROLE_DEFS = {
  1: { role: "长老", markers: ["clan", "clan", "rank"], clue: "same", ability: "elder" },
  2: { role: "刺客", markers: ["unknown", "unknown", "rank"], clue: "same", ability: "assassin" },
  3: { role: "小丑", markers: ["unknown", "unknown", "rank"], clue: "opposite", ability: "harlequin" },
  4: { role: "炼金术士", markers: ["unknown", "unknown", "rank"], clue: "same", ability: "alchemist" },
  5: { role: "灵喻师", markers: ["clan", "clan", "rank"], clue: "same", ability: "oracle" },
  6: { role: "守卫", markers: ["clan", "clan", "rank"], clue: "same", ability: "guardian" },
  7: { role: "狂战士", markers: ["clan", "unknown", "rank"], clue: "same", ability: "berserker" },
  8: { role: "法师", markers: ["clan", "unknown", "rank"], clue: "same", ability: "mage" },
  9: { role: "舞妓", markers: ["clan", "unknown", "rank"], clue: "same", ability: "courtesan" },
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const room = {
  nextConnectionId: 1,
  hostConnectionId: null,
  connections: new Map(),
  seats: [],
  config: defaultConfig(),
  game: null,
};

const server = createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = normalize(join(root, decodeURIComponent(requestPath)));

  if (!filePath.startsWith(root) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
});

server.on("upgrade", (request, socket) => {
  if (request.url !== "/ws") {
    socket.destroy();
    return;
  }

  const key = request.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );

  const connection = {
    id: `c${room.nextConnectionId++}`,
    socket,
    buffer: Buffer.alloc(0),
    playerId: null,
    name: "",
  };
  room.connections.set(connection.id, connection);

  socket.on("data", (chunk) => {
    connection.buffer = Buffer.concat([connection.buffer, chunk]);
    readFrames(connection);
  });
  socket.on("close", () => disconnect(connection));
  socket.on("error", () => disconnect(connection));

  send(connection, { type: "connected", connectionId: connection.id });
  broadcastAllViews();
});

server.listen(port, host, () => {
  console.log(`Bloodbound online prototype running on ${host}:${port}`);
  console.log(`Local URL: http://127.0.0.1:${port}/`);
});

function defaultConfig() {
  return {
    playerCount: 6,
    mode: "random",
    roseRanks: [1, 2, 3],
    beastRanks: [1, 2, 3],
  };
}

function readFrames(connection) {
  while (connection.buffer.length >= 2) {
    const first = connection.buffer[0];
    const second = connection.buffer[1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (connection.buffer.length < offset + 2) return;
      length = connection.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (connection.buffer.length < offset + 8) return;
      const high = connection.buffer.readUInt32BE(offset);
      const low = connection.buffer.readUInt32BE(offset + 4);
      length = high * 2 ** 32 + low;
      offset += 8;
    }

    const maskLength = masked ? 4 : 0;
    if (connection.buffer.length < offset + maskLength + length) return;

    const mask = masked ? connection.buffer.subarray(offset, offset + 4) : null;
    offset += maskLength;
    const payload = Buffer.from(connection.buffer.subarray(offset, offset + length));
    connection.buffer = connection.buffer.subarray(offset + length);

    if (opcode === 8) {
      connection.socket.end();
      return;
    }
    if (opcode !== 1) continue;
    if (mask) {
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
    }

    try {
      handleClientEvent(connection, JSON.parse(payload.toString("utf8")));
    } catch {
      sendError(connection, "bad_message", "消息格式错误。");
    }
  }
}

function send(connection, message) {
  if (!connection.socket.writable) return;
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(payload.length, 6);
  }
  connection.socket.write(Buffer.concat([header, payload]));
}

function sendError(connection, code, message) {
  send(connection, { type: "error", code, message });
}

function handleClientEvent(connection, event) {
  if (!event || typeof event.type !== "string") {
    sendError(connection, "bad_event", "未知操作。");
    return;
  }

  try {
    switch (event.type) {
      case "setRoomConfig":
        setRoomConfig(connection, event.config || {});
        break;
      case "joinRoom":
        joinRoom(connection, event.name);
        break;
      case "reconnectRoom":
        reconnectRoom(connection, Number(event.playerId), event.reconnectToken);
        break;
      case "reconnectByName":
        reconnectByName(connection, event.name);
        break;
      case "startGame":
        startGame(connection);
        break;
      case "readyNextRound":
        readyNextRound(connection);
        break;
      case "requestRestart":
        requestRestart(connection);
        break;
      case "acceptRestart":
        acceptRestart(connection);
        break;
      case "rejectRestart":
        rejectRestart(connection);
        break;
      case "attack":
        attack(connection, Number(event.targetId));
        break;
      case "pass":
        passDagger(connection, Number(event.targetId));
        break;
      case "offerIntervention":
        offerIntervention(connection);
        break;
      case "acceptIntervention":
        acceptIntervention(connection, Number(event.volunteerId));
        break;
      case "rejectIntervention":
        rejectIntervention(connection);
        break;
      case "revealMarker":
        revealMarker(connection, event.marker);
        break;
      case "useAssassinSkill":
        useAssassinSkill(connection, Number(event.targetId));
        break;
      case "selectHarlequinTarget":
        selectHarlequinTarget(connection, Number(event.targetId));
        break;
      case "useAlchemist":
        useAlchemist(connection, event.mode, event.marker);
        break;
      case "useOracle":
        useOracle(connection, Number(event.targetId));
        break;
      case "useGuardian":
        useGuardian(connection, Number(event.targetId));
        break;
      case "useMage":
        useMage(connection, Number(event.targetId));
        break;
      case "useCourtesan":
        useCourtesan(connection, Number(event.targetId));
        break;
      case "sendChat":
        sendChat(connection, event.text);
        break;
      default:
        sendError(connection, "bad_event", "未知操作。");
    }
  } catch (error) {
    sendError(connection, "invalid_action", error.message || "非法操作。");
  }
}

function setRoomConfig(connection, config) {
  requireHost(connection);
  if (room.game) throw new Error("游戏开始后不能修改配置。");

  const playerCount = Number(config.playerCount);
  if (!VALID_PLAYER_COUNTS.includes(playerCount)) throw new Error("人数只能选择 6 / 8 / 10。");
  if (room.seats.length > playerCount) throw new Error("当前已加入人数超过该人数配置。");

  const mode = config.mode === "custom" ? "custom" : "random";
  const half = playerCount / 2;
  const roseRanks = normalizeRanks(config.roseRanks);
  const beastRanks = normalizeRanks(config.beastRanks);

  if (mode === "custom") {
    validateRankSet(roseRanks, half, "玫瑰");
    validateRankSet(beastRanks, half, "野兽");
  }

  room.config = {
    playerCount,
    mode,
    roseRanks: mode === "custom" ? roseRanks : defaultRanks(half),
    beastRanks: mode === "custom" ? beastRanks : defaultRanks(half),
  };
  broadcastAllViews();
}

function joinRoom(connection, rawName) {
  if (connection.playerId) return;
  if (room.seats.length >= room.config.playerCount) throw new Error("房间已满。");
  if (room.game) throw new Error("游戏已经开始。");

  const name = String(rawName || "").trim().slice(0, 12) || `玩家 ${room.seats.length + 1}`;
  if (room.seats.some((seat) => seat.name === name)) {
    throw new Error("昵称已存在，请换一个昵称。");
  }
  const playerId = firstAvailableSeatId();
  connection.playerId = playerId;
  connection.name = name;
  if (!room.hostConnectionId) room.hostConnectionId = connection.id;

  room.seats.push({
    playerId,
    connectionId: connection.id,
    name,
    connected: true,
    reconnectToken: createReconnectToken(),
  });
  room.seats.sort((a, b) => a.playerId - b.playerId);

  const seat = room.seats.find((item) => item.playerId === playerId);
  send(connection, {
    type: "joined",
    playerId,
    name: seat.name,
    reconnectToken: seat.reconnectToken,
    isHost: room.hostConnectionId === connection.id,
  });
  broadcastAllViews();
}

function reconnectRoom(connection, playerId, reconnectToken) {
  if (connection.playerId) return;
  const seat = room.seats.find((item) => item.playerId === playerId);
  if (!seat || !seat.reconnectToken || seat.reconnectToken !== String(reconnectToken || "")) {
    sendError(connection, "reconnect_invalid_token", "重连凭证无效，请尝试按昵称重连。");
    return;
  }
  if (seat.connected && room.connections.has(seat.connectionId)) {
    sendError(connection, "reconnect_seat_online", "该昵称玩家仍在线。");
    return;
  }

  bindConnectionToSeat(connection, seat);
  broadcastAllViews();
}

function reconnectByName(connection, rawName) {
  if (connection.playerId) return;
  const name = String(rawName || "").trim();
  if (!name) {
    sendError(connection, "reconnect_not_found", "请输入要重连的昵称。");
    return;
  }
  const matches = room.seats.filter((seat) => seat.name === name);
  if (!matches.length) {
    sendError(connection, "reconnect_not_found", "没有找到该昵称的离线座位。");
    return;
  }
  const offlineMatches = matches.filter((seat) => !seat.connected || !room.connections.has(seat.connectionId));
  if (!offlineMatches.length) {
    sendError(connection, "reconnect_seat_online", "该昵称玩家仍在线。");
    return;
  }
  if (offlineMatches.length > 1) {
    sendError(connection, "reconnect_duplicate_name", "昵称重复，无法判断要重连哪个座位。");
    return;
  }
  const seat = offlineMatches[0];
  if (!seat.reconnectToken) seat.reconnectToken = createReconnectToken();
  bindConnectionToSeat(connection, seat);
  broadcastAllViews();
}

function bindConnectionToSeat(connection, seat) {
  const wasHost = room.hostConnectionId === seat.connectionId;
  connection.playerId = seat.playerId;
  connection.name = seat.name;
  seat.connectionId = connection.id;
  seat.connected = true;
  if (wasHost || !room.hostConnectionId) room.hostConnectionId = connection.id;
  send(connection, {
    type: "joined",
    playerId: seat.playerId,
    name: seat.name,
    reconnectToken: seat.reconnectToken,
    isHost: room.hostConnectionId === connection.id,
  });
}

function startGame(connection) {
  requireHost(connection);
  if (room.game) throw new Error("游戏已经开始。");
  startNewGame();
}

function startNewGame() {
  if (room.seats.length !== room.config.playerCount) {
    throw new Error(`需要 ${room.config.playerCount} 名玩家加入后才能开始。`);
  }

  const roles = shuffle(buildRoleDeck());
  const players = room.seats.map((seat, index) => ({
    id: seat.playerId,
    name: seat.name,
    ...roles[index],
    wounds: 0,
    revealed: [],
    captured: false,
    privateIntel: [],
  }));

  const currentPlayerId = players[randomInt(players.length)].id;
  room.game = {
    phase: "action",
    players,
    currentPlayerId,
    pendingAttack: null,
    pendingDamage: null,
    pendingAbility: null,
    leaderRule: { Rose: "lowest", Beast: "lowest" },
    items: [],
    publicLogs: [],
    privateLogs: {},
    chatMessages: [],
    winner: null,
    nextReadyIds: [],
    restartVote: null,
    logIndex: 0,
    nextItemId: 1,
  };
  addLog(`游戏开始。本局为 ${room.config.playerCount} 人局。`);
  addLog(`${playerName(currentPlayerId)} 获得匕首。`);
  broadcastAllViews();
}

function readyNextRound(connection) {
  const game = requireGame();
  requirePhase("gameover");
  if (!connection.playerId) throw new Error("只有入座玩家可以准备下一把。");
  if (!game.nextReadyIds.includes(connection.playerId)) game.nextReadyIds.push(connection.playerId);
  addLog(`${playerName(connection.playerId)} 已准备下一把。`);
  const seatIds = room.seats.map((seat) => seat.playerId);
  if (seatIds.every((playerId) => game.nextReadyIds.includes(playerId))) {
    startNewGame();
    return;
  }
  broadcastAllViews();
}

function requestRestart(connection) {
  const game = requireGame();
  if (game.phase === "gameover") throw new Error("游戏结束后请使用下一把。");
  if (!connection.playerId) throw new Error("只有入座玩家可以发起重开。");
  if (game.restartVote) throw new Error("已经有人发起重开投票。");
  game.restartVote = { requesterId: connection.playerId, yesIds: [connection.playerId], noIds: [] };
  addLog(`${playerName(connection.playerId)} 发起重开投票。`);
  broadcastAllViews();
}

function acceptRestart(connection) {
  const game = requireGame();
  if (!game.restartVote) throw new Error("当前没有重开投票。");
  if (!connection.playerId) throw new Error("只有入座玩家可以同意重开。");
  if (!game.restartVote.yesIds.includes(connection.playerId)) {
    game.restartVote.yesIds.push(connection.playerId);
  }
  game.restartVote.noIds = game.restartVote.noIds.filter((playerId) => playerId !== connection.playerId);
  addLog(`${playerName(connection.playerId)} 同意重开。`);
  const seatIds = room.seats.map((seat) => seat.playerId);
  if (seatIds.every((playerId) => game.restartVote.yesIds.includes(playerId))) {
    startNewGame();
    return;
  }
  broadcastAllViews();
}

function rejectRestart(connection) {
  const game = requireGame();
  if (!game.restartVote) throw new Error("当前没有重开投票。");
  if (!connection.playerId) throw new Error("只有入座玩家可以拒绝重开。");
  addLog(`${playerName(connection.playerId)} 拒绝重开，本次重开投票取消。`);
  game.restartVote = null;
  broadcastAllViews();
}

function attack(connection, targetId) {
  const game = requireGame();
  requirePhase("action");
  requirePlayer(connection, game.currentPlayerId);
  const attacker = getPlayer(connection.playerId);
  const target = getActivePlayer(targetId);
  if (target.id === attacker.id) throw new Error("不能攻击自己。");
  if (isProtectedFromTargeting(target)) throw new Error("该玩家受到盾牌保护，不能被攻击。");

  game.pendingAttack = { attackerId: attacker.id, targetId: target.id, volunteerIds: [] };
  addLog(`${attacker.name} 宣告攻击 ${target.name}。`);
  if (!eligibleInterveners().length) {
    addLog(`${target.name} 无人可以干预，直接承伤。`);
    startDamage({
      targetId: target.id,
      sourceId: attacker.id,
      amount: 1,
      forcedRevealMarker: null,
      nextPlayerId: target.id,
      label: "攻击伤害",
      suppressRankAbility: false,
      triggerContext: "normal",
      protectedTargetId: null,
      attackSourceId: attacker.id,
    });
    broadcastAllViews();
    return;
  }
  game.phase = "intervention";
  broadcastAllViews();
}

function passDagger(connection, targetId) {
  const game = requireGame();
  requirePhase("action");
  requirePlayer(connection, game.currentPlayerId);
  const current = getPlayer(connection.playerId);
  const target = getActivePlayer(targetId);
  if (target.id === current.id) throw new Error("不能传给自己。");

  game.currentPlayerId = target.id;
  addLog(`${current.name} 将匕首传给 ${target.name}。`);
  broadcastAllViews();
}

function offerIntervention(connection) {
  const game = requireGame();
  requirePhase("intervention");
  const player = getActivePlayer(connection.playerId);
  if (!eligibleInterveners().some((candidate) => candidate.id === player.id)) {
    throw new Error("当前不能提出干预。");
  }
  game.pendingAttack.volunteerIds.push(player.id);
  addLog(`${player.name} 提出干预，愿意替 ${playerName(game.pendingAttack.targetId)} 承伤。`);
  broadcastAllViews();
}

function acceptIntervention(connection, volunteerId) {
  const game = requireGame();
  requirePhase("intervention");
  const target = getActivePlayer(connection.playerId);
  if (target.id !== game.pendingAttack.targetId) throw new Error("只有目标玩家可以接受干预。");
  if (!game.pendingAttack.volunteerIds.includes(volunteerId)) throw new Error("该玩家没有提出干预。");

  addLog(`${target.name} 接受 ${playerName(volunteerId)} 的干预。`);
  startDamage({
    targetId: volunteerId,
    sourceId: game.pendingAttack.attackerId,
    amount: 1,
    forcedRevealMarker: "rank",
    nextPlayerId: volunteerId,
    label: "干预承伤",
    suppressRankAbility: false,
    triggerContext: "intervention",
    protectedTargetId: target.id,
    attackSourceId: game.pendingAttack.attackerId,
  });
  broadcastAllViews();
}

function rejectIntervention(connection) {
  const game = requireGame();
  requirePhase("intervention");
  const target = getActivePlayer(connection.playerId);
  if (target.id !== game.pendingAttack.targetId) throw new Error("只有目标玩家可以拒绝干预。");

  addLog(game.pendingAttack.volunteerIds.length ? `${target.name} 拒绝所有干预。` : `无人干预，${target.name} 必须自己承伤。`);
  startDamage({
    targetId: target.id,
    sourceId: game.pendingAttack.attackerId,
    amount: 1,
    forcedRevealMarker: null,
    nextPlayerId: target.id,
    label: "攻击伤害",
    suppressRankAbility: false,
    triggerContext: "normal",
    protectedTargetId: null,
    attackSourceId: game.pendingAttack.attackerId,
  });
  broadcastAllViews();
}

function revealMarker(connection, marker) {
  const game = requireGame();
  requirePhase("reveal");
  const player = getActivePlayer(connection.playerId);
  if (player.id !== game.pendingDamage.targetId) throw new Error("只有受伤玩家可以公开标记。");
  if (!availableMarkers(player).includes(marker)) throw new Error("该标记不能公开。");
  if (game.pendingDamage.forcedRevealMarker && marker !== game.pendingDamage.forcedRevealMarker) {
    throw new Error("本次必须公开 Rank。");
  }

  applyReveal(player, marker);
  player.wounds += 1;
  addLog(`${player.name} 公开了 ${markerRevealLabel(lastReveal(player))}，当前伤害 ${player.wounds} / 4。`);
  handleGuardianThirdWound(player);

  if (player.wounds >= 4) {
    capturePlayer(player, getPlayer(game.pendingDamage.sourceId));
    broadcastAllViews();
    return;
  }

  const suppress = game.pendingDamage.suppressRankAbility;
  if (marker === "rank" && !suppress && beginRankAbility(player)) {
    broadcastAllViews();
    return;
  }
  if (marker === "rank" && suppress) {
    addLog(`${player.name} 因技能伤害公开 Rank，但不会触发角色能力。`);
  }

  game.pendingDamage.remaining -= 1;
  if (game.pendingDamage.remaining > 0) {
    advanceDamage();
  } else {
    finishDamage(game.pendingDamage.nextPlayerId);
  }
  broadcastAllViews();
}

function useAssassinSkill(connection, targetId) {
  const game = requireGame();
  requireAbility(connection, "assassin");
  const assassin = getPlayer(connection.playerId);
  const target = getActivePlayer(targetId);
  if (target.id === assassin.id) throw new Error("不能刺杀自己。");
  if (isProtectedFromTargeting(target)) throw new Error("该玩家受到盾牌保护，不能被能力伤害。");

  addLog(`${assassin.name} 发动刺客能力，指定 ${target.name} 受到 2 点直接伤害。`);
  game.pendingAbility = null;
  startDamage({
    targetId: target.id,
    sourceId: assassin.id,
    amount: 2,
    forcedRevealMarker: null,
    nextPlayerId: target.id,
    label: "刺客技能伤害",
    suppressRankAbility: true,
    triggerContext: "skill",
    protectedTargetId: null,
    attackSourceId: assassin.id,
  });
  broadcastAllViews();
}

function selectHarlequinTarget(connection, targetId) {
  const game = requireGame();
  requireAbility(connection, "harlequin");
  const harlequin = getPlayer(connection.playerId);
  const target = getActivePlayer(targetId);
  if (target.id === harlequin.id) throw new Error("不能偷看自己。");
  if (game.pendingAbility.selectedIds.includes(target.id)) throw new Error("不能重复偷看同一名玩家。");

  game.pendingAbility.selectedIds.push(target.id);
  if (!harlequin.privateIntel.some((entry) => entry.targetId === target.id)) {
    harlequin.privateIntel.push({ targetId: target.id });
  }
  addPrivateLog(harlequin.id, `${harlequin.name} 偷看结果：${target.name} 是 ${fullRoleLabel(target)}。`);

  if (game.pendingAbility.selectedIds.length >= 2) {
    game.pendingAbility = null;
    finishDamage(harlequin.id);
  }
  broadcastAllViews();
}

function useAlchemist(connection, mode, marker) {
  const game = requireGame();
  requireAbility(connection, "alchemist");
  const alchemist = getPlayer(connection.playerId);
  const target = getActivePlayer(game.pendingAbility.protectedTargetId);
  if (!["heal", "harm"].includes(mode)) throw new Error("炼金术士必须选择治疗或伤害。");

  game.pendingAbility = null;
  if (mode === "heal") {
    if (target.wounds > 0) target.wounds -= 1;
    const removeIndex = marker
      ? target.revealed.findIndex((entry) => entry.marker === marker)
      : target.revealed.length - 1;
    const removed = removeIndex >= 0 ? target.revealed.splice(removeIndex, 1)[0] : null;
    addLog(`${alchemist.name} 发动炼金术士能力，治疗 ${target.name} 1 点伤害${removed ? `，并收回 ${markerRevealLabel(removed)}` : ""}。`);
    finishDamage(alchemist.id);
  } else {
    if (isProtectedFromTargeting(target)) throw new Error("该玩家受到盾牌保护，不能被能力伤害。");
    addLog(`${alchemist.name} 发动炼金术士能力，使 ${target.name} 受到 1 点能力伤害。`);
    startDamage({
      targetId: target.id,
      sourceId: alchemist.id,
      amount: 1,
      forcedRevealMarker: null,
      nextPlayerId: target.id,
      label: "炼金术士能力伤害",
      suppressRankAbility: true,
      triggerContext: "skill",
      protectedTargetId: null,
      attackSourceId: alchemist.id,
    });
  }
  broadcastAllViews();
}

function useOracle(connection, targetId) {
  const game = requireGame();
  requireAbility(connection, "oracle");
  const oracle = getPlayer(connection.playerId);
  const target = getActivePlayer(targetId);
  if (target.id === oracle.id) throw new Error("灵喻师不能指定自己。");
  if (isProtectedFromTargeting(target)) throw new Error("该玩家受到盾牌保护，不能被能力伤害。");

  addLog(`${oracle.name} 发动灵喻师能力，指定 ${target.name} 受到 1 点不可干预能力伤害。`);
  game.pendingAbility = null;
  startDamage({
    targetId: target.id,
    sourceId: oracle.id,
    amount: 1,
    forcedRevealMarker: hasRevealed(target, "rank") ? null : "rank",
    nextPlayerId: target.id,
    label: "灵喻师能力伤害",
    suppressRankAbility: true,
    triggerContext: "skill",
    protectedTargetId: null,
    attackSourceId: oracle.id,
  });
  broadcastAllViews();
}

function useGuardian(connection, targetId) {
  const game = requireGame();
  requireAbility(connection, "guardian");
  const guardian = getPlayer(connection.playerId);
  const target = getActivePlayer(targetId);
  if (target.id === guardian.id) throw new Error("守卫不能把盾牌交给自己。");

  addItem("shield", target.id, guardian.id);
  addItem("sword", guardian.id, guardian.id);
  addLog(`${guardian.name} 发动守卫能力，将盾牌交给 ${target.name}，并将长剑放到自己面前。`);
  game.pendingAbility = null;
  finishDamage(guardian.id);
  broadcastAllViews();
}

function useMage(connection, targetId) {
  const game = requireGame();
  requireAbility(connection, "mage");
  const mage = getPlayer(connection.playerId);
  const target = getActivePlayer(targetId);
  if (target.id === mage.id) throw new Error("法师必须选择另一名玩家。");

  addItem("staff", mage.id, mage.id);
  addItem("staff", target.id, mage.id);
  addLog(`${mage.name} 发动法师能力，将法杖交给自己和 ${target.name}。`);
  game.pendingAbility = null;
  finishDamage(mage.id);
  broadcastAllViews();
}

function useCourtesan(connection, targetId) {
  const game = requireGame();
  requireAbility(connection, "courtesan");
  const courtesan = getPlayer(connection.playerId);
  const target = getActivePlayer(targetId);
  if (target.id === courtesan.id) throw new Error("舞妓不能把折扇交给自己。");

  addItem("fan", target.id, courtesan.id);
  addLog(`${courtesan.name} 发动舞妓能力，将折扇交给 ${target.name}。`);
  game.pendingAbility = null;
  finishDamage(courtesan.id);
  broadcastAllViews();
}

function sendChat(connection, text) {
  const game = requireGame();
  const player = getPlayer(connection.playerId);
  const cleanText = String(text || "").trim().slice(0, 200);
  if (!cleanText) return;
  game.chatMessages.push({
    id: nextLogIndex(),
    playerId: player.id,
    playerName: player.name,
    text: cleanText,
  });
  broadcastAllViews();
}

function startDamage(options) {
  const game = requireGame();
  game.pendingDamage = {
    targetId: options.targetId,
    sourceId: options.sourceId,
    remaining: options.amount,
    total: options.amount,
    forcedRevealMarker: options.forcedRevealMarker,
    nextPlayerId: options.nextPlayerId,
    label: options.label,
    suppressRankAbility: options.suppressRankAbility,
    triggerContext: options.triggerContext,
    protectedTargetId: options.protectedTargetId,
    attackSourceId: options.attackSourceId,
  };
  game.pendingAttack = null;
  advanceDamage();
}

function advanceDamage() {
  const game = requireGame();
  if (!game.pendingDamage) return;
  const target = getPlayer(game.pendingDamage.targetId);
  const source = getPlayer(game.pendingDamage.sourceId);
  if (target.wounds >= 3) {
    target.wounds = 4;
    addLog(`${target.name} 承受${game.pendingDamage.label}造成的第 4 点伤害，被捕获。`);
    capturePlayer(target, source);
    return;
  }
  game.phase = "reveal";
  addLog(`${target.name} 承受 1 点${game.pendingDamage.label}，需要公开${game.pendingDamage.forcedRevealMarker ? "Rank" : "一个未公开标记"}。`);
}

function finishDamage(nextPlayerId) {
  const game = requireGame();
  game.currentPlayerId = nextPlayerId;
  game.pendingAttack = null;
  game.pendingDamage = null;
  game.pendingAbility = null;
  game.phase = "action";
  addLog(`${playerName(nextPlayerId)} 获得匕首。`);
}

function beginRankAbility(player) {
  const game = requireGame();
  const context = game.pendingDamage?.triggerContext;
  const protectedTargetId = game.pendingDamage?.protectedTargetId;
  const attackSourceId = game.pendingDamage?.attackSourceId;
  const ability = player.ability;

  if (ability === "elder") {
    game.leaderRule[player.clan] = "highest";
    addLog(`${player.name} 发动长老能力，本氏族领袖判定改为 Rank 最高者。`);
    return false;
  }
  if (ability === "assassin") {
    game.phase = "ability";
    game.pendingAbility = { type: "assassin", playerId: player.id };
    addLog(`${player.name} 触发刺客能力。`);
    return true;
  }
  if (ability === "harlequin") {
    game.phase = "ability";
    game.pendingAbility = { type: "harlequin", playerId: player.id, selectedIds: [] };
    addLog(`${player.name} 触发小丑能力。`);
    return true;
  }
  if (ability === "alchemist" && context === "intervention" && protectedTargetId) {
    game.phase = "ability";
    game.pendingAbility = { type: "alchemist", playerId: player.id, protectedTargetId };
    addLog(`${player.name} 触发炼金术士能力。`);
    return true;
  }
  if (ability === "alchemist") {
    addLog(`${player.name} 公开 Rank，但炼金术士能力只在干预承伤时触发。`);
    return false;
  }
  if (ability === "oracle") {
    game.phase = "ability";
    game.pendingAbility = { type: "oracle", playerId: player.id };
    addLog(`${player.name} 触发灵喻师能力。`);
    return true;
  }
  if (ability === "guardian") {
    game.phase = "ability";
    game.pendingAbility = { type: "guardian", playerId: player.id };
    addLog(`${player.name} 触发守卫能力。`);
    return true;
  }
  if (ability === "berserker") {
    const source = getActivePlayer(attackSourceId);
    addLog(`${player.name} 发动狂战士能力，反击 ${source.name} 1 点能力伤害。`);
    game.pendingAbility = null;
    startDamage({
      targetId: source.id,
      sourceId: player.id,
      amount: 1,
      forcedRevealMarker: null,
      nextPlayerId: player.id,
      label: "狂战士反击伤害",
      suppressRankAbility: true,
      triggerContext: "skill",
      protectedTargetId: null,
      attackSourceId: player.id,
    });
    return true;
  }
  if (ability === "mage") {
    game.phase = "ability";
    game.pendingAbility = { type: "mage", playerId: player.id };
    addLog(`${player.name} 触发法师能力。`);
    return true;
  }
  if (ability === "courtesan") {
    game.phase = "ability";
    game.pendingAbility = { type: "courtesan", playerId: player.id };
    addLog(`${player.name} 触发舞妓能力。`);
    return true;
  }
  return false;
}

function capturePlayer(target, capturer) {
  const game = requireGame();
  const targetIsEnemyLeader = target.clan !== capturer.clan && isLeader(target);
  const winnerClan = targetIsEnemyLeader ? capturer.clan : oppositeClan(capturer.clan);
  target.captured = true;
  game.phase = "gameover";
  game.winner = winnerClan;
  game.pendingAttack = null;
  game.pendingDamage = null;
  game.pendingAbility = null;
  addLog(`${target.name} 被捕获，真实身份是 ${fullRoleLabel(target)}。`);
  addLog(`${clanName(winnerClan)} 胜利。`);
}

function viewFor(connection) {
  const selfId = connection.playerId;
  const game = room.game;
  return {
    type: "gameView",
    selfId,
    isHost: room.hostConnectionId === connection.id,
    room: {
      config: room.config,
      roleDirectory: roleDirectory(),
      seats: room.seats.map((seat) => ({
        playerId: seat.playerId,
        name: seat.name,
        connected: seat.connected,
      })),
      canStart: room.seats.length === room.config.playerCount && !game && room.hostConnectionId === connection.id,
    },
    game: game && selfId ? scopedGameView(selfId) : null,
  };
}

function scopedGameView(selfId) {
  const game = requireGame();
  const self = getPlayer(selfId);
  const clueTarget = getPlayer(nextSeatId(selfId));
  return {
    phase: game.phase,
    playerCount: game.players.length,
    currentPlayerId: game.currentPlayerId,
    pendingAttack: game.pendingAttack,
    pendingAbility: publicPendingAbility(game.pendingAbility),
    pendingDamage: game.pendingDamage ? {
      targetId: game.pendingDamage.targetId,
      forcedRevealMarker: game.pendingDamage.forcedRevealMarker,
      label: game.pendingDamage.label,
    } : null,
    winner: game.winner,
    nextReadyIds: game.nextReadyIds || [],
    restartVote: game.restartVote ? {
      requesterId: game.restartVote.requesterId,
      requesterName: playerName(game.restartVote.requesterId),
      yesIds: game.restartVote.yesIds,
      noIds: game.restartVote.noIds,
    } : null,
    self: self ? {
      id: self.id,
      name: self.name,
      identity: fullRoleLabel(self),
      clueTargetId: clueTarget?.id,
      clueTargetName: clueTarget?.name,
      clue: clueTarget?.clue,
      items: itemViewsFor(self.id),
      privateIntel: (self.privateIntel || []).map((entry) => {
        const target = getPlayer(entry.targetId);
        return target ? { targetId: target.id, targetName: target.name, identity: fullRoleLabel(target) } : null;
      }).filter(Boolean),
    } : null,
    players: game.players.map((player) => playerViewFor(selfId, player)),
    publicLogs: game.publicLogs,
    privateLogs: game.privateLogs?.[selfId] || [],
    chatMessages: game.chatMessages,
  };
}

function publicPendingAbility(pendingAbility) {
  if (!pendingAbility) return null;
  return { ...pendingAbility };
}

function playerViewFor(selfId, player) {
  const visibleIdentity =
    player.id === selfId ||
    player.captured ||
    (getPlayer(selfId)?.privateIntel || []).some((entry) => entry.targetId === player.id)
      ? fullRoleLabel(player)
      : null;
  return {
    id: player.id,
    name: player.name,
    connected: isSeatConnected(player.id),
    wounds: player.wounds,
    revealed: player.revealed.map((entry) => ({
      marker: entry.marker,
      type: entry.shownType,
      label: markerRevealLabel(entry),
    })),
    captured: player.captured,
    visibleIdentity,
    visualIdentity: visualIdentityFor(selfId, player, visibleIdentity),
    badge: badgeFor(player.id),
    items: itemViewsFor(player.id),
    availableActions: availableActionsFor(selfId, player),
  };
}

function isSeatConnected(playerId) {
  return Boolean(room.seats.find((seat) => seat.playerId === playerId)?.connected);
}

function visualIdentityFor(selfId, player, visibleIdentity) {
  const rankEntry = player.revealed.find((entry) => markerType(entry.marker) === "rank");
  const clanEntry = player.revealed.find((entry) => entry.shownType === "rose" || entry.shownType === "beast");
  const visual = {};
  if (visibleIdentity || rankEntry) {
    visual.rank = player.rank;
    visual.role = player.role;
    visual.ability = player.ability;
  }
  if (visibleIdentity) {
    visual.clan = player.clan;
    visual.clanName = player.clanName;
  } else if (clanEntry) {
    visual.clan = clanEntry.shownType === "rose" ? "Rose" : "Beast";
    visual.clanName = clanName(visual.clan);
  }
  return Object.keys(visual).length ? visual : null;
}

function availableActionsFor(selfId, target) {
  const game = requireGame();
  if (!selfId || target.captured || game.phase === "gameover") return [];
  const actions = [];
  if (game.phase === "action" && selfId === game.currentPlayerId && target.id !== selfId) {
    if (!isProtectedFromTargeting(target)) actions.push({ type: "attack", label: "攻击" });
    actions.push({ type: "pass", label: "传递" });
  }
  if (game.phase === "intervention" && game.pendingAttack) {
    if (target.id === selfId && eligibleInterveners().some((player) => player.id === selfId)) {
      actions.push({ type: "offerIntervention", label: "提出干预" });
    }
    if (selfId === game.pendingAttack.targetId && game.pendingAttack.volunteerIds.includes(target.id)) {
      actions.push({ type: "acceptIntervention", label: "接受干预" });
    }
    if (target.id === selfId && selfId === game.pendingAttack.targetId) {
      actions.push({ type: "rejectIntervention", label: "拒绝干预" });
    }
  }
  if (game.phase === "reveal" && target.id === selfId && game.pendingDamage?.targetId === selfId) {
    const player = getPlayer(selfId);
    const markers = game.pendingDamage.forcedRevealMarker ? [game.pendingDamage.forcedRevealMarker] : availableMarkers(player);
    markers.forEach((marker) => actions.push({ type: "revealMarker", marker, label: `公开 ${previewMarkerLabel(player, marker)}` }));
  }
  if (game.phase === "ability" && game.pendingAbility?.playerId === selfId) {
    const ability = game.pendingAbility.type;
    if (ability === "assassin" && target.id !== selfId && !isProtectedFromTargeting(target)) actions.push({ type: "useAssassinSkill", label: "刺杀" });
    if (ability === "harlequin" && target.id !== selfId && !game.pendingAbility.selectedIds.includes(target.id)) actions.push({ type: "selectHarlequinTarget", label: "偷看" });
    if (ability === "alchemist" && target.id === game.pendingAbility.protectedTargetId) {
      if (target.wounds > 0 && target.revealed.length) {
        target.revealed.forEach((entry) => {
          actions.push({ type: "useAlchemist", mode: "heal", marker: entry.marker, label: `治疗收回 ${markerRevealLabel(entry)}` });
        });
      } else {
        actions.push({ type: "useAlchemist", mode: "heal", label: "治疗" });
      }
      if (!isProtectedFromTargeting(target)) actions.push({ type: "useAlchemist", mode: "harm", label: "伤害" });
    }
    if (ability === "oracle" && target.id !== selfId && !isProtectedFromTargeting(target)) actions.push({ type: "useOracle", label: "灵喻" });
    if (ability === "guardian" && target.id !== selfId) actions.push({ type: "useGuardian", label: "给盾牌" });
    if (ability === "mage" && target.id !== selfId) actions.push({ type: "useMage", label: "给法杖" });
    if (ability === "courtesan" && target.id !== selfId) actions.push({ type: "useCourtesan", label: "给折扇" });
  }
  return actions;
}

function badgeFor(playerId) {
  const game = room.game;
  if (!game) return null;
  if (game.phase === "intervention" && game.pendingAttack) {
    if (playerId === game.pendingAttack.attackerId) return "attacking";
    if (playerId === game.pendingAttack.targetId) return "targeted";
  }
  return playerId === game.currentPlayerId ? "dagger" : null;
}

function eligibleInterveners() {
  const game = requireGame();
  if (!game.pendingAttack) return [];
  const target = getPlayer(game.pendingAttack.targetId);
  if (hasItem(target.id, "fan")) return [];
  return game.players.filter(
    (player) =>
      !player.captured &&
      player.id !== game.pendingAttack.attackerId &&
      player.id !== game.pendingAttack.targetId &&
      !hasRevealed(player, "rank") &&
      !game.pendingAttack.volunteerIds.includes(player.id),
  );
}

function availableMarkers(player) {
  return player.markers.filter((marker) => !player.revealed.some((entry) => entry.marker === marker));
}

function applyReveal(player, marker) {
  const baseType = markerType(marker);
  const shownType = hasItem(player.id, "staff") && (baseType === "rose" || baseType === "beast") ? "unknown" : baseType;
  player.revealed.push({ marker, shownType, label: previewMarkerLabel(player, marker) });
}

function lastReveal(player) {
  return player.revealed[player.revealed.length - 1];
}

function markerType(marker) {
  if (marker === "rank") return "rank";
  if (marker.startsWith("rose")) return "rose";
  if (marker.startsWith("beast")) return "beast";
  if (marker.startsWith("unknown")) return "unknown";
  return marker;
}

function hasRevealed(player, type) {
  return player.revealed.some((entry) => markerType(entry.marker) === type);
}

function previewMarkerLabel(player, marker) {
  const type = markerType(marker);
  if (type === "rank") return `Rank ${player.rank}`;
  if (hasItem(player.id, "staff") && (type === "rose" || type === "beast")) return "?";
  if (type === "rose") return "红色阵营";
  if (type === "beast") return "蓝色阵营";
  return "?";
}

function markerRevealLabel(entry) {
  if (!entry) return "";
  if (entry.label) return entry.label;
  if (markerType(entry.marker) === "rank") return "Rank";
  if (entry.shownType === "rose") return "红色阵营";
  if (entry.shownType === "beast") return "蓝色阵营";
  if (entry.shownType === "rank") return "Rank";
  return "?";
}

function buildRoleDeck() {
  const half = room.config.playerCount / 2;
  const roseRanks = room.config.mode === "custom" ? room.config.roseRanks : randomRanks(half);
  const beastRanks = room.config.mode === "custom" ? room.config.beastRanks : randomRanks(half);
  return [
    ...roseRanks.map((rank) => makeRole("Rose", rank)),
    ...beastRanks.map((rank) => makeRole("Beast", rank)),
  ];
}

function makeRole(clan, rank) {
  const def = ROLE_DEFS[rank];
  const clueClan = def.clue === "opposite" ? oppositeClan(clan) : clan;
  return {
    clan,
    clanName: clanName(clan),
    rank,
    role: def.role,
    ability: def.ability,
    clue: CLUE_BY_CLAN[clueClan],
    markers: def.markers.map((type, index) => {
      if (type === "clan") return `${clan === "Rose" ? "rose" : "beast"}${index + 1}`;
      if (type === "unknown") return `unknown${index + 1}`;
      return "rank";
    }),
  };
}

function roleDirectory() {
  return Object.entries(ROLE_DEFS).map(([rank, def]) => ({ rank: Number(rank), role: def.role, markers: def.markers, clue: def.clue, ability: def.ability }));
}

function fullRoleLabel(player) {
  return `${player.clanName} / ${player.role} / Rank ${player.rank}`;
}

function isLeader(player) {
  const game = requireGame();
  const clanPlayers = game.players.filter((candidate) => candidate.clan === player.clan);
  const ranks = clanPlayers.map((candidate) => candidate.rank);
  const leaderRank = game.leaderRule[player.clan] === "highest" ? Math.max(...ranks) : Math.min(...ranks);
  return player.rank === leaderRank;
}

function addItem(type, holderId, sourceId) {
  const game = requireGame();
  game.items.push({ id: game.nextItemId++, type, holderId, sourceId });
}

function hasItem(playerId, type) {
  return itemViewsFor(playerId).some((item) => item.type === type);
}

function itemViewsFor(playerId) {
  const game = room.game;
  if (!game) return [];
  return game.items.filter((item) => item.holderId === playerId).map((item) => ({ ...item, label: itemLabel(item.type) }));
}

function itemLabel(type) {
  return { shield: "盾牌", sword: "长剑", staff: "法杖", fan: "折扇" }[type] || type;
}

function isProtectedFromTargeting(player) {
  return hasItem(player.id, "shield");
}

function handleGuardianThirdWound(player) {
  const game = requireGame();
  if (player.ability !== "guardian" || player.wounds !== 3) return;
  const before = game.items.length;
  game.items = game.items.filter((item) => !(item.type === "shield" && item.sourceId === player.id));
  if (game.items.length !== before) addLog(`${player.name} 受到第 3 点伤害，收回自己来源的盾牌。`);
}

function addLog(text) {
  const game = requireGame();
  game.publicLogs.push({ id: nextLogIndex(), text });
}

function addPrivateLog(playerId, text) {
  const game = requireGame();
  if (!game.privateLogs[playerId]) game.privateLogs[playerId] = [];
  game.privateLogs[playerId].push({ id: nextLogIndex(), text });
}

function nextLogIndex() {
  const game = requireGame();
  game.logIndex += 1;
  return game.logIndex;
}

function broadcastAllViews() {
  for (const connection of room.connections.values()) send(connection, viewFor(connection));
}

function disconnect(connection) {
  if (!room.connections.has(connection.id)) return;
  room.connections.delete(connection.id);
  const seat = room.seats.find((item) => item.connectionId === connection.id);
  if (seat) seat.connected = false;
  broadcastAllViews();
}

function createReconnectToken() {
  return randomBytes(24).toString("hex");
}

function requireHost(connection) {
  if (room.hostConnectionId !== connection.id) throw new Error("只有房主可以执行该操作。");
}

function requireGame() {
  if (!room.game) throw new Error("游戏尚未开始。");
  return room.game;
}

function requirePhase(phase) {
  if (requireGame().phase !== phase) throw new Error("当前阶段不能执行该操作。");
}

function requirePlayer(connection, playerId) {
  if (connection.playerId !== playerId) throw new Error("当前不是你的操作。");
}

function requireAbility(connection, type) {
  const game = requireGame();
  requirePhase("ability");
  if (game.pendingAbility?.type !== type) throw new Error("当前不是该角色能力阶段。");
  requirePlayer(connection, game.pendingAbility.playerId);
}

function getPlayer(playerId) {
  return requireGame().players.find((player) => player.id === playerId);
}

function getActivePlayer(playerId) {
  const player = getPlayer(playerId);
  if (!player || player.captured) throw new Error("目标玩家不存在或已被捕获。");
  return player;
}

function playerName(playerId) {
  return getPlayer(playerId)?.name || `玩家 ${playerId}`;
}

function nextSeatId(playerId) {
  const game = requireGame();
  const ids = game.players.map((player) => player.id).sort((a, b) => a - b);
  const index = ids.indexOf(playerId);
  return ids[(index + 1) % ids.length];
}

function firstAvailableSeatId() {
  for (let id = 1; id <= room.config.playerCount; id += 1) {
    if (!room.seats.some((seat) => seat.playerId === id)) return id;
  }
  return room.seats.length + 1;
}

function normalizeRanks(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((rank) => Number.isInteger(rank) && rank >= 1 && rank <= 9))].sort((a, b) => a - b);
}

function validateRankSet(ranks, expected, label) {
  if (ranks.length !== expected) throw new Error(`${label}阵营需要选择 ${expected} 个 Rank。`);
}

function defaultRanks(count) {
  return Array.from({ length: count }, (_, index) => index + 1);
}

function randomRanks(count) {
  return shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, count).sort((a, b) => a - b);
}

function oppositeClan(clan) {
  return clan === "Rose" ? "Beast" : "Rose";
}

function clanName(clan) {
  return CLAN_NAMES[clan];
}

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const randomIndex = randomInt(index + 1);
    [items[index], items[randomIndex]] = [items[randomIndex], items[index]];
  }
  return items;
}

function randomInt(maxExclusive) {
  return randomBytes(4).readUInt32BE(0) % maxExclusive;
}
