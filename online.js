const state = {
  socket: null,
  connected: false,
  selfId: null,
  isHost: false,
  view: null,
  error: "",
  reconnecting: false,
  reconnectTimer: null,
  reconnectAttempts: 0,
  joinNameDraft: "",
  keepAwake: false,
  wakeLock: null,
};

const els = {
  app: document.querySelector(".app"),
  leftPlayersGrid: document.querySelector("#leftPlayersGrid"),
  rightPlayersGrid: document.querySelector("#rightPlayersGrid"),
  centerTopPlayer: document.querySelector("#centerTopPlayer"),
  centerBottomPlayer: document.querySelector("#centerBottomPlayer"),
  statusPanel: document.querySelector("#statusPanel"),
  intelPanel: document.querySelector("#intelPanel"),
  actionHint: document.querySelector("#actionHint"),
  actionControls: document.querySelector("#actionControls"),
  chatList: document.querySelector("#chatList"),
  chatInput: document.querySelector("#chatInput"),
  sendChatBtn: document.querySelector("#sendChatBtn"),
  logList: document.querySelector("#logList"),
  logHint: document.querySelector("#logHint"),
  joinPanel: document.querySelector("#joinPanel"),
  newGameBtn: document.querySelector("#newGameBtn"),
  restartRejectBtn: document.querySelector("#restartRejectBtn"),
  generalRulesBtn: document.querySelector("#generalRulesBtn"),
  roleBoardBtn: document.querySelector("#roleBoardBtn"),
  roomSettingsBtn: document.querySelector("#roomSettingsBtn"),
  keepAwakeBtn: document.querySelector("#keepAwakeBtn"),
  victoryOverlay: document.querySelector("#victoryOverlay"),
  identityModal: document.querySelector("#identityModal"),
  modalTitle: document.querySelector("#modalTitle"),
  modalBody: document.querySelector("#modalBody"),
  closeModalBtn: document.querySelector("#closeModalBtn"),
};

const ROLE_ART = {
  1: "assets/optimized-sm/roles/elder.webp",
  2: "assets/optimized-sm/roles/assassin.webp",
  3: "assets/optimized-sm/roles/harlequin.webp",
  4: "assets/optimized-sm/roles/alchemist.webp",
  5: "assets/optimized-sm/roles/oracle.webp",
  6: "assets/optimized-sm/roles/guardian.webp",
  7: "assets/optimized-sm/roles/berserker.webp",
  8: "assets/optimized-sm/roles/mage.webp",
  9: "assets/optimized-sm/roles/courtesan.webp",
};

const ROLE_ART_HD = {
  1: "assets/optimized/roles/elder.webp",
  2: "assets/optimized/roles/assassin.webp",
  3: "assets/optimized/roles/harlequin.webp",
  4: "assets/optimized/roles/alchemist.webp",
  5: "assets/optimized/roles/oracle.webp",
  6: "assets/optimized/roles/guardian.webp",
  7: "assets/optimized/roles/berserker.webp",
  8: "assets/optimized/roles/mage.webp",
  9: "assets/optimized/roles/courtesan.webp",
};

const ROLE_BOARD_TUNE_KEY = "bloodbound.roleBoardTune.v1";
const DEFAULT_ROLE_TUNE = { scale: 100, x: 50, y: 50 };

const ITEM_ART = {
  shield: "assets/optimized/items/shield.webp",
  sword: "assets/optimized/items/sword.webp",
  staff: "assets/optimized/items/staff.webp",
  fan: "assets/optimized/items/fan.webp",
};

const ACTION_ART = {
  attack: "assets/optimized/actions/attack.webp",
  dagger: "assets/optimized/actions/dagger.webp",
  pass: "assets/optimized/actions/pass.webp",
  offerIntervention: "assets/optimized/actions/intervene.webp",
  acceptIntervention: "assets/optimized/actions/intervene.webp",
  rejectIntervention: "assets/optimized/actions/take-damage.webp",
  revealMarker: "assets/optimized/actions/reveal.webp",
  useAssassinSkill: "assets/optimized/actions/attack.webp",
  selectHarlequinTarget: "assets/optimized/actions/reveal.webp",
  useAlchemist: "assets/optimized/actions/reveal.webp",
  useOracle: "assets/optimized/actions/attack.webp",
  useGuardian: "assets/optimized/items/shield.webp",
  useMage: "assets/optimized/items/staff.webp",
  useCourtesan: "assets/optimized/items/fan.webp",
  privateInfo: "assets/optimized/actions/reveal.webp",
  readyNextRound: "assets/optimized/actions/next-round.webp",
};

const CARD_BACK_ART = "assets/card-backs/hidden-card.svg";
const BOARD_UI_SETTINGS_KEY = "bloodbound.boardUiSettings.v1";
const RECONNECT_KEY = "bloodbound.reconnect.v1";
const DEFAULT_BOARD_UI_SETTINGS = { iconSize: 22, fontSize: 12, itemSize: 28 };
const boardUiSettings = loadBoardUiSettings();
const loadedImages = new Set();

applyBoardUiSettings();
preloadEssentialAssets();
connect();
bindStaticEvents();
render();

function connect() {
  if (state.socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(state.socket.readyState)) return;
  clearTimeout(state.reconnectTimer);
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
  state.socket = socket;

  socket.addEventListener("open", () => {
    if (state.socket !== socket) return;
    state.connected = true;
    state.reconnectAttempts = 0;
    state.error = "";
    tryReconnect();
    render();
  });

  socket.addEventListener("close", () => {
    if (state.socket !== socket) return;
    state.connected = false;
    state.socket = null;
    state.error = "已断开连接，重新打开页面后会尝试回到原座位。";
    state.error = "连接断开，正在自动重连。";
    scheduleReconnect();
    render();
  });

  socket.addEventListener("message", (event) => {
    if (state.socket !== socket) return;
    const message = JSON.parse(event.data);
    if (message.type === "ping") {
      send("pong");
      return;
    }
    if (message.type === "joined") {
      state.selfId = message.playerId;
      state.isHost = Boolean(message.isHost);
      state.reconnecting = false;
      state.pendingReconnectName = "";
      if (message.reconnectToken) saveReconnectInfo(message.playerId, message.reconnectToken, message.name);
    }
    if (message.type === "gameView") {
      state.view = message;
      state.selfId = message.selfId || state.selfId;
      state.isHost = Boolean(message.isHost);
      state.error = "";
    }
    if (message.type === "error") {
      state.error = message.message || "操作失败。";
      if (state.reconnecting && message.code === "reconnect_invalid_token") {
        state.reconnecting = false;
        clearReconnectInfo(state.pendingReconnectName);
      } else if (state.reconnecting) {
        state.reconnecting = false;
      }
      state.pendingReconnectName = "";
    }
    render();
  });
}

function scheduleReconnect() {
  clearTimeout(state.reconnectTimer);
  const delay = Math.min(3000, 600 * 2 ** state.reconnectAttempts);
  state.reconnectAttempts += 1;
  state.reconnectTimer = setTimeout(connect, delay);
}

function preloadEssentialAssets() {
  [
    CARD_BACK_ART,
    ACTION_ART.attack,
    ACTION_ART.pass,
    ACTION_ART.privateInfo,
    ACTION_ART.dagger,
    ROLE_ART[1],
  ].forEach(preloadImage);
}

function preloadAllRoleArt() {
  Object.values(ROLE_ART).forEach(preloadImage);
}

function preloadImage(src) {
  if (!src || loadedImages.has(src)) return;
  const image = new Image();
  image.onload = () => {
    loadedImages.add(src);
    renderLoadedImage(src);
  };
  image.onerror = () => loadedImages.add(src);
  image.src = src;
}

function renderLoadedImage(src) {
  document.querySelectorAll(`[data-bg-src="${cssEscape(src)}"]`).forEach((element) => {
    element.style.setProperty("--loaded-card-art", `url('${src}')`);
    element.classList.add("image-loaded");
  });
  document.querySelectorAll(`[data-role-bg-src="${cssEscape(src)}"]`).forEach((element) => {
    element.style.setProperty("--loaded-role-art", `url('${src}')`);
    element.classList.add("image-loaded");
  });
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function tryReconnect() {
  if (state.selfId) return;
  const store = loadReconnectStore();
  if (Object.keys(store.byName || {}).length > 1) return;
  const info = loadReconnectInfo();
  if (!info) return;
  state.reconnecting = true;
  send("reconnectRoom", info);
}

function loadReconnectStore() {
  try {
    return JSON.parse(localStorage.getItem(RECONNECT_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function loadReconnectInfo(name = "") {
  const store = loadReconnectStore();
  const cleanName = String(name || "").trim();
  const byName = cleanName ? store.byName?.[cleanName] : null;
  const info = byName || store.last;
  if (!info?.playerId || !info?.reconnectToken) return null;
  return { playerId: Number(info.playerId), reconnectToken: String(info.reconnectToken) };
}

function saveReconnectInfo(playerId, reconnectToken, name = "") {
  const store = loadReconnectStore();
  const info = { playerId, reconnectToken, name: String(name || "").trim() };
  const byName = { ...(store.byName || {}) };
  if (info.name) byName[info.name] = info;
  localStorage.setItem(RECONNECT_KEY, JSON.stringify({ last: info, byName }));
}

function clearReconnectInfo(name = "") {
  const store = loadReconnectStore();
  const byName = { ...(store.byName || {}) };
  const cleanName = String(name || store.last?.name || "").trim();
  if (cleanName) delete byName[cleanName];
  const last = store.last?.name === cleanName ? null : store.last;
  localStorage.setItem(RECONNECT_KEY, JSON.stringify({ last, byName }));
}

function reconnectByName(name) {
  const cleanName = String(name || "").trim();
  if (!cleanName) {
    state.error = "请输入要重连的昵称。";
    render();
    return;
  }
  const info = loadReconnectInfo(name);
  state.reconnecting = true;
  state.pendingReconnectName = cleanName;
  if (info) {
    send("reconnectRoom", info);
    return;
  }
  send("reconnectByName", { name: cleanName });
}

function bindStaticEvents() {
  els.newGameBtn.addEventListener("click", handleTopGameButton);
  els.restartRejectBtn?.addEventListener("click", () => send("rejectRestart"));
  els.keepAwakeBtn?.addEventListener("click", toggleWakeLock);
  els.sendChatBtn.addEventListener("click", sendChat);
  els.chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendChat();
  });
  els.generalRulesBtn.addEventListener("click", () => openRulesModal("general"));
  els.roleBoardBtn.addEventListener("click", () => openRulesModal("roles"));
  els.roomSettingsBtn?.addEventListener("click", openRoomSettingsModal);
  els.closeModalBtn.addEventListener("click", closeModal);
  els.identityModal.addEventListener("click", (event) => {
    if (event.target === els.identityModal) closeModal();
  });

  document.addEventListener("click", (event) => {
    const privateButton = event.target.closest("[data-modal='private-info']");
    if (privateButton) {
      openPrivateInfoModal();
      return;
    }

    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const payload = {};
    if (button.dataset.targetId) payload.targetId = Number(button.dataset.targetId);
    if (button.dataset.volunteerId) payload.volunteerId = Number(button.dataset.volunteerId);
    if (button.dataset.marker) payload.marker = button.dataset.marker;
    if (button.dataset.mode) payload.mode = button.dataset.mode;
    send(action, payload);
  });

  document.addEventListener("visibilitychange", handleVisibilityRestore);
  window.addEventListener("pageshow", handleVisibilityRestore);
  window.addEventListener("focus", handleVisibilityRestore);
  window.addEventListener("online", handleVisibilityRestore);
}

async function toggleWakeLock() {
  if (state.keepAwake) {
    await releaseWakeLock(true);
    return;
  }
  await requestWakeLock();
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) {
    state.error = "当前浏览器不支持保持亮屏；息屏后会自动尝试重连。";
    render();
    return false;
  }
  if (document.visibilityState !== "visible") return false;
  try {
    const sentinel = await navigator.wakeLock.request("screen");
    state.keepAwake = true;
    state.wakeLock = sentinel;
    sentinel.addEventListener("release", () => {
      if (state.wakeLock === sentinel) state.wakeLock = null;
      updateWakeLockButton();
    });
    state.error = "";
    updateWakeLockButton();
    render();
    return true;
  } catch {
    state.error = "保持亮屏申请失败；请确认页面在 HTTPS 下打开，并保持浏览器在前台。";
    updateWakeLockButton();
    render();
    return false;
  }
}

async function releaseWakeLock(manual = false) {
  if (manual) state.keepAwake = false;
  const sentinel = state.wakeLock;
  state.wakeLock = null;
  try {
    await sentinel?.release();
  } catch {
    // The browser may already have released it when the page was hidden.
  }
  updateWakeLockButton();
  render();
}

function handleVisibilityRestore() {
  if (document.visibilityState && document.visibilityState !== "visible") return;
  ensureLiveConnection();
  if (state.keepAwake && !state.wakeLock) requestWakeLock();
}

function ensureLiveConnection() {
  if (!state.socket || state.socket.readyState === WebSocket.CLOSED || state.socket.readyState === WebSocket.CLOSING) {
    connect();
  }
}

function updateWakeLockButton() {
  if (!els.keepAwakeBtn) return;
  els.keepAwakeBtn.classList.toggle("active", Boolean(state.wakeLock));
  els.keepAwakeBtn.textContent = state.wakeLock ? "灭" : "亮";
  els.keepAwakeBtn.title = state.wakeLock ? "关闭保持亮屏" : "保持亮屏";
}

function send(type, payload = {}) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    state.error = "连接中断，正在自动重连。";
    scheduleReconnect();
    render();
    return;
  }
  state.socket.send(JSON.stringify({ type, ...payload }));
}

function sendChat() {
  const text = els.chatInput.value.trim();
  if (!text) return;
  send("sendChat", { text });
  els.chatInput.value = "";
}

function render() {
  const game = state.view?.game;
  els.app.classList.toggle("in-game", Boolean(game));
  updateWakeLockButton();
  updatePlayerCountClass();
  renderTopActions();
  renderIntel();
  renderPlayers();
  renderChat();
  renderLogs();
  renderAction();
  renderVictory();
}

function updatePlayerCountClass() {
  const count = state.view?.room?.config?.playerCount || state.view?.game?.players?.length || 6;
  els.app.classList.remove("player-count-6", "player-count-8", "player-count-10");
  els.app.classList.add(`player-count-${count}`);
}

function renderTopActions() {
  const room = state.view?.room;
  const game = state.view?.game;
  els.restartRejectBtn?.classList.add("hidden");
  els.restartRejectBtn && (els.restartRejectBtn.disabled = true);

  if (!game) {
    els.newGameBtn.textContent = "开始";
    els.newGameBtn.disabled = !room?.canStart;
    renderJoinPanel();
    return;
  }

  if (game.phase === "gameover") {
    els.newGameBtn.textContent = "游戏结束";
    els.newGameBtn.disabled = true;
    renderJoinPanel();
    return;
  }

  const vote = game.restartVote;
  if (!vote) {
    els.newGameBtn.textContent = "重开";
    els.newGameBtn.disabled = !state.selfId;
    renderJoinPanel();
    return;
  }

  if (vote.requesterId === state.selfId) {
    els.newGameBtn.textContent = "等待同意";
    els.newGameBtn.disabled = true;
  } else if (vote.yesIds.includes(state.selfId)) {
    els.newGameBtn.textContent = "已同意";
    els.newGameBtn.disabled = true;
  } else {
    els.newGameBtn.textContent = "同意";
    els.newGameBtn.disabled = false;
    els.restartRejectBtn?.classList.remove("hidden");
    els.restartRejectBtn && (els.restartRejectBtn.disabled = false);
  }
  renderJoinPanel();
}

function handleTopGameButton() {
  const game = state.view?.game;
  if (!game) {
    send("startGame");
    return;
  }
  if (game.phase === "gameover") return;
  if (!game.restartVote) {
    send("requestRestart");
    return;
  }
  if (game.restartVote.requesterId !== state.selfId && !game.restartVote.yesIds.includes(state.selfId)) {
    send("acceptRestart");
  }
}

function renderJoinPanel() {
  if (!els.joinPanel) return;
  if (!state.selfId) {
    let input = document.querySelector("#joinNameInput");
    if (!input) {
      els.joinPanel.innerHTML = `
      <div class="join-row compact-join-row">
        <input id="joinNameInput" type="text" maxlength="12" placeholder="昵称" />
        <button id="joinBtn" class="primary-btn" type="button">加入</button>
        <button id="reconnectBtn" class="primary-btn reconnect-btn" type="button">重连</button>
      </div>
      <p id="joinStatusText"></p>
    `;
      input = document.querySelector("#joinNameInput");
      const joinButton = document.querySelector("#joinBtn");
      const reconnectButton = document.querySelector("#reconnectBtn");
      input.value = state.joinNameDraft || "";
      input?.addEventListener("input", () => {
        state.joinNameDraft = input.value;
      });
      joinButton?.addEventListener("click", () => send("joinRoom", { name: input.value }));
      reconnectButton?.addEventListener("click", () => reconnectByName(input.value));
      input?.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && state.connected && !state.reconnecting) send("joinRoom", { name: input.value });
      });
    }
    const joinButton = document.querySelector("#joinBtn");
    const reconnectButton = document.querySelector("#reconnectBtn");
    const statusText = document.querySelector("#joinStatusText");
    const disabled = !state.connected || state.reconnecting;
    if (joinButton) joinButton.disabled = disabled;
    if (reconnectButton) reconnectButton.disabled = disabled;
    if (statusText) {
      statusText.textContent = state.reconnecting
        ? "正在重连..."
        : state.connected
          ? "已连接服务器"
          : "正在连接服务器...";
    }
    return;
  }
  els.joinPanel.innerHTML = `<p class="joined-summary">玩家 ${state.selfId}${state.isHost ? " / 房主" : ""}</p>`;
}

function renderIntel() {
  if (!state.selfId) {
    els.intelPanel.innerHTML = "";
    return;
  }

  if (!state.view?.game) {
    els.intelPanel.innerHTML = "";
    return;
  }

  els.intelPanel.innerHTML = "";
}

function roomStatusHtml() {
  const room = state.view?.room;
  const config = room?.config || { playerCount: 6, mode: "random", roseRanks: [1, 2, 3], beastRanks: [1, 2, 3] };
  const seats = room?.seats || [];
  if (!state.selfId) {
    return `
      <p>请先在顶部输入昵称并加入房间。</p>
      <p>连接状态：${state.connected ? "已连接本地服务" : "正在连接本地服务"}。</p>
    `;
  }
  return `
    <p>你是玩家 ${state.selfId}${state.isHost ? "，房主" : ""}。当前人数：${seats.length} / ${config.playerCount}。</p>
    ${hostDangerControlsHtml()}
    ${state.isHost ? roomConfigForm(config) : "<p>等待房主配置人数和角色池。</p>"}
    <div class="seat-list">
      ${Array.from({ length: config.playerCount }, (_, index) => {
        const seat = seats.find((item) => item.playerId === index + 1);
        return `<span class="seat-pill ${seat ? "" : "empty"}">玩家 ${index + 1}：${seat ? escapeHtml(seat.name) : "空位"}</span>`;
      }).join("")}
    </div>
  `;
}

function openRoomSettingsModal() {
  els.identityModal.classList.remove("hidden");
  const modalBox = els.identityModal.querySelector(".modal-box");
  modalBox?.classList.remove("role-board-mode", "private-info-mode");
  modalBox?.classList.add("room-settings-mode");
  els.modalTitle.textContent = "房间状态";
  renderRoomSettingsModal("room");
}

function renderRoomSettingsModal(activeTab) {
  els.modalBody.innerHTML = `
    <div class="settings-tabs" role="tablist" aria-label="设置类型">
      <button class="${activeTab === "room" ? "active" : ""}" type="button" data-settings-tab="room">房间状态</button>
      <button class="${activeTab === "board" ? "active" : ""}" type="button" data-settings-tab="board">玩家看板</button>
    </div>
    <div class="room-settings-modal">
      ${activeTab === "board" ? playerBoardSettingsHtml() : roomStatusHtml()}
    </div>
  `;
  bindRoomSettingsTabs();
  if (activeTab === "room") {
    bindRoomConfigForm();
    bindHostDangerControls();
  } else {
    bindPlayerBoardSettings();
  }
}

function bindRoomSettingsTabs() {
  document.querySelectorAll("[data-settings-tab]").forEach((button) => {
    button.addEventListener("click", () => renderRoomSettingsModal(button.dataset.settingsTab));
  });
}

function hostDangerControlsHtml() {
  const disabled = state.isHost ? "" : "disabled";
  const title = state.isHost ? "" : "title=\"只有房主可以操作\"";
  return `
    <div class="host-danger-controls">
      <div class="host-danger-title">房主控制</div>
      <div class="host-danger-actions">
        <button id="forceRestartBtn" class="small-btn danger-btn" type="button" ${disabled} ${title}>强制重开</button>
        <button id="dissolveRoomBtn" class="small-btn danger-btn" type="button" ${disabled} ${title}>解散房间</button>
      </div>
    </div>
  `;
}

function bindHostDangerControls() {
  document.querySelector("#forceRestartBtn")?.addEventListener("click", () => {
    if (!window.confirm("确定要强制重开当前对局吗？")) return;
    send("forceRestartGame");
    closeModal();
  });
  document.querySelector("#dissolveRoomBtn")?.addEventListener("click", () => {
    if (!window.confirm("确定要解散房间并清空所有座位吗？")) return;
    send("dissolveRoom");
    closeModal();
  });
}

function playerBoardSettingsHtml() {
  return `
    <div class="board-settings-panel">
      <label>图标大小
        <input id="boardIconSize" type="range" min="14" max="42" step="1" value="${boardUiSettings.iconSize}" />
      </label>
      <label>字体大小
        <input id="boardFontSize" type="range" min="10" max="18" step="1" value="${boardUiSettings.fontSize}" />
      </label>
      <label>物品图标大小
        <input id="boardItemSize" type="range" min="20" max="54" step="1" value="${boardUiSettings.itemSize}" />
      </label>
      <div class="board-settings-preview">
        <div class="card-actions preview-actions">
          <button class="card-tool-btn private-btn" type="button">
            <img src="${ACTION_ART.privateInfo}" alt="" loading="lazy" />
            <span>私信</span>
          </button>
        </div>
        <div class="item-tray preview-item-tray">
          ${itemChip({ type: "fan", label: "折扇" })}
        </div>
      </div>
    </div>
  `;
}

function bindPlayerBoardSettings() {
  const iconInput = document.querySelector("#boardIconSize");
  const fontInput = document.querySelector("#boardFontSize");
  const itemInput = document.querySelector("#boardItemSize");
  const update = () => {
    boardUiSettings.iconSize = Number(iconInput.value);
    boardUiSettings.fontSize = Number(fontInput.value);
    boardUiSettings.itemSize = Number(itemInput.value);
    saveBoardUiSettings();
    applyBoardUiSettings();
  };
  iconInput?.addEventListener("input", update);
  fontInput?.addEventListener("input", update);
  itemInput?.addEventListener("input", update);
}

function loadBoardUiSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(BOARD_UI_SETTINGS_KEY) || "{}");
    return {
      iconSize: Number(saved.iconSize) || DEFAULT_BOARD_UI_SETTINGS.iconSize,
      fontSize: Number(saved.fontSize) || DEFAULT_BOARD_UI_SETTINGS.fontSize,
      itemSize: Number(saved.itemSize) || DEFAULT_BOARD_UI_SETTINGS.itemSize,
    };
  } catch {
    return { ...DEFAULT_BOARD_UI_SETTINGS };
  }
}

function saveBoardUiSettings() {
  localStorage.setItem(BOARD_UI_SETTINGS_KEY, JSON.stringify(boardUiSettings));
}

function applyBoardUiSettings() {
  document.documentElement.style.setProperty("--card-action-icon-size", `${boardUiSettings.iconSize}px`);
  document.documentElement.style.setProperty("--card-action-font-size", `${boardUiSettings.fontSize}px`);
  document.documentElement.style.setProperty("--card-item-icon-size", `${boardUiSettings.itemSize}px`);
}

function roomConfigForm(config) {
  return `
    <div class="room-config">
      <label>人数
        <select id="configPlayerCount">
          ${[6, 8, 10].map((count) => `<option value="${count}" ${config.playerCount === count ? "selected" : ""}>${count} 人</option>`).join("")}
        </select>
      </label>
      <label>模式
        <select id="configMode">
          <option value="random" ${config.mode === "random" ? "selected" : ""}>随机角色池</option>
          <option value="custom" ${config.mode === "custom" ? "selected" : ""}>测试指定角色</option>
        </select>
      </label>
      <label>玫瑰 Rank
        <input id="configRoseRanks" type="text" value="${escapeHtml((config.roseRanks || []).join(","))}" placeholder="例如 1,2,3" />
      </label>
      <label>野兽 Rank
        <input id="configBeastRanks" type="text" value="${escapeHtml((config.beastRanks || []).join(","))}" placeholder="例如 1,2,3" />
      </label>
      <button id="saveConfigBtn" class="small-btn" type="button">保存配置</button>
    </div>
  `;
}

function bindRoomConfigForm() {
  const button = document.querySelector("#saveConfigBtn");
  if (!button) return;
  button.addEventListener("click", () => {
    send("setRoomConfig", {
      config: {
        playerCount: Number(document.querySelector("#configPlayerCount").value),
        mode: document.querySelector("#configMode").value,
        roseRanks: parseRanks(document.querySelector("#configRoseRanks").value),
        beastRanks: parseRanks(document.querySelector("#configBeastRanks").value),
      },
    });
  });
}

function parseRanks(text) {
  return String(text || "")
    .split(/[,\s，]+/)
    .map(Number)
    .filter((rank) => Number.isInteger(rank));
}

function renderPlayers() {
  const players = state.view?.game?.players;
  if (!players) {
    const config = state.view?.room?.config || { playerCount: 6 };
    const seats = state.view?.room?.seats || [];
    const placeholders = Array.from({ length: config.playerCount }, (_, index) => ({
      id: index + 1,
      name: seats.find((seat) => seat.playerId === index + 1)?.name || "等待加入",
      empty: !seats.some((seat) => seat.playerId === index + 1),
      connected: seats.find((seat) => seat.playerId === index + 1)?.connected ?? false,
    }));
    renderColumns(placeholders, renderSeatCard);
    return;
  }

  renderColumns(players, renderPlayerCard);
}

function renderColumns(items, renderer) {
  const orderedItems = [...items].sort((a, b) => a.id - b.id);
  if (orderedItems.length === 10) {
    document.documentElement.style.setProperty("--player-rows-left", 4);
    document.documentElement.style.setProperty("--player-rows-right", 4);
    els.leftPlayersGrid.innerHTML = orderedItems.slice(0, 4).map(renderer).join("");
    els.centerTopPlayer.innerHTML = orderedItems.slice(4, 5).map(renderer).join("");
    els.centerBottomPlayer.innerHTML = orderedItems.slice(5, 6).map(renderer).join("");
    els.rightPlayersGrid.innerHTML = orderedItems.slice(6).map(renderer).join("");
    return;
  }

  els.centerTopPlayer.innerHTML = "";
  els.centerBottomPlayer.innerHTML = "";
  const split = Math.ceil(orderedItems.length / 2);
  document.documentElement.style.setProperty("--player-rows-left", split);
  document.documentElement.style.setProperty("--player-rows-right", orderedItems.length - split);
  els.leftPlayersGrid.innerHTML = orderedItems.slice(0, split).map(renderer).join("");
  els.rightPlayersGrid.innerHTML = orderedItems.slice(split).map(renderer).join("");
}

function renderSeatCard(seat) {
  const offline = !seat.empty && seat.connected === false;
  return `
    <article class="player-card seat-card image-loaded ${seat.empty ? "empty-seat" : ""} ${offline ? "offline" : ""}" style="--card-art:url('${CARD_BACK_ART}');--loaded-card-art:url('${CARD_BACK_ART}')">
      <div class="player-head">
        <div class="card-id-stack">
          <h3 class="player-name">玩家 ${seat.id}</h3>
          <span class="corner-rank">X</span>
        </div>
        <div class="status-badges">${offline ? offlineBadgeTemplate() : ""}</div>
      </div>
      <div class="card-status-strip seat-strip">
        <span class="seat-name">${escapeHtml(seat.name)}</span>
      </div>
    </article>
  `;
}

function renderPlayerCard(player) {
  const visual = player.visualIdentity || {};
  const isKnown = Boolean(visual.rank);
  const art = isKnown ? ROLE_ART[visual.rank] : CARD_BACK_ART;
  if (isKnown) preloadImage(art);
  const imageLoaded = !isKnown || loadedImages.has(art);
  const cardClasses = [
    "player-card",
    "board-card",
    isKnown ? "known" : "unknown",
    imageLoaded ? "image-loaded" : "image-loading",
    visual.clan ? visual.clan.toLowerCase() : "neutral",
    player.id === state.selfId ? "current" : "",
    player.captured ? "captured" : "",
    player.connected === false ? "offline" : "",
  ].filter(Boolean).join(" ");

  const actionHtml = renderPlayerActions(player);
  const privateButton = player.id === state.selfId ? privateInfoButton() : "";
  const nextRoundButton = renderNextRoundButton(player);
  const identityCaption = player.captured && player.visibleIdentity
    ? `<div class="identity-caption">${escapeHtml(player.visibleIdentity)}</div>`
    : "";

  return `
    <article class="${cardClasses}" data-bg-src="${escapeHtml(art)}" style="--card-art:url('${CARD_BACK_ART}');${imageLoaded ? `--loaded-card-art:url('${art}')` : ""}">
      <div class="card-veil"></div>
      <div class="player-head">
        <div class="card-id-stack">
          <h3 class="player-name">${escapeHtml(player.name)}</h3>
          <span class="corner-rank">${isKnown ? `Rank ${visual.rank}` : "X"}</span>
        </div>
        <div class="status-badges">${player.connected === false ? offlineBadgeTemplate() : ""}${badgeTemplate(player.badge)}</div>
      </div>
      ${identityCaption}
      <div class="card-status-strip">
        ${player.items.length ? itemTray(player.items) : ""}
        <div class="wound-track" title="伤害 ${player.wounds} / 4">
          ${Array.from({ length: 4 }, (_, index) => `<span class="${index < player.wounds ? "filled" : ""}"></span>`).join("")}
        </div>
        <div class="card-tokens">
          <div class="markers compact-markers">${player.revealed.length ? player.revealed.map(markerObjectTemplate).join("") : `<span class="placeholder-token">未公开</span>`}</div>
        </div>
      </div>
      <div class="card-footer">
        ${privateButton}
        ${nextRoundButton}
        ${actionHtml}
      </div>
    </article>
  `;
}

function offlineBadgeTemplate() {
  return `<span class="offline-badge" title="离线">离线</span>`;
}

function renderPlayerActions(player) {
  const actions = player.availableActions || [];
  if (!actions.length) return "";
  return `<div class="card-actions">${actions.map((action) => actionButton(action, player.id)).join("")}</div>`;
}

function renderNextRoundButton(player) {
  const game = state.view?.game;
  if (!game || game.phase !== "gameover" || player.id !== state.selfId) return "";
  const ready = (game.nextReadyIds || []).includes(state.selfId);
  return `
    <div class="card-actions next-round-actions">
      <button
        class="card-tool-btn next-round-btn ${ready ? "is-ready" : ""}"
        type="button"
        data-action="readyNextRound"
        ${ready ? "disabled" : ""}
        title="${ready ? "已准备下一把" : "下一把"}"
      >
        <img src="${ACTION_ART.readyNextRound}" alt="" loading="lazy" />
        <span>${ready ? "已准备" : "下一把"}</span>
      </button>
    </div>
  `;
}

function privateInfoButton() {
  return `
    <div class="card-actions private-actions">
      <button class="card-tool-btn private-btn" type="button" data-modal="private-info" title="私密信息">
        <img src="${ACTION_ART.privateInfo}" alt="" loading="lazy" />
        <span>私信</span>
      </button>
    </div>
  `;
}

function badgeTemplate(badge) {
  if (!badge) return "";
  const map = {
    dagger: { src: ACTION_ART.dagger, label: "持匕首", className: "dagger" },
    attacking: { src: ACTION_ART.attack, label: "已出刀", className: "attacking" },
    targeted: { src: ACTION_ART.rejectIntervention, label: "受攻击", className: "targeted" },
  };
  const item = map[badge];
  if (!item) return "";
  return `
    <span class="status-icon ${item.className}" title="${item.label}">
      <img src="${item.src}" alt="" loading="lazy" />
    </span>
  `;
}

function actionButton(action, playerId) {
  const targetAttr = action.type === "acceptIntervention"
    ? `data-volunteer-id="${playerId}"`
    : `data-target-id="${playerId}"`;
  const markerAttr = action.marker ? `data-marker="${escapeHtml(action.marker)}"` : "";
  const modeAttr = action.mode ? `data-mode="${escapeHtml(action.mode)}"` : "";
  const icon = ACTION_ART[action.type] || ACTION_ART.revealMarker;
  const compactLabel = compactActionLabel(action);
  return `
    <button
      class="card-tool-btn ${action.type}"
      type="button"
      data-action="${action.type}"
      ${targetAttr}
      ${markerAttr}
      ${modeAttr}
      title="${escapeHtml(action.label)}"
    >
      <img src="${icon}" alt="" loading="lazy" />
      <span>${escapeHtml(compactLabel)}</span>
    </button>
  `;
}

function compactActionLabel(action) {
  const map = {
    attack: "攻击",
    pass: "传递",
    offerIntervention: "干预",
    acceptIntervention: "接受",
    rejectIntervention: "承伤",
    revealMarker: shortRevealLabel(action.label),
    useAssassinSkill: "刺杀",
    selectHarlequinTarget: "偷看",
    useAlchemist: action.mode === "heal" ? "治疗" : "伤害",
    useOracle: "灵喻",
    useGuardian: "给盾",
    useMage: "法杖",
    useCourtesan: "折扇",
  };
  return map[action.type] || action.label || "操作";
}

function shortRevealLabel(label) {
  if (!label) return "公开";
  if (label.includes("Rank")) return "公开 Rank";
  if (label.includes("?")) return "公开 ?";
  if (label.includes("玫瑰")) return "公开红";
  if (label.includes("野兽")) return "公开蓝";
  return "公开";
}

function renderChat() {
  const messages = state.view?.game?.chatMessages || [];
  els.chatList.innerHTML = messages.length
    ? messages.map((message) => `
        <article class="chat-message">
          <div class="chat-meta">${escapeHtml(message.playerName)}</div>
          <div class="chat-text">${escapeHtml(message.text)}</div>
        </article>
      `).join("")
    : `<p class="chat-empty">暂无聊天。玩家不输入，就不会出现任何发言。</p>`;
  const disabled = !state.view?.game || state.view.game.phase === "gameover";
  els.sendChatBtn.disabled = disabled;
  els.chatInput.disabled = disabled;
  els.chatList.scrollTop = els.chatList.scrollHeight;
}

function renderLogs() {
  const game = state.view?.game;
  const logs = game ? [...game.publicLogs, ...(game.privateLogs || []).map((log) => ({ ...log, private: true }))] : [];
  logs.sort((a, b) => a.id - b.id);
  els.logHint.textContent = game ? "当前显示全局公开记录和你的私密记录。" : "游戏开始后显示规则事实记录。";
  els.logList.innerHTML = logs.map((log) => `<li class="${log.private ? "private-log" : ""}">${log.private ? "[私密] " : ""}${escapeHtml(log.text)}</li>`).join("");
  els.logList.scrollTop = els.logList.scrollHeight;
}

function renderAction() {
  const room = state.view?.room;
  const game = state.view?.game;
  els.actionControls.innerHTML = "";

  if (state.error) {
    els.statusPanel.innerHTML = `<p class="status-text error-text">${escapeHtml(state.error)}</p>`;
  } else if (!game) {
    const seatCount = room?.seats?.length || 0;
    const limit = room?.config?.playerCount || 6;
    const offlineSeats = (room?.seats || []).filter((seat) => seat.connected === false);
    els.statusPanel.innerHTML = `
      <p class="status-line"><strong>连接：</strong>${state.connected ? "已连接" : "未连接"}</p>
      <p class="status-line"><strong>人数：</strong>${seatCount} / ${limit}</p>
      ${offlineSeats.length ? `<p class="status-line"><strong>等待：</strong>${offlineSeats.map((seat) => `玩家${seat.playerId}`).join("、")} 重连</p>` : ""}
    `;
  } else {
    els.statusPanel.innerHTML = "";
  }

  if (!game) {
    const offlineSeats = (room?.seats || []).filter((seat) => seat.connected === false);
    els.actionHint.textContent = offlineSeats.length
      ? `等待 ${offlineSeats.map((seat) => `玩家${seat.playerId}`).join("、")} 重连。`
      : state.selfId ? "等待房主开始游戏。" : "先加入房间。";
    return;
  }

  const currentDisconnected = game.currentPlayerId && !isPlayerConnected(game.currentPlayerId);
  const hints = {
    action: game.currentPlayerId === state.selfId ? "你的回合：在目标玩家卡上选择攻击或传递。" : `等待 ${playerName(game.currentPlayerId)} 行动。`,
    intervention: game.pendingAttack?.targetId === state.selfId ? "你正被攻击：可自己承伤，或接受其他玩家的干预。" : "干预阶段：合法玩家可在自己的卡上提出干预。",
    reveal: game.pendingDamage?.targetId === state.selfId ? "你需要公开一个合法标记。" : `等待 ${playerName(game.pendingDamage?.targetId)} 公开标记。`,
    ability: game.pendingAbility?.playerId === state.selfId ? "你的能力阶段：在目标玩家卡上选择目标或效果。" : `等待 ${playerName(game.pendingAbility?.playerId)} 使用能力。`,
    gameover: "游戏结束：可查看结果，或点击下一把准备重开。",
  };
  els.actionHint.textContent = currentDisconnected && game.phase === "action"
    ? `等待 ${playerName(game.currentPlayerId)} 重连。`
    : hints[game.phase] || "等待操作。";
}

function isPlayerConnected(playerId) {
  const player = state.view?.game?.players?.find((item) => item.id === playerId);
  if (player) return player.connected !== false;
  const seat = state.view?.room?.seats?.find((item) => item.playerId === playerId);
  return seat ? seat.connected !== false : true;
}

function renderVictory() {
  const game = state.view?.game;
  if (game?.phase !== "gameover" || !game.winner) {
    els.victoryOverlay.classList.add("hidden");
    els.victoryOverlay.innerHTML = "";
    return;
  }

  const readyIds = game.nextReadyIds || [];
  const readyNames = (game.players || [])
    .filter((player) => readyIds.includes(player.id))
    .map((player) => player.name);

  els.victoryOverlay.innerHTML = `
    <div class="victory-title">游戏结束：${clanName(game.winner)} 胜利</div>
    <div class="victory-ready-line">下一把准备：${readyNames.length ? readyNames.map(escapeHtml).join(" / ") : "暂无"}</div>
  `;
  els.victoryOverlay.classList.remove("hidden");
}

function openPrivateInfoModal() {
  const game = state.view?.game;
  if (!game?.self) return;
  els.identityModal.classList.remove("hidden");
  const modalBox = els.identityModal.querySelector(".modal-box");
  modalBox?.classList.remove("role-board-mode", "room-settings-mode");
  modalBox?.classList.add("private-info-mode");
  els.modalTitle.textContent = "私密信息";
  els.modalBody.innerHTML = `
    <div class="private-info-card">
      <div class="private-line">
        <span class="private-label">开局看到的颜色</span>
        <span class="private-value">${escapeHtml(game.self.clueTargetName || "未知")} ${clueMarker(game.self.clue)}</span>
      </div>
      ${game.self.privateIntel.length ? `
        <div class="private-intel-list">
          ${game.self.privateIntel.map((entry) => `
            <div class="private-intel-item">
              <span class="private-label">${escapeHtml(entry.targetName)}</span>
              <span class="private-value">${escapeHtml(entry.identity)}</span>
            </div>
          `).join("")}
        </div>
      ` : `<p class="private-empty">暂无小丑偷看结果。</p>`}
    </div>
  `;
}

function openRulesModal(type) {
  els.identityModal.classList.remove("hidden");
  const modalBox = els.identityModal.querySelector(".modal-box");
  modalBox?.classList.remove("private-info-mode", "room-settings-mode");
  modalBox?.classList.toggle("role-board-mode", type === "roles");
  if (type === "general") {
    els.modalTitle.textContent = "通用规则";
    els.modalBody.innerHTML = `
      <div class="rules-modal-content">
        <ul>
          <li>支持 6 / 8 / 10 人局，双方人数相同。</li>
          <li>默认每个氏族 Rank 最小者为当前领袖；长老能力可将其改为 Rank 最大者。</li>
          <li>普通攻击可被合法玩家干预；技能伤害不可被干预。</li>
          <li>干预承伤必须公开 Rank；持折扇玩家被攻击时，不能被其他玩家干预。</li>
          <li>技能伤害导致公开 Rank 时，不触发该 Rank 的角色能力。</li>
          <li>第 4 点伤害会捕获目标；捕获敌方当前领袖则胜利，抓错则对方胜利。</li>
        </ul>
      </div>
    `;
    return;
  }

  els.modalTitle.innerHTML = `
    <span>公开角色看板</span>
    <span class="role-tune-shell">
      <span class="role-tune-panel" aria-label="角色图微调">
        <label>图片缩放 <input type="range" min="80" max="150" step="1" data-role-tune="scale"></label>
        <label>横向位置 <input type="range" min="0" max="100" step="1" data-role-tune="x"></label>
        <label>纵向位置 <input type="range" min="0" max="100" step="1" data-role-tune="y"></label>
      </span>
      <button class="role-tune-toggle" type="button" aria-label="角色图设置" title="角色图设置">⚙</button>
    </span>
  `;
  preloadAllRoleArt();
  els.modalBody.innerHTML = `
    <div class="role-board rules-modal-content">${roleCardsHtml()}</div>
  `;
  setupRoleTuneControls();
  setupRoleBoardSnap();
}

function setupRoleBoardSnap() {
  const board = els.modalBody.querySelector(".role-board");
  if (!board) return;
  preloadAllRoleArt();
  let isAnimating = false;
  board.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (isAnimating) return;
    const cards = Array.from(board.querySelectorAll(".cinematic-role-card"));
    if (!cards.length) return;
    const current = Math.round(board.scrollTop / board.clientHeight);
    const direction = event.deltaY > 0 ? 1 : -1;
    const next = Math.max(0, Math.min(cards.length - 1, current + direction));
    if (next === current) return;
    isAnimating = true;
    board.scrollTo({ top: next * board.clientHeight, behavior: "smooth" });
    preloadRoleBoardAround(next);
    window.setTimeout(() => {
      isAnimating = false;
    }, 220);
  }, { passive: false });
}

function preloadRoleBoardAround(index) {
  [index, index + 1].forEach((item) => {
    const rank = item + 1;
    if (ROLE_ART[rank]) preloadImage(ROLE_ART[rank]);
  });
}

function roleCardsHtml() {
  return roleCardData().map((role) => `
    <article class="role-rule-card cinematic-role-card ${loadedImages.has(ROLE_ART[role.rank]) ? "image-loaded" : "image-loading"}" data-rank="${role.rank}" data-role-bg-src="${ROLE_ART[role.rank]}" style="${roleCardStyle(role.rank)}">
      <div class="role-card-art">
        <div class="role-top-markers">
          ${role.markers.filter((marker) => marker.type !== "rank").map((marker) => markerTemplate(marker.type, marker.label)).join("")}
          <span class="rank-badge">Rank ${role.rank}</span>
        </div>
        <h3>${escapeHtml(role.role)}</h3>
      </div>
      <div class="role-card-body role-skill-box">
        <p>${escapeHtml(role.ability)}</p>
      </div>
    </article>
  `).join("");
}

function loadRoleTune() {
  try {
    return JSON.parse(localStorage.getItem(ROLE_BOARD_TUNE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveRoleTune(tune) {
  localStorage.setItem(ROLE_BOARD_TUNE_KEY, JSON.stringify(tune));
}

function getRoleTune() {
  const tune = loadRoleTune();
  return { ...DEFAULT_ROLE_TUNE, ...(tune.global || {}) };
}

function setRoleTune(patch) {
  const all = loadRoleTune();
  all.global = { ...getRoleTune(), ...patch };
  saveRoleTune(all);
}

function roleCardStyle(rank) {
  const tune = getRoleTune();
  const art = ROLE_ART[rank];
  const loaded = loadedImages.has(art);
  return [
    `--role-art:url('${CARD_BACK_ART}')`,
    loaded ? `--loaded-role-art:url('${art}')` : "",
    `--role-bg-size:${tune.scale}%`,
    `--role-bg-x:${tune.x}%`,
    `--role-bg-y:${tune.y}%`,
  ].filter(Boolean).join(";");
}

function activeRoleCard() {
  const board = els.modalBody.querySelector(".role-board");
  if (!board) return null;
  const cards = Array.from(board.querySelectorAll(".cinematic-role-card"));
  if (!cards.length) return null;
  const index = Math.max(0, Math.min(cards.length - 1, Math.round(board.scrollTop / board.clientHeight)));
  return cards[index];
}

function setupRoleTuneControls() {
  const toggle = els.modalTitle.querySelector(".role-tune-toggle");
  const shell = els.modalTitle.querySelector(".role-tune-shell");
  const panel = els.modalTitle.querySelector(".role-tune-panel");
  if (!toggle || !panel) return;
  toggle.addEventListener("click", () => shell?.classList.toggle("expanded"));
  panel.addEventListener("input", (event) => {
    const input = event.target.closest("[data-role-tune]");
    if (!input) return;
    const key = input.dataset.roleTune;
    const value = Number(input.value);
    setRoleTune({ [key]: value });
    els.modalBody.querySelectorAll(".cinematic-role-card").forEach((card) => {
      const rank = Number(card.dataset.rank);
      card.setAttribute("style", roleCardStyle(rank));
    });
  });
  syncRoleTuneControls();
}

function syncRoleTuneControls() {
  const panel = els.modalTitle.querySelector(".role-tune-panel");
  if (!panel) return;
  const tune = getRoleTune();
  panel.querySelector("[data-role-tune='scale']").value = tune.scale;
  panel.querySelector("[data-role-tune='x']").value = tune.x;
  panel.querySelector("[data-role-tune='y']").value = tune.y;
}

function roleCardData() {
  return [
    {
      rank: 1,
      role: "长老",
      markers: [{ type: "rose", label: "玫瑰" }, { type: "rose", label: "玫瑰" }, { type: "rank", label: "Rank" }],
      clue: "本阵营颜色线索。",
      ability: "公开 Rank 后，本氏族当前领袖改为 Rank 最大者。",
      limit: "被技能伤害打出 Rank 时，能力不触发。",
    },
    {
      rank: 2,
      role: "刺客",
      markers: [{ type: "unknown", label: "?" }, { type: "unknown", label: "?" }, { type: "rank", label: "Rank" }],
      clue: "本阵营颜色线索。",
      ability: "指定一名其他玩家受到 2 点不可干预技能伤害。",
      limit: "技能伤害打出 Rank 时，目标能力不触发。",
    },
    {
      rank: 3,
      role: "小丑",
      markers: [{ type: "unknown", label: "?" }, { type: "unknown", label: "?" }, { type: "rank", label: "Rank" }],
      clue: "相反阵营颜色线索。",
      ability: "私下查看两名其他玩家的完整身份。",
      limit: "结果只发送给小丑本人。",
    },
    {
      rank: 4,
      role: "炼金术士",
      markers: [{ type: "unknown", label: "?" }, { type: "unknown", label: "?" }, { type: "rank", label: "Rank" }],
      clue: "本阵营颜色线索。",
      ability: "仅在干预承伤公开 Rank 时触发，可治疗或伤害被保护目标。",
      limit: "治疗可收回公开标记，包括 Rank。",
    },
    {
      rank: 5,
      role: "灵喻师",
      markers: [{ type: "rose", label: "玫瑰" }, { type: "rose", label: "玫瑰" }, { type: "rank", label: "Rank" }],
      clue: "本阵营颜色线索。",
      ability: "指定一名玩家受到 1 点不可干预能力伤害，并把匕首交给该玩家。",
      limit: "目标必须优先公开 Rank，且该伤害不触发目标能力。",
    },
    {
      rank: 6,
      role: "守卫",
      markers: [{ type: "rose", label: "玫瑰" }, { type: "rose", label: "玫瑰" }, { type: "rank", label: "Rank" }],
      clue: "本阵营颜色线索。",
      ability: "给其他玩家盾牌，自己获得长剑。",
      limit: "持盾玩家不能被攻击或能力伤害指定；守卫第 3 伤时收回盾牌。",
    },
    {
      rank: 7,
      role: "狂战士",
      markers: [{ type: "rose", label: "玫瑰" }, { type: "unknown", label: "?" }, { type: "rank", label: "Rank" }],
      clue: "本阵营颜色线索。",
      ability: "反击刚才攻击自己的玩家 1 点能力伤害。",
      limit: "反击后由狂战士保留行动权。",
    },
    {
      rank: 8,
      role: "法师",
      markers: [{ type: "rose", label: "玫瑰" }, { type: "unknown", label: "?" }, { type: "rank", label: "Rank" }],
      clue: "本阵营颜色线索。",
      ability: "给自己和另一名玩家法杖。",
      limit: "持法杖者之后公开阵营标记时，只能公开问号。",
    },
    {
      rank: 9,
      role: "舞妓",
      markers: [{ type: "rose", label: "玫瑰" }, { type: "unknown", label: "?" }, { type: "rank", label: "Rank" }],
      clue: "本阵营颜色线索。",
      ability: "给其他玩家折扇。",
      limit: "持折扇者被攻击时，不能被别人干预。",
    },
  ];
}

function itemTray(items) {
  return `<div class="item-tray">${items.map(itemChip).join("")}</div>`;
}

function itemChip(item) {
  const src = ITEM_ART[item.type] || "";
  return `
    <span class="item-chip" title="${escapeHtml(item.label)}">
      ${src ? `<img src="${src}" alt="${escapeHtml(item.label)}" loading="lazy" />` : ""}
    </span>
  `;
}

function closeModal() {
  els.identityModal.classList.add("hidden");
  els.identityModal.querySelector(".modal-box")?.classList.remove("role-board-mode", "private-info-mode", "room-settings-mode");
}

function markerObjectTemplate(marker) {
  return markerTemplate(marker.type, marker.label);
}

function markerTemplate(type, label) {
  const iconOnly = type === "rose" || type === "beast" || type === "unknown";
  const display = type === "rose" || type === "beast" ? "🌹" : label;
  return `<span class="marker ${type} ${iconOnly ? "marker-icon-only" : ""}" title="${escapeHtml(label)}">${escapeHtml(display)}</span>`;
}

function clueMarker(clue) {
  if (!clue) return "未知";
  return clue.includes("玫瑰") ? markerTemplate("rose", "红色") : markerTemplate("beast", "蓝色");
}

function playerName(playerId) {
  const player = state.view?.game?.players?.find((item) => item.id === playerId);
  return player ? player.name : `玩家 ${playerId || "?"}`;
}

function clanName(clan) {
  return clan === "Rose" ? "玫瑰氏族" : "野兽氏族";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
