const ROLE_DECK = [
  { clan: "Rose", clanName: "玫瑰氏族", rank: 1, role: "长老", clue: "玫瑰纹章", markers: ["rose1", "rose2", "rank"] },
  { clan: "Rose", clanName: "玫瑰氏族", rank: 2, role: "刺客", clue: "玫瑰纹章", markers: ["unknown1", "unknown2", "rank"] },
  { clan: "Rose", clanName: "玫瑰氏族", rank: 3, role: "小丑", clue: "野兽纹章", markers: ["unknown1", "unknown2", "rank"] },
  { clan: "Beast", clanName: "野兽氏族", rank: 1, role: "长老", clue: "野兽纹章", markers: ["beast1", "beast2", "rank"] },
  { clan: "Beast", clanName: "野兽氏族", rank: 2, role: "刺客", clue: "野兽纹章", markers: ["unknown1", "unknown2", "rank"] },
  { clan: "Beast", clanName: "野兽氏族", rank: 3, role: "小丑", clue: "玫瑰纹章", markers: ["unknown1", "unknown2", "rank"] },
];

const MARKER_LABELS = {
  rose: "玫瑰",
  beast: "野兽",
  unknown: "?",
  rank: "Rank",
};

const state = {
  players: [],
  currentPlayerId: null,
  phase: "setup",
  pendingAttack: null,
  pendingAbility: null,
  pendingDamagePlayerId: null,
  damageSourcePlayerId: null,
  damageSequence: null,
  damageStack: [],
  forcedRevealMarker: null,
  leaderRule: { Rose: "lowest", Beast: "lowest" },
  lastDealSignature: "",
  winner: null,
  viewerId: 0,
  publicLogs: [],
  privateLogs: {},
  privateIntel: {},
  disclosedIntelKeys: [],
  chatMessages: [],
  publicSignals: [],
  gameEvents: [],
  strategySnapshots: {},
  strategyModalPlayerId: null,
  logIndex: 0,
  autoRunning: false,
  autoTimerId: null,
  autoStepLimit: 200,
  autoStepCount: 0,
  autoStallCount: 0,
};

const leftPlayersGrid = document.querySelector("#leftPlayersGrid");
const rightPlayersGrid = document.querySelector("#rightPlayersGrid");
const statusPanel = document.querySelector("#statusPanel");
const intelPanel = document.querySelector("#intelPanel");
const actionHint = document.querySelector("#actionHint");
const actionControls = document.querySelector("#actionControls");
const chatList = document.querySelector("#chatList");
const chatSpeakerSelect = document.querySelector("#chatSpeakerSelect");
const chatInput = document.querySelector("#chatInput");
const sendChatBtn = document.querySelector("#sendChatBtn");
const logList = document.querySelector("#logList");
const logHint = document.querySelector("#logHint");
const newGameBtn = document.querySelector("#newGameBtn");
const generalRulesBtn = document.querySelector("#generalRulesBtn");
const roleBoardBtn = document.querySelector("#roleBoardBtn");
const autoStepBtn = document.querySelector("#autoStepBtn");
const autoRunBtn = document.querySelector("#autoRunBtn");
const viewerSelect = document.querySelector("#viewerSelect");
const victoryOverlay = document.querySelector("#victoryOverlay");
const identityModal = document.querySelector("#identityModal");
const modalBox = document.querySelector(".modal-box");
const modalTitle = document.querySelector("#modalTitle");
const modalBody = document.querySelector("#modalBody");
const closeModalBtn = document.querySelector("#closeModalBtn");
let strategyDrag = null;

newGameBtn.addEventListener("click", startGame);
generalRulesBtn.addEventListener("click", () => openRulesModal("general"));
roleBoardBtn.addEventListener("click", () => openRulesModal("roles"));
autoStepBtn?.addEventListener("click", autoStep);
autoRunBtn?.addEventListener("click", toggleAutoRun);
viewerSelect?.addEventListener("change", () => {
  state.viewerId = Number(viewerSelect.value);
  render();
});
sendChatBtn.addEventListener("click", sendManualChat);
chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") sendManualChat();
});
closeModalBtn.addEventListener("click", closeIdentityModal);
identityModal.addEventListener("click", (event) => {
  if (event.target === identityModal) closeIdentityModal();
});
modalBody.addEventListener("pointerdown", startStrategyDrag);
modalBody.addEventListener("pointermove", moveStrategyDrag);
modalBody.addEventListener("pointerup", endStrategyDrag);
modalBody.addEventListener("pointercancel", endStrategyDrag);
modalBody.addEventListener("pointerleave", endStrategyDrag);

function startGame() {
  stopAutoRun("", { silent: true });
  const shuffledRoles = dealRoles();
  state.players = shuffledRoles.map((role, index) => ({
    id: index + 1,
    name: `玩家 ${index + 1}`,
    ...role,
    wounds: 0,
    revealed: [],
    captured: false,
  }));
  state.currentPlayerId = randomItem(state.players).id;
  state.phase = "action";
  state.pendingAttack = null;
  state.pendingAbility = null;
  state.pendingDamagePlayerId = null;
  state.damageSourcePlayerId = null;
  state.damageSequence = null;
  state.damageStack = [];
  state.forcedRevealMarker = null;
  state.leaderRule = { Rose: "lowest", Beast: "lowest" };
  state.lastDealSignature = dealSignature(shuffledRoles);
  state.winner = null;
  state.viewerId = state.currentPlayerId;
  state.publicLogs = [];
  state.privateLogs = Object.fromEntries(state.players.map((player) => [player.id, []]));
  state.privateIntel = Object.fromEntries(state.players.map((player) => [player.id, []]));
  state.disclosedIntelKeys = [];
  state.chatMessages = [];
  state.publicSignals = [];
  state.gameEvents = [];
  state.strategySnapshots = {};
  state.strategyModalPlayerId = null;
  state.logIndex = 0;
  updateChatSpeakerSelect();
  addLog("游戏开始。本局已重新洗牌并随机分配座位身份。");
  recordGameEvent("game_start", { currentPlayerId: state.currentPlayerId }, { recompute: false });
  addLog(`${getPlayer(state.currentPlayerId).name} 获得匕首，成为首个行动玩家。`);
  recomputeAllStrategies("新开局");
  render();
}

function render() {
  renderStatus();
  renderIntel();
  renderPlayers();
  renderActions();
  renderChat();
  renderLogs();
}

function renderStatus() {
  if (victoryOverlay) {
    victoryOverlay.classList.toggle("hidden", state.phase !== "gameover");
    victoryOverlay.textContent = state.phase === "gameover" ? `游戏结束：${state.winner} 胜利` : "";
  }

  if (state.phase === "setup") {
    statusPanel.innerHTML = `
      <p class="status-title">尚未开局</p>
      <p class="status-text">点击“新开一局”，系统会随机分配3名玫瑰氏族和3名野兽氏族。</p>
    `;
    return;
  }

  if (state.phase === "gameover") {
    statusPanel.innerHTML = `
      <p class="status-title">游戏结束：${state.winner} 胜利</p>
      <p class="status-text">被捕获玩家身份已公开。可以新开一局重新测试规则。</p>
    `;
    return;
  }

  if (state.phase === "intervention") {
    const attack = state.pendingAttack;
    statusPanel.innerHTML = `
      <p class="status-title">干预阶段</p>
      <p class="status-text">${getPlayer(attack.attackerId).name} 攻击 ${getPlayer(attack.targetId).name}。其他符合条件的玩家可以提出干预，目标随后决定是否接受。</p>
    `;
    return;
  }

  if (state.phase === "ability") {
    const owner = getPlayer(state.pendingAbility.playerId);
    statusPanel.innerHTML = `
      <p class="status-title">角色能力阶段</p>
      <p class="status-text">${owner.name} 公开了 Rank，正在结算 ${owner.role} 的能力。</p>
    `;
    return;
  }

  if (state.phase === "reveal") {
    const player = getPlayer(state.pendingDamagePlayerId);
    const text = state.forcedRevealMarker
      ? `${player.name} 因干预承伤，必须公开 Rank。`
      : `${player.name} 受到1点伤害，需要公开一个未公开标记。`;
    statusPanel.innerHTML = `
      <p class="status-title">揭示阶段</p>
      <p class="status-text">${text}</p>
    `;
    return;
  }

  const current = getPlayer(state.currentPlayerId);
  statusPanel.innerHTML = `
    <p class="status-title">行动阶段</p>
    <p class="status-text">${current.name} 持有匕首，可以攻击其他玩家，或把匕首传给任意其他玩家。</p>
  `;
}

function renderPlayers() {
  const viewer = getViewer();
  const playerCardHtml = (player) => {
    const markerHtml = player.revealed.length
      ? player.revealed.map((marker) => markerTemplate(marker, player)).join("")
      : `<span class="marker">暂无公开标记</span>`;
    const currentClass = player.id === state.currentPlayerId ? " current" : "";
    const capturedClass = player.captured ? " captured" : "";
    const badgeHtml = playerBadgeHtml(player);

    return `
      <article class="player-card${currentClass}${capturedClass}">
        <div class="player-head">
          <p class="player-name">${player.name}</p>
          <div class="badges">${badgeHtml}</div>
        </div>
        <p class="wound-line">伤害：${player.wounds} / 4</p>
        <div class="markers">${markerHtml}</div>
        <div class="card-actions">
          ${cardActionButtons(player, viewer)}
        </div>
      </article>
    `;
  };

  leftPlayersGrid.innerHTML = state.players
    .filter((player) => player.id <= 3)
    .map(playerCardHtml)
    .join("");
  rightPlayersGrid.innerHTML = state.players
    .filter((player) => player.id > 3)
    .map(playerCardHtml)
    .join("");

  bindCardActionButtons();
}

function cardActionButtons(player, viewer) {
  if (!viewer || player.captured || state.phase === "setup" || state.phase === "gameover") return "";

  if (state.phase === "action" && viewer.id === state.currentPlayerId && player.id !== viewer.id) {
    return `
      <button class="small-btn action-card-btn attack" type="button" data-card-attack="${player.id}">攻击</button>
      <button class="small-btn action-card-btn pass" type="button" data-card-pass="${player.id}">传递</button>
    `;
  }

  if (state.phase === "intervention" && state.pendingAttack) {
    const attack = state.pendingAttack;
    if (eligibleInterveners().some((candidate) => candidate.id === player.id)) {
      return `<button class="small-btn action-card-btn intervene" type="button" data-card-intervene="${player.id}">提出干预</button>`;
    }
    if (attack.targetId === viewer.id && attack.volunteerIds.includes(player.id)) {
      return `<button class="small-btn action-card-btn accept" type="button" data-card-accept="${player.id}">接受干预</button>`;
    }
    if (attack.targetId === player.id && attack.targetId === viewer.id) {
      return `<button class="small-btn action-card-btn reject" type="button" data-card-reject="1">拒绝干预</button>`;
    }
  }

  if (state.phase === "reveal" && state.pendingDamagePlayerId === player.id && viewer.id === player.id) {
    const markers = state.forcedRevealMarker ? [state.forcedRevealMarker] : availableMarkers(player);
    return markers
      .map((marker) => `<button class="small-btn action-card-btn reveal" type="button" data-card-reveal="${marker}">公开 ${markerRevealLabel(marker, player)}</button>`)
      .join("");
  }

  if (state.phase === "ability" && state.pendingAbility?.playerId === viewer.id && player.id !== viewer.id) {
    if (state.pendingAbility.type === "assassin") {
      return `<button class="small-btn action-card-btn skill" type="button" data-card-assassin="${player.id}">刺杀</button>`;
    }
    if (state.pendingAbility.type === "harlequin" && !state.pendingAbility.selectedIds.includes(player.id)) {
      return `<button class="small-btn action-card-btn skill" type="button" data-card-harlequin="${player.id}">偷看</button>`;
    }
  }

  return "";
}

function bindCardActionButtons() {
  document.querySelectorAll("[data-card-attack]").forEach((button) => {
    button.addEventListener("click", () => attackPlayer(Number(button.dataset.cardAttack)));
  });
  document.querySelectorAll("[data-card-pass]").forEach((button) => {
    button.addEventListener("click", () => passDagger(Number(button.dataset.cardPass)));
  });
  document.querySelectorAll("[data-card-intervene]").forEach((button) => {
    button.addEventListener("click", () => volunteerIntervention(Number(button.dataset.cardIntervene)));
  });
  document.querySelectorAll("[data-card-accept]").forEach((button) => {
    button.addEventListener("click", () => acceptIntervention(Number(button.dataset.cardAccept)));
  });
  document.querySelectorAll("[data-card-reject]").forEach((button) => {
    button.addEventListener("click", rejectIntervention);
  });
  document.querySelectorAll("[data-card-reveal]").forEach((button) => {
    const player = getPlayer(state.pendingDamagePlayerId);
    button.addEventListener("click", () => revealMarker(player.id, button.dataset.cardReveal));
  });
  document.querySelectorAll("[data-card-assassin]").forEach((button) => {
    button.addEventListener("click", () => useAssassinAbility(Number(button.dataset.cardAssassin)));
  });
  document.querySelectorAll("[data-card-harlequin]").forEach((button) => {
    button.addEventListener("click", () => useHarlequinAbility(Number(button.dataset.cardHarlequin)));
  });
}

function renderIntel() {
  const viewer = getViewer();
  if (!viewer) {
    intelPanel.innerHTML = `
      <h2>私密信息</h2>
      <p>新开一局后显示当前玩家的身份与私密信息。</p>
    `;
    return;
  }

  const clueTarget = clueTargetFor(viewer);
  const intelRows = privateIntelFor(viewer)
    .map((entry) => {
      const target = getPlayer(entry.targetId);
      return target ? `<p><strong>偷看结果：</strong>${target.name} = ${fullRoleLabel(target)}</p>` : "";
    })
    .join("");
  intelPanel.innerHTML = `
    <h2>私密信息：${viewer.name}</h2>
    <div class="intel-grid">
      <p><strong>自己的身份：</strong>${fullRoleLabel(viewer)}</p>
      <p><strong>开局看到的颜色：</strong>${clueTarget.name} = ${clueMarkerTemplate(clueTarget.clue)}</p>
      ${intelRows}
    </div>
  `;
}

function suspicionLine(viewer, player) {
  if (!viewer || isGodView() || viewer.id === player.id || state.phase === "setup") return "";

  const model = latestStrategyModel(viewer);
  const score = model.actionScores.find((entry) => entry.player.id === player.id);
  const elderInference = inferredElderFromClanMarkers(viewer, player);
  const enemyProb = score ? clamp01(score.adjustedEnemyProbability) : null;
  const leaderProb = score ? clamp01(score.adjustedEnemyLeaderProbability) : null;
  const behaviorReasons = score?.behaviorReasons || [];
  const shouldShow =
    elderInference ||
    behaviorReasons.length > 0 ||
    enemyProb >= 0.45 ||
    leaderProb >= 0.18;
  if (!shouldShow) return "";

  const relationClan = elderInference?.clan || (enemyProb >= 0.5 ? oppositeClan(viewer.clan) : viewer.clan);
  const relationText = enemyProb >= 0.5 || elderInference?.enemy ? "敌对倾向" : "队友倾向";
  const probabilityText = enemyProb !== null ? percent(enemyProb) : enemyProbLabel(enemyProb);
  const leaderText = leaderProb > 0 ? `，敌方领袖 ${percent(leaderProb)}` : "";
  const reason = elderInference
    ? elderInference.reason
    : behaviorReasons[0] || "基于当前公开行为和线索修正。";

  return `
    <p class="role-line suspicion-line">
      判断：${clanMarkerTemplate(relationClan)} ${relationText} ${probabilityText}${leaderText}
      <span class="suspicion-reason">${escapeHtml(reason)}</span>
    </p>
  `;
}

function enemyProbLabel(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "未知";
  if (value >= 0.66) return "大";
  if (value <= 0.33) return "小";
  return "中";
}

function renderActions() {
  actionControls.innerHTML = "";
  if (autoRunBtn) autoRunBtn.textContent = state.autoRunning ? "暂停推演" : "自动推演到底";

  if (state.phase === "setup") {
    if (autoStepBtn) autoStepBtn.disabled = true;
    if (autoRunBtn) autoRunBtn.disabled = true;
    actionHint.textContent = "点击“新开一局”开始。";
    return;
  }

  if (state.phase === "gameover") {
    if (autoStepBtn) autoStepBtn.disabled = true;
    if (autoRunBtn) autoRunBtn.disabled = true;
    actionHint.textContent = "本局已结束。";
    return;
  }

  if (autoStepBtn) autoStepBtn.disabled = state.autoRunning;
  if (autoRunBtn) autoRunBtn.disabled = false;

  if (state.phase === "intervention") {
    renderInterventionHint();
    syncAutoRunControls();
    return;
  }

  if (state.phase === "ability") {
    renderAbilityHint();
    syncAutoRunControls();
    return;
  }

  if (state.phase === "reveal") {
    renderRevealHint();
    syncAutoRunControls();
    return;
  }

  const current = getPlayer(state.currentPlayerId);
  actionHint.textContent = `${current.name} 的回合。请在目标玩家看板上选择“攻击”或“传递”。`;
  syncAutoRunControls();
}

function syncAutoRunControls() {
  if (!state.autoRunning) return;
  autoRunBtn.textContent = "暂停推演";
  actionHint.textContent = `自动推演中：第 ${state.autoStepCount} 步`;
  actionControls.querySelectorAll("button").forEach((button) => {
    button.disabled = true;
  });
}

function renderInterventionHint() {
  const attack = state.pendingAttack;
  const target = getPlayer(attack.targetId);
  const volunteers = attack.volunteerIds.map(getPlayer);
  actionHint.textContent = volunteers.length
    ? `${target.name} 可以在玩家看板上接受一名干预者，也可以在自己的看板上拒绝干预。`
    : `符合条件的玩家可在自己的看板上提出干预，${target.name} 也可以拒绝干预并自己承伤。`;
}

function renderAbilityHint() {
  const owner = getPlayer(state.pendingAbility.playerId);

  if (state.pendingAbility.type === "assassin") {
    actionHint.textContent = `${owner.name} 的刺客能力：在目标玩家看板上选择“刺杀”，造成2点不可干预伤害。`;
    return;
  }

  if (state.pendingAbility.type === "harlequin") {
    const selected = state.pendingAbility.selectedIds.map(getPlayer);
    actionHint.textContent = selected.length
      ? `${owner.name} 的小丑能力：已选择 ${selected.map((player) => player.name).join("、")}，还需在玩家看板上选择 ${2 - selected.length} 名玩家。`
      : `${owner.name} 的小丑能力：在玩家看板上选择两名玩家偷看完整身份。`;
  }
}

function renderRevealHint() {
  const player = getPlayer(state.pendingDamagePlayerId);
  actionHint.textContent = state.forcedRevealMarker
    ? `${player.name} 必须在自己的玩家看板上公开 Rank。`
    : `${player.name} 请在自己的玩家看板上选择一个标记公开。`;
}

function renderLogs() {
  const logs = visibleLogs();
  logHint.textContent =
    isGodView()
      ? "当前显示全局公开记录 + 所有玩家私密记录。"
      : state.viewerId === 0
      ? "当前显示全局公开记录。"
      : `当前显示全局公开记录 + 玩家 ${state.viewerId} 的私密记录。`;
  logList.innerHTML = logs.map((entry) => `<li class="${entry.private ? "private-log" : ""}">${entry.text}</li>`).join("");
  logList.scrollTop = logList.scrollHeight;
}

function renderChat() {
  if (!state.players.length) {
    chatList.innerHTML = `<p class="chat-empty">暂无公开发言。</p>`;
    if (chatSpeakerSelect) chatSpeakerSelect.disabled = true;
    chatInput.disabled = true;
    sendChatBtn.disabled = true;
    return;
  }

  if (chatSpeakerSelect) chatSpeakerSelect.disabled = false;
  chatInput.disabled = false;
  sendChatBtn.disabled = false;
  chatList.innerHTML = state.chatMessages.length
    ? state.chatMessages
        .map((message) => {
          const player = getPlayer(message.playerId);
          const autoClass = message.auto ? " auto-chat" : "";
          return `
            <article class="chat-message${autoClass}">
              <div class="chat-meta">${player?.name || "系统"}</div>
              <div class="chat-text">${escapeHtml(message.text)}</div>
            </article>
          `;
        })
        .join("")
    : `<p class="chat-empty">暂无公开发言。</p>`;
  chatList.scrollTop = chatList.scrollHeight;
}

function sendManualChat() {
  if (!state.players.length) return;

  const playerId = state.viewerId || state.currentPlayerId || state.players[0]?.id;
  const text = chatInput.value.trim();
  if (!playerId || !text) return;

  addChatMessage(playerId, text, false, ["manual_chat"]);
  chatInput.value = "";
  render();
}

function updateChatSpeakerSelect() {
  if (!chatSpeakerSelect) return;
  chatSpeakerSelect.innerHTML = state.players
    .map((player) => `<option value="${player.id}">${player.name}</option>`)
    .join("");
  chatSpeakerSelect.value = String(state.currentPlayerId || state.players[0]?.id || "");
}

function addChatMessage(playerId, text, auto = false, tags = []) {
  state.chatMessages.push({
    playerId,
    text,
    auto,
    tags,
    index: nextLogIndex(),
  });
  recordGameEvent("chat", {
    actorId: playerId,
    text,
    auto,
    tags: tags.length ? tags : inferChatTags(text, auto),
  });
}

function inferChatTags(text, auto) {
  const tags = [];
  if (!auto) tags.push("manual_chat");
  if (text.includes("颜色")) tags.push("claim_color");
  if (text.includes("看到")) tags.push("claim_seen_color");
  if (text.includes("身份") || text.includes("长老") || text.includes("刺客") || text.includes("小丑")) tags.push("claim_identity");
  if (text.includes("可疑") || text.includes("敌") || text.includes("优先目标")) tags.push("accuse");
  if (text.includes("挡") || text.includes("保护")) tags.push("protect");
  if (text.includes("帮") || text.includes("队友")) tags.push("request_help");
  if (text.includes("摊牌") || text.includes("确认") || text.includes("公开")) tags.push("reveal_intel");
  if (text.includes("不全") || text.includes("先不") || text.includes("不适合全说")) tags.push("withhold_intel");
  if (text.includes("烟雾") || text.includes("误导") || text.includes("反应")) tags.push("misdirect");
  return [...new Set(tags)];
}

function buildAttackChat(attacker, target) {
  const model = buildStrategyModel(attacker);
  const statement = stripHtml(buildPublicStatement(model));
  if (model.bestAction.player.id === target.id) return statement;
  return `${statement} 我临时选择攻击 ${target.name}，但这不是当前概率排序最高目标。`;
}

function buildDefenseChat(target, attacker) {
  const model = buildStrategyModel(target);
  const clueTarget = clueTargetFor(target);
  const seenColor = clueTarget
    ? `我看到 ${clueTarget.name} 的颜色是${playerColorText(clueTarget)}。`
    : "";
  const colorStatement = `我自己的颜色是${playerColorText(target)}。${seenColor}`;
  const attackerSignal = `${attacker.name} 已经攻击我，在我视角里敌意上升。`;
  const helpRequest = "我需要队友评估是否帮我挡刀，也想观察谁会主动站出来。";
  if (isLeader(target)) {
    return `${attackerSignal}${colorStatement} ${helpRequest} ${stripHtml(buildFinalAction(model))}`;
  }

  if (target.wounds >= 2) {
    return `${attackerSignal}我已经有 ${target.wounds} 点伤害，再吃伤害风险很高。${colorStatement} ${helpRequest}`;
  }

  return `${attackerSignal}${colorStatement} ${helpRequest}`;
}

function pickLine(options, ...keys) {
  const seed = keys.reduce((total, value) => total + Number(value || 0), state.logIndex || 0);
  return options[Math.abs(seed) % options.length];
}

function buildAttackChat(attacker, target) {
  const model = buildStrategyModel(attacker);
  if (model.bestAction.player.id === target.id) {
    return pickLine(
      [
        `我先打 ${target.name}，看看他怎么亮。`,
        `${target.name} 现在最值得开，我先动这刀。`,
        `这刀先给 ${target.name}，不是急着打死，是先把信息逼出来。`,
        `我打 ${target.name}。他这里最需要验一下。`,
        `先从 ${target.name} 开始，后面看他说什么、亮什么。`,
      ],
      attacker.id,
      target.id,
      state.logIndex,
    );
  }
  return pickLine(
    [
      `我先临时打 ${target.name}，这刀主要是试反应。`,
      `${target.name} 这里我想先碰一下，看看有没有人出来保。`,
      `我不把话说死，先打 ${target.name} 开点信息。`,
      `这刀我改打 ${target.name}，先看场上怎么动。`,
    ],
    attacker.id,
    target.id,
    state.logIndex,
  );
}

function buildDefenseChat(target, attacker) {
  const clueTarget = clueTargetFor(target);
  const seenColor = clueTarget ? `我看到 ${clueTarget.name} 的颜色是${playerColorText(clueTarget)}。` : "";
  const colorStatement = `我自己的颜色是${playerColorText(target)}。${seenColor}`;
  const teamCall = `${playerColorText(target)}队友在哪里，需要挡刀就直接站出来。`;
  if (isLeader(target)) {
    return pickLine(
      [
        `${attacker.name} 打我，这个信号我记下了。${colorStatement} ${teamCall}`,
        `${attacker.name} 这一刀不简单。${colorStatement} ${teamCall}`,
        `我被 ${attacker.name} 点了。${colorStatement} ${teamCall} 别乱挡，但要表态。`,
      ],
      target.id,
      attacker.id,
      state.logIndex,
    );
  }

  if (target.wounds >= 2) {
    return pickLine(
      [
        `${attacker.name} 又压我一刀，我现在伤不低了。${colorStatement} ${teamCall}`,
        `我这边血量已经危险了。${colorStatement} ${teamCall}`,
        `${attacker.name} 继续打我，我不能再随便吃了。${colorStatement} ${teamCall}`,
      ],
      target.id,
      attacker.id,
      state.logIndex,
    );
  }

  return pickLine(
    [
      `${attacker.name} 打我，我先记这个动作。${colorStatement} ${teamCall}`,
      `这刀落到我身上了。${colorStatement} ${teamCall}`,
      `${attacker.name} 先开我，那我也看看场上反应。${colorStatement} ${teamCall}`,
      `我被点了。${colorStatement} ${teamCall}`,
    ],
    target.id,
    attacker.id,
    state.logIndex,
  );
}

function attackPlayer(targetId) {
  performAttack(targetId, "手动选择攻击目标。");
}

function performAttack(targetId, purpose) {
  if (state.phase !== "action") return;

  const attacker = getPlayer(state.currentPlayerId);
  const target = getPlayer(targetId);
  state.pendingAttack = {
    attackerId: attacker.id,
    targetId: target.id,
    volunteerIds: [],
  };
  state.phase = "intervention";
  recordSignal("attack", { actorId: attacker.id, targetId: target.id });
  state.viewerId = target.id;
  addLog(`${attacker.name} 宣告攻击 ${target.name}。`);
  render();
}

function volunteerIntervention(playerId) {
  const player = getPlayer(playerId);
  if (!eligibleInterveners().some((candidate) => candidate.id === player.id)) return;

  state.pendingAttack.volunteerIds.push(player.id);
  recordSignal("intervention_offer", { actorId: player.id, targetId: state.pendingAttack.targetId, attackerId: state.pendingAttack.attackerId });
  state.viewerId = state.pendingAttack.targetId;
  addLog(`${player.name} 提出干预，愿意替 ${getPlayer(state.pendingAttack.targetId).name} 承受这次伤害。`);
  render();
}

function acceptIntervention(playerId) {
  const player = getPlayer(playerId);
  if (!state.pendingAttack.volunteerIds.includes(player.id)) return;

  const target = getPlayer(state.pendingAttack.targetId);
  recordSignal("intervention_accept", { actorId: target.id, targetId: player.id, attackerId: state.pendingAttack.attackerId });
  addLog(`${target.name} 接受 ${player.name} 的干预。`);
  resolveDamage(player.id, true);
}

function rejectIntervention() {
  const target = getPlayer(state.pendingAttack.targetId);
  const hadVolunteers = state.pendingAttack.volunteerIds.length > 0;
  state.pendingAttack.volunteerIds.forEach((volunteerId) => {
    recordSignal("intervention_reject", { actorId: target.id, targetId: volunteerId, attackerId: state.pendingAttack.attackerId });
  });
  addLog(
    hadVolunteers
      ? `${target.name} 拒绝所有干预。`
      : `无人干预，${target.name} 必须自己承伤。`,
  );
  resolveDamage(target.id, false);
}

function resolveDamage(playerId, fromIntervention) {
  const player = getPlayer(playerId);
  const attacker = getPlayer(state.pendingAttack.attackerId);
  startDamageSequence({
    targetId: player.id,
    sourceId: attacker.id,
    amount: 1,
    forcedRevealMarker: fromIntervention ? "rank" : null,
    nextPlayerId: player.id,
    label: fromIntervention ? "干预承伤" : "攻击伤害",
  });
}

function startDamageSequence({ targetId, sourceId, amount, forcedRevealMarker, nextPlayerId, label }) {
  if (state.damageSequence && state.phase === "ability") {
    state.damageStack.push(state.damageSequence);
  }

  state.damageSequence = {
    targetId,
    sourceId,
    remaining: amount,
    forcedRevealMarker,
    nextPlayerId,
    label,
    total: amount,
    suppressRankAbility: label.includes("刺客"),
  };
  advanceDamageSequence();
}

function advanceDamageSequence() {
  const sequence = state.damageSequence;
  if (!sequence || state.phase === "gameover") return;

  const target = getPlayer(sequence.targetId);
  const source = getPlayer(sequence.sourceId);

  if (target.wounds >= 3) {
    target.wounds = 4;
    addLog(`${target.name} 承受${sequence.label}造成的第4点伤害，被捕获。`);
    state.damageSequence = null;
    capturePlayer(target, source);
    render();
    return;
  }

  const resolvedIndex = sequence.total - sequence.remaining + 1;
  sequence.remaining -= 1;
  state.pendingDamagePlayerId = target.id;
  state.viewerId = target.id;
  state.damageSourcePlayerId = source.id;
  state.forcedRevealMarker = sequence.forcedRevealMarker;
  state.phase = "reveal";
  addLog(
    `${target.name} 承受第${resolvedIndex}点${sequence.label}，需要公开${
      sequence.forcedRevealMarker ? "Rank" : "一个未公开标记"
    }。`,
  );
  render();
}

function continueOrFinishDamageSequence(nextPlayerId) {
  if (state.damageSequence && state.damageSequence.remaining > 0) {
    advanceDamageSequence();
    return;
  }

  if (state.damageStack.length) {
    const stackedSequence = state.damageStack.pop();
    if (stackedSequence.remaining > 0) {
      state.damageSequence = stackedSequence;
      advanceDamageSequence();
      return;
    }
    finishDamageSequence(stackedSequence.nextPlayerId || nextPlayerId);
    return;
  }

  const finalNextPlayerId = state.damageSequence?.nextPlayerId || nextPlayerId;
  finishDamageSequence(finalNextPlayerId);
}

function passDagger(targetId) {
  performPass(targetId, "手动选择传递匕首。");
}

function performPass(targetId, purpose) {
  if (state.phase !== "action") return;

  const current = getPlayer(state.currentPlayerId);
  const target = getPlayer(targetId);
  state.currentPlayerId = target.id;
  state.viewerId = target.id;
  recordGameEvent("dagger", { actorId: current.id, targetId: target.id });
  addLog(`${current.name} 将匕首传给 ${target.name}。`);
  render();
}

function revealMarker(playerId, marker) {
  performReveal(playerId, marker, "手动选择公开该标记。");
}

function performReveal(playerId, marker, purpose) {
  if (state.phase !== "reveal") return;

  const player = getPlayer(playerId);
  if (!availableMarkers(player).includes(marker)) return;
  if (state.forcedRevealMarker && marker !== state.forcedRevealMarker) return;

  player.wounds += 1;
  player.revealed.push(marker);
  recordGameEvent("reveal", {
    actorId: player.id,
    marker,
    markerLabel: markerRevealLabel(marker, player),
    wounds: player.wounds,
    sourceId: state.damageSourcePlayerId,
  });
  addLog(`${player.name} 公开了 ${markerRevealLabel(marker, player)}，当前伤害 ${player.wounds} / 4。`);

  if (player.wounds >= 4) {
    state.damageSequence = null;
    capturePlayer(player, getPlayer(state.damageSourcePlayerId));
    render();
    return;
  }

  if (marker === "rank" && state.damageSequence?.suppressRankAbility) {
    addLog(`${player.name} 因技能伤害公开 Rank，但技能伤害不会触发角色能力。`);
  } else if (marker === "rank" && beginRankAbility(player)) {
    render();
    return;
  }

  continueOrFinishDamageSequence(player.id);
}

function finishDamageSequence(nextPlayerId) {
  state.currentPlayerId = nextPlayerId;
  state.viewerId = nextPlayerId;
  state.pendingAttack = null;
  state.pendingAbility = null;
  state.pendingDamagePlayerId = null;
  state.damageSourcePlayerId = null;
  state.damageSequence = null;
  state.damageStack = [];
  state.forcedRevealMarker = null;
  state.phase = "action";
  recordGameEvent("dagger", { targetId: nextPlayerId });
  addLog(`${getPlayer(nextPlayerId).name} 获得匕首，进入下一回合。`);
  render();
}

function beginRankAbility(player) {
  if (player.role === "长老") {
    state.leaderRule[player.clan] = "highest";
    recordGameEvent("ability", { actorId: player.id, ability: "长老" });
    addLog(`${player.name} 发动长老能力，本氏族领袖判定改为 Rank 最高者。`);
    return false;
  }

  if (player.role === "刺客") {
    state.phase = "ability";
    state.pendingAbility = { type: "assassin", playerId: player.id };
    state.viewerId = player.id;
    recordGameEvent("ability", { actorId: player.id, ability: "刺客" });
    addLog(`${player.name} 触发刺客能力，准备选择一名玩家造成2点直接伤害。`);
    return true;
  }

  if (player.role === "小丑") {
    state.phase = "ability";
    state.pendingAbility = { type: "harlequin", playerId: player.id, selectedIds: [] };
    state.viewerId = player.id;
    recordGameEvent("ability", { actorId: player.id, ability: "小丑" });
    addLog(`${player.name} 触发小丑能力，准备偷看两名玩家的完整身份。`);
    return true;
  }

  return false;
}

function useAssassinAbility(targetId) {
  if (state.phase !== "ability" || state.pendingAbility.type !== "assassin") return;

  const assassin = getPlayer(state.pendingAbility.playerId);
  const target = getPlayer(targetId);
  const skillRow = buildStrategyModel(assassin, false).assassinSkillRows.find((row) => row.player.id === target.id);
  addLog(`${assassin.name} 发动刺客能力，指定 ${target.name} 受到2点直接伤害。`);
  recordGameEvent("ability_target", { actorId: assassin.id, targetId: target.id, ability: "刺客" });
  state.pendingAttack = null;
  state.pendingAbility = null;
  startDamageSequence({
    targetId: target.id,
    sourceId: assassin.id,
    amount: 2,
    forcedRevealMarker: null,
    nextPlayerId: target.id,
    label: "刺客伤害",
  });
}

function useHarlequinAbility(targetId) {
  if (state.phase !== "ability" || state.pendingAbility.type !== "harlequin") return;
  if (state.pendingAbility.selectedIds.includes(targetId)) return;

  state.pendingAbility.selectedIds.push(targetId);
  const harlequin = getPlayer(state.pendingAbility.playerId);
  const target = getPlayer(targetId);
  addLog(`${harlequin.name} 使用小丑能力偷看了 ${target.name} 的身份。`);
  addPrivateLog(harlequin.id, `${harlequin.name} 偷看结果：${target.name} 是 ${fullRoleLabel(target)}。`);
  addPrivateIntel(harlequin.id, target);
  recordGameEvent("private_intel", { actorId: harlequin.id, targetId: target.id, privateForId: harlequin.id });

  if (state.pendingAbility.selectedIds.length >= 2) {
    state.pendingAbility = null;
    continueOrFinishDamageSequence(harlequin.id);
    return;
  }

  render();
}

function autoStep() {
  if (state.phase === "setup" || state.phase === "gameover") return;

  if (state.phase === "intervention") {
    autoInterventionStep();
    return;
  }

  if (state.phase === "ability") {
    switchViewerSilently(state.pendingAbility.playerId);
    autoAbilityStep();
    return;
  }

  if (state.phase === "reveal") {
    const player = getPlayer(state.pendingDamagePlayerId);
    switchViewerSilently(player.id);
    const marker = state.forcedRevealMarker || chooseRevealMarker(player);
    performReveal(player.id, marker, explainRevealPurpose(marker));
    return;
  }

  const current = getPlayer(state.currentPlayerId);
  switchViewerSilently(current.id);
  const model = latestStrategyModel(current);
  const target = chooseSafeAutoAttackTarget(model);
  if (!target) {
    const passTarget = chooseAutoPassTarget(current);
    performPass(passTarget.id, "当前没有可安全捕获的目标，避免抓错目标导致对方获胜。");
    return;
  }
  performAttack(target.id, `${explainAttackPurpose(current, target)} 依据：${attackEvidence(current, target)}`);
}

function chooseSafeAutoAttackTarget(model) {
  const safeScore = model.actionScores.find((score) => score.captureOutcome?.type === "win" || score.captureOutcome?.type === "safe");
  if (safeScore) return safeScore.player;
  const forcedRiskScore = model.actionScores.find((score) => score.captureOutcome?.type === "unknown");
  return forcedRiskScore?.player || null;
}

function chooseAutoPassTarget(current) {
  return activePlayers().find((player) => player.id !== current.id) || current;
}

function toggleAutoRun() {
  if (state.autoRunning) {
    stopAutoRun("用户暂停自动推演。");
    return;
  }
  startAutoRun();
}

function startAutoRun() {
  if (state.phase === "setup" || state.phase === "gameover") return;
  if (state.autoRunning) return;

  state.autoRunning = true;
  state.autoStepCount = 0;
  state.autoStallCount = 0;
  addLog("自动推演到底开始。");
  render();
  scheduleAutoRunTick();
}

function scheduleAutoRunTick() {
  clearAutoTimer();
  state.autoTimerId = setTimeout(autoRunTick, 180);
}

function autoRunTick() {
  if (!state.autoRunning) return;

  if (state.phase === "gameover") {
    stopAutoRun(`自动推演完成：${state.winner} 获胜。`);
    return;
  }

  if (state.autoStepCount >= state.autoStepLimit) {
    stopAutoRun("自动推演暂停：达到安全步数上限。");
    return;
  }

  const before = autoStateSignature();
  state.autoStepCount += 1;
  autoStep();
  const after = autoStateSignature();

  state.autoStallCount = before === after ? state.autoStallCount + 1 : 0;
  if (state.autoStallCount >= 3) {
    stopAutoRun("自动推演停止：状态未推进。");
    return;
  }

  if (state.phase === "gameover") {
    stopAutoRun(`自动推演完成：${state.winner} 获胜。`);
    return;
  }

  actionHint.textContent = `自动推演中：第 ${state.autoStepCount} 步`;
  scheduleAutoRunTick();
}

function stopAutoRun(reason = "", options = {}) {
  clearAutoTimer();
  const wasRunning = state.autoRunning;
  state.autoRunning = false;
  state.autoStallCount = 0;

  if (!options.silent && reason && (wasRunning || state.phase !== "setup")) {
    addLog(reason);
  }
  if (!options.silent) render();
}

function clearAutoTimer() {
  if (!state.autoTimerId) return;
  clearTimeout(state.autoTimerId);
  state.autoTimerId = null;
}

function autoStateSignature() {
  return JSON.stringify({
    phase: state.phase,
    currentPlayerId: state.currentPlayerId,
    pendingAttack: state.pendingAttack,
    pendingAbility: state.pendingAbility,
    pendingDamagePlayerId: state.pendingDamagePlayerId,
    damageSourcePlayerId: state.damageSourcePlayerId,
    forcedRevealMarker: state.forcedRevealMarker,
    damageSequence: state.damageSequence,
    players: state.players.map((player) => ({
      id: player.id,
      wounds: player.wounds,
      revealed: player.revealed.join(","),
      captured: player.captured,
    })),
    logs: state.publicLogs.length,
    chats: state.chatMessages.length,
    events: state.gameEvents.length,
  });
}

function autoInterventionStep() {
  const attack = state.pendingAttack;
  const attacker = getPlayer(attack.attackerId);
  const target = getPlayer(attack.targetId);
  const volunteer = chooseIntervener(attacker, target);

  if (volunteer && !attack.volunteerIds.includes(volunteer.id)) {
    switchViewerSilently(volunteer.id);
    attack.volunteerIds.push(volunteer.id);
    recordSignal("intervention_offer", { actorId: volunteer.id, targetId: target.id, attackerId: attacker.id });
    addLog(`${volunteer.name} 提出干预，愿意替 ${target.name} 承伤。目的：${explainInterventionPurpose(volunteer, target)} 依据：${interventionEvidence(volunteer, target)}`);
    addChatMessage(volunteer.id, buildInterventionOfferChat(volunteer, target), true);
    render();
    return;
  }

  if (attack.volunteerIds.length) {
    switchViewerSilently(target.id);
    const accepted = chooseAcceptedIntervener(target);
    if (!accepted) {
      attack.volunteerIds.forEach((volunteerId) => {
        recordSignal("intervention_reject", { actorId: target.id, targetId: volunteerId, attackerId: attacker.id });
      });
      const rejectionReason = buildRejectInterventionReason(target);
      addLog(`${target.name} 拒绝干预。目的：${rejectionReason} 依据：${acceptEvidence(target)}`);
      addChatMessage(target.id, buildRejectInterventionChat(target), true);
      resolveDamage(target.id, false);
      return;
    }
    recordSignal("intervention_accept", { actorId: target.id, targetId: accepted.id, attackerId: attacker.id });
    const evaluation = evaluateInterventionForTarget(target, accepted);
    addLog(`${target.name} 接受 ${accepted.name} 的干预。目的：${evaluation.reason} 依据：${acceptEvidence(target, accepted)}`);
    addChatMessage(target.id, buildAcceptInterventionChat(target, accepted), true);
    resolveDamage(accepted.id, true);
    return;
  }

  switchViewerSilently(target.id);
  addLog(`无人干预，${target.name} 必须自己承伤。目的：其他玩家不愿在情报不足时暴露Rank。依据：没有符合自身可见信息的可信保护目标。`);
  resolveDamage(target.id, false);
}

function autoAbilityStep() {
  const owner = getPlayer(state.pendingAbility.playerId);

  if (state.pendingAbility.type === "assassin") {
    const target = chooseAssassinSkillTarget(owner);
    useAssassinAbility(target.id);
    return;
  }

  if (state.pendingAbility.type === "harlequin") {
    const target = chooseHarlequinPeekTarget(owner);
    useHarlequinAbility(target.id);
  }
}

function capturePlayer(player, capturer) {
  player.captured = true;
  const opposingLeaderClan = capturer.clan === "Rose" ? "Beast" : "Rose";
  const targetIsEnemyLeader = player.clan === opposingLeaderClan && isLeader(player);
  const winnerClan = targetIsEnemyLeader ? capturer.clanName : oppositeClanName(capturer.clan);

  state.phase = "gameover";
  state.winner = winnerClan;
  state.pendingAttack = null;
  state.pendingAbility = null;
  state.pendingDamagePlayerId = null;
  state.damageSourcePlayerId = null;
  state.forcedRevealMarker = null;
  state.damageSequence = null;
  state.damageStack = [];
  recordGameEvent("capture", { actorId: capturer.id, targetId: player.id, winner: winnerClan });
  addLog(`${player.name} 被捕获，真实身份是 ${fullRoleLabel(player)}。`);
  addLog(
    targetIsEnemyLeader
      ? `${capturer.name} 抓到了敌方领袖，${capturer.clanName} 胜利。`
      : `${capturer.name} 抓错目标，${oppositeClanName(capturer.clan)} 胜利。`,
  );
}

function openIdentityModal(playerId, mode) {
  const player = getPlayer(playerId);
  const leftNeighbor = getPlayer(player.id === 1 ? 6 : player.id - 1);
  const viewer = getViewer();
  modalBox.classList.remove("strategy-mode", "dragging");
  modalBody.scrollTop = 0;

  if (mode === "clue") {
    if (isGodView()) {
      modalTitle.textContent = `${player.name} 的线索`;
      modalBody.innerHTML = `<div class="identity-card"><p>${player.clue}</p></div>`;
    } else if (!viewer) {
      modalTitle.textContent = "线索不可见";
      modalBody.innerHTML = `<div class="identity-card"><p>全局公开视角不能查看私密线索。请切换到对应玩家视角。</p></div>`;
    } else if (viewer.id === player.id || canSeeClue(viewer, player)) {
      modalTitle.textContent = `${viewer.name} 可见线索`;
      modalBody.innerHTML = `
        <div class="identity-card">
          <p><strong>${viewer.name}</strong> 当前可看到 <strong>${player.name}</strong> 的线索：</p>
          <p>${player.clue}</p>
        </div>
      `;
    } else {
      modalTitle.textContent = "线索不可见";
      modalBody.innerHTML = `<div class="identity-card"><p>${viewer.name} 当前不能查看 ${player.name} 的线索。</p></div>`;
    }
  } else {
    if (isGodView() || viewer?.id === player.id || player.captured) {
      modalTitle.textContent = `${player.name} 的身份`;
      modalBody.innerHTML = `
        <div class="identity-card ${player.clan.toLowerCase()}">
          <p><strong>阵营：</strong>${player.clanName}</p>
          <p><strong>角色：</strong>${player.role}</p>
          <p><strong>Rank：</strong>${player.rank}${isLeader(player) ? "，本氏族当前领袖" : ""}</p>
          <p><strong>线索：</strong>${player.clue}</p>
          <p><strong>可公开标记：</strong>${player.markers.map((marker) => markerRevealLabel(marker, player)).join("、")}</p>
        </div>
      `;
    } else {
      modalTitle.textContent = "身份不可见";
      modalBody.innerHTML = `<div class="identity-card"><p>${viewer ? viewer.name : "全局公开视角"} 当前不能查看 ${player.name} 的完整身份。</p></div>`;
    }
  }

  identityModal.classList.remove("hidden");
}

function openStrategyModal(playerId) {
  const player = getPlayer(playerId);
  state.strategyModalPlayerId = player.id;
  recomputeAllStrategies("打开策略弹窗");
  modalBox.classList.add("strategy-mode");
  modalBox.classList.remove("dragging");
  modalTitle.textContent = `${player.name} 当前最优策略`;
  modalBody.innerHTML = buildStrategyHtml(player);
  modalBody.scrollTop = 0;
  identityModal.classList.remove("hidden");
}

function openForcedWinModal(playerId) {
  state.strategyModalPlayerId = null;
  const player = getPlayer(playerId);
  const forcedWin = detectForcedWinFor(player);
  modalBox.classList.add("strategy-mode");
  modalBox.classList.remove("dragging");
  modalTitle.textContent = `${player.name} 发现的必胜法则`;
  modalBody.innerHTML = forcedWin ? buildForcedWinHtml(forcedWin) : `<div class="identity-card"><p>当前没有严格成立的必胜法则。</p></div>`;
  modalBody.scrollTop = 0;
  identityModal.classList.remove("hidden");
}

function openRulesModal(type) {
  state.strategyModalPlayerId = null;
  modalBox.classList.add("strategy-mode");
  modalBox.classList.remove("dragging");
  modalTitle.textContent = type === "roles" ? "公开角色看板" : "通用规则";
  modalBody.innerHTML = type === "roles" ? buildRoleBoardRulesHtml() : buildGeneralRulesHtml();
  modalBody.scrollTop = 0;
  identityModal.classList.remove("hidden");
}

function buildGeneralRulesHtml() {
  return `
    <div class="rules-modal-content">
      <section class="rules-section">
        <ul>
          <li>6人局：玫瑰3人、野兽3人。</li>
          <li>本局临时公开信息：场上只包含 Rank 1 长老、Rank 2 刺客、Rank 3 小丑；每个阵营各有 1、2、3。</li>
          <li>默认每个氏族 Rank 最小者为领袖。</li>
          <li>持匕首玩家可攻击或传递。</li>
          <li>普通攻击进入干预阶段。</li>
          <li>未公开 Rank 的非攻击者、非目标玩家可以干预。</li>
          <li>目标玩家可以接受一名干预者，也可以拒绝全部干预。</li>
          <li>干预承伤必须公开 Rank，并可触发角色能力。</li>
          <li>技能伤害不可干预。</li>
          <li>技能伤害导致公开 Rank 时，不触发角色能力。</li>
          <li>第4点伤害捕获并结算胜负：抓到敌方领袖获胜，抓错非领袖则对方获胜。</li>
          <li>每名玩家只应看到自己合法可见的信息；隐藏身份和小丑偷看结果不自动公开。</li>
        </ul>
      </section>
    </div>
  `;
}

function buildRoleBoardRulesHtml() {
  return `
    <div class="rules-modal-content">
      <section class="role-board">
        <article class="role-rule-card">
          <div class="role-rule-head">
            <span class="rank-badge">Rank 1</span>
            <h3>长老</h3>
          </div>
          <div class="rule-markers">
            <div class="marker-set" aria-label="玫瑰长老公开标记">
              ${markerPill("rose", "玫瑰阵营")}
              ${markerPill("rose", "玫瑰阵营")}
              ${markerPill("rank", "Rank")}
            </div>
            <div class="marker-set" aria-label="野兽长老公开标记">
              ${markerPill("beast", "野兽阵营")}
              ${markerPill("beast", "野兽阵营")}
              ${markerPill("rank", "Rank")}
            </div>
          </div>
          <p><strong>相邻线索：</strong>本阵营线索。</p>
          <p><strong>能力：</strong>拿取鹅毛笔；本氏族改由 Rank 最大者成为当前领袖。</p>
        </article>

        <article class="role-rule-card">
          <div class="role-rule-head">
            <span class="rank-badge">Rank 2</span>
            <h3>刺客</h3>
          </div>
          <div class="rule-markers">
            ${markerPill("unknown", "?")}
            ${markerPill("unknown", "?")}
            ${markerPill("rank", "Rank")}
          </div>
          <p><strong>相邻线索：</strong>本阵营线索。</p>
          <p><strong>能力：</strong>指定一名玩家一次受到2点不可干预的技能伤害；技能伤害公开 Rank 不触发能力；伤害结算后匕首交给该玩家。</p>
        </article>

        <article class="role-rule-card">
          <div class="role-rule-head">
            <span class="rank-badge">Rank 3</span>
            <h3>小丑</h3>
          </div>
          <div class="rule-markers">
            ${markerPill("unknown", "?")}
            ${markerPill("unknown", "?")}
            ${markerPill("rank", "Rank")}
          </div>
          <p><strong>相邻线索：</strong>相反阵营线索。</p>
          <p><strong>能力：</strong>私下查看两名玩家完整身份；结果只进入小丑玩家私密日志，不自动公开到聊天室。</p>
        </article>
      </section>
    </div>
  `;
}

function markerPill(type, label) {
  const text = type === "rose" || type === "beast" ? "🌹" : label;
  const iconOnlyClass = type === "rose" || type === "beast" ? " marker-icon-only" : "";
  return `<span class="marker ${type}${iconOnlyClass}" title="${label}" aria-label="${label}">${text}</span>`;
}

function closeIdentityModal() {
  identityModal.classList.add("hidden");
  modalBox.classList.remove("strategy-mode", "dragging");
  state.strategyModalPlayerId = null;
  strategyDrag = null;
}

function startStrategyDrag(event) {
  if (!modalBox.classList.contains("strategy-mode") || event.button !== 0) return;
  strategyDrag = {
    pointerId: event.pointerId,
    y: event.clientY,
  };
  modalBox.classList.add("dragging");
  modalBody.setPointerCapture?.(event.pointerId);
}

function moveStrategyDrag(event) {
  if (!strategyDrag || strategyDrag.pointerId !== event.pointerId) return;
  const deltaY = strategyDrag.y - event.clientY;
  modalBody.scrollTop += deltaY;
  strategyDrag.y = event.clientY;
  event.preventDefault();
}

function endStrategyDrag(event) {
  if (!strategyDrag || strategyDrag.pointerId !== event.pointerId) return;
  modalBody.releasePointerCapture?.(event.pointerId);
  strategyDrag = null;
  modalBox.classList.remove("dragging");
}

function updateViewerSelect() {
  if (!viewerSelect) return;
  viewerSelect.innerHTML = [
    `<option value="0">全局公开视角</option>`,
    `<option value="-1">上帝视角</option>`,
    ...state.players.map((player) => `<option value="${player.id}">${player.name} 视角</option>`),
  ].join("");
  viewerSelect.value = String(state.viewerId);
}

function switchViewer(playerId) {
  state.viewerId = playerId;
  if (viewerSelect) viewerSelect.value = String(playerId);
  render();
}

function switchViewerSilently(playerId) {
  state.viewerId = playerId;
  if (viewerSelect) viewerSelect.value = String(playerId);
}

function getViewer() {
  return state.viewerId > 0 ? getPlayer(state.viewerId) : null;
}

function isGodView() {
  return state.viewerId === -1;
}

function visibleIdentityLine(viewer, player) {
  if (isGodView()) return `完整身份：${cardRoleLabel(player)}`;
  if (player.captured) return `公开身份：${cardRoleLabel(player)}`;
  if (viewer?.id === player.id) return `你的身份：${cardRoleLabel(player)}`;
  if (viewer && hasPrivateIntel(viewer, player)) return `偷看身份：${cardRoleLabel(player)}`;
  return "身份：未公开";
}

function playerBadgeHtml(player) {
  if (state.phase === "intervention" && state.pendingAttack) {
    if (player.id === state.pendingAttack.attackerId) return `<span class="attack-tag">已出刀</span>`;
    if (player.id === state.pendingAttack.targetId) return `<span class="target-tag">受攻击</span>`;
    return "";
  }
  return player.id === state.currentPlayerId ? `<span class="dagger">匕首</span>` : "";
}

function visibleClueLine(viewer, player) {
  if (isGodView()) return clueProfileLine(player);
  if (!viewer) return "线索：仅玩家视角可见";
  if (viewer.id === player.id || player.captured) return clueProfileLine(player);
  if (hasPrivateIntel(viewer, player)) return clueProfileLine(player);
  if (canSeeClue(viewer, player)) return visibleColorClueLine(player);
  return "线索：不可见";
}

function activePlayers() {
  return state.players.filter((player) => !player.captured);
}

function availableMarkers(player) {
  return player.markers.filter((marker) => !player.revealed.includes(marker));
}

function markerType(marker) {
  if (marker === "rank") return "rank";
  if (marker.startsWith("rose")) return "rose";
  if (marker.startsWith("beast")) return "beast";
  if (marker.startsWith("unknown")) return "unknown";
  return marker;
}

function hasRevealed(player, type) {
  return player.revealed.some((marker) => markerType(marker) === type);
}

function firstAvailableMarkerOfType(player, type) {
  return availableMarkers(player).find((marker) => markerType(marker) === type);
}

function eligibleInterveners() {
  if (!state.pendingAttack) return [];
  return activePlayers().filter(
    (player) =>
      player.id !== state.pendingAttack.attackerId &&
      player.id !== state.pendingAttack.targetId &&
      !hasRevealed(player, "rank") &&
      !state.pendingAttack.volunteerIds.includes(player.id),
  );
}

function markerTemplate(marker, player) {
  const type = markerType(marker);
  const className = type === "rank" ? "rank" : type === "rose" || type === "beast" || type === "unknown" ? type : "";
  const iconOnlyClass = type === "rose" || type === "beast" ? " marker-icon-only" : "";
  const label = type === "rose" ? "玫瑰阵营" : type === "beast" ? "野兽阵营" : markerRevealLabel(marker, player);
  return `<span class="marker ${className}${iconOnlyClass}" title="${label}" aria-label="${label}">${markerRevealLabel(marker, player)}</span>`;
}

function markerRevealLabel(marker, player) {
  const type = markerType(marker);
  if (type === "rank") return `Rank ${player.rank}`;
  if (type === "rose") return "🌹";
  if (type === "beast") return "🌹";
  return MARKER_LABELS[type];
}

function fullRoleLabel(player) {
  return `${player.clanName} / ${player.role} / Rank ${player.rank}`;
}

function cardRoleLabel(player) {
  return `${clanMarkerTemplate(player.clan)} / ${player.role} / Rank ${player.rank}`;
}

function buildStrategyHtml(player) {
  const snapshot = strategySnapshotFor(player);
  const model = snapshot?.model || buildStrategyModel(player);
  const clueColor = colorTextFromClue(model.clueTarget.clue);
  const targetRows = model.targetCandidates
    .map(
      (candidate) => `
        <tr>
          <td>${escapeHtml(roleText(candidate))}</td>
          <td>${candidate.clan === player.clan ? "己方" : "敌人"}</td>
          <td>1/${model.targetCandidates.length}</td>
        </tr>
      `,
    )
    .join("");
  const actionRows = model.actionScores
    .map(
      (score, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${score.player.name}</td>
          <td><span class="strategy-danger">${formatFraction(score.enemyLeaderNumerator, score.denominator)}</span></td>
          <td><span class="strategy-danger">${formatFraction(score.enemyNumerator, score.denominator)}</span></td>
          <td>${formatFraction(score.allyLeaderNumerator, score.denominator)}</td>
          <td>${formatFraction(score.allyNumerator, score.denominator)}</td>
        </tr>
      `,
    )
    .join("");
  const targetScore = model.actionScores.find((score) => score.player.id === model.clueTarget.id);
  const bestScore = model.bestAction;
  const impossibleNotes = model.impossibleNotes.map((note) => `<li>${note}</li>`).join("");
  const uncertaintyText = model.targetHasJesterCandidate
    ? `候选里仍有小丑，因此颜色存在反色风险，不能只凭颜色当作铁身份。`
    : `候选里没有小丑，反色可能已经被排除；不能再用“小丑会反色”替 ${model.clueTarget.name} 辩护。`;
  const targetEnemyProb = formatFraction(targetScore.enemyNumerator, targetScore.denominator);
  const targetEnemyLeaderProb = formatFraction(targetScore.enemyLeaderNumerator, targetScore.denominator);
  const bestEnemyProb = formatFraction(bestScore.enemyNumerator, bestScore.denominator);
  const bestEnemyLeaderProb = formatFraction(bestScore.enemyLeaderNumerator, bestScore.denominator);
  const bestAllyLeaderProb = formatFraction(bestScore.allyLeaderNumerator, bestScore.denominator);
  const summaryHtml = buildStrategySummaryHtml(model, bestScore, bestEnemyProb, bestEnemyLeaderProb, bestAllyLeaderProb);

  return `
    <div class="strategy-card">
      ${summaryHtml}

      ${buildStrategyBasisHtml(snapshot)}

      ${buildCurrentStageHtml(model)}

      ${buildPrivateIntelHtml(model)}

      ${buildHarlequinIntelDispositionHtml(model)}

      ${buildAssassinTimingHtml(model)}

      ${buildWitnessStrategyHtml(model)}

      ${buildJesterBreakoutHtml(model)}

      ${buildElderInterventionRiskHtml(model)}

      ${buildJesterContradictionHtml(model)}

      ${buildBattleStrategyTableHtml(model)}

      <section class="strategy-section">
        <h3>一、可能性判断</h3>
        <p>我是 ${escapeHtml(fullRoleLabel(player))}。本局公开牌池只有 Rank 1 长老、Rank 2 刺客、Rank 3 小丑；我开局只看到 ${model.clueTarget.name} 的颜色是${clueColor}。</p>
        <div class="strategy-table-wrap">
          <table class="strategy-table">
            <thead>
              <tr>
                <th>${model.clueTarget.name} 可能身份</th>
                <th>阵营关系</th>
                <th>概率</th>
              </tr>
            </thead>
            <tbody>${targetRows}</tbody>
          </table>
        </div>
        ${impossibleNotes ? `<ul class="strategy-list">${impossibleNotes}</ul>` : ""}
        <p>${model.clueTarget.name} 是敌人的概率是 <span class="strategy-danger">${targetEnemyProb}</span>，是敌方领袖的概率是 <span class="strategy-danger">${targetEnemyLeaderProb}</span>。<span class="strategy-key">${uncertaintyText}</span></p>
        <p><span class="strategy-key">当前判断：</span><span class="strategy-danger">${bestScore.player.name}</span> 的胜率排序最高，理由是敌方领袖概率 <span class="strategy-danger">${bestEnemyLeaderProb}</span>、敌人概率 <span class="strategy-danger">${bestEnemyProb}</span>、误伤己方领袖概率 ${bestAllyLeaderProb}。</p>
      </section>

      <section class="strategy-section">
        <h3>二、心路历程</h3>
        ${buildReasoningParagraphs(model)}
        <div class="strategy-table-wrap">
          <table class="strategy-table">
            <thead>
              <tr>
                <th>排序</th>
                <th>目标</th>
                <th>P(敌方领袖)</th>
                <th>P(敌人)</th>
                <th>P(己方领袖)</th>
                <th>P(己方)</th>
              </tr>
            </thead>
            <tbody>${actionRows}</tbody>
          </table>
        </div>
      </section>

      <section class="strategy-section">
        <h3>三、公开说法</h3>
        <p>${buildPublicStatement(model)}</p>
      </section>

      <section class="strategy-section">
        <h3>四、最后行动</h3>
        <p>${buildFinalAction(model)}</p>
        <p><span class="strategy-key">推荐：</span><span class="strategy-danger">攻击 ${bestScore.player.name}</span>。</p>
      </section>
    </div>
  `;
}

function buildStrategyBasisHtml(snapshot) {
  if (!snapshot) return "";

  const hardFacts = snapshot.hardFacts
    .slice(0, 10)
    .map((fact) => `<li>${escapeHtml(fact)}</li>`)
    .join("");
  const recentEvents = snapshot.recentEvents
    .map((event) => `<li>${escapeHtml(eventTextFor(getPlayer(snapshot.playerId), event))}</li>`)
    .join("");

  return `
    <section class="strategy-section">
      <h3>本轮更新依据</h3>
      <p><span class="strategy-key">刷新原因：</span>${escapeHtml(snapshot.reason)}；已处理事件 ${snapshot.eventCount} 条。</p>
      <p><span class="strategy-key">硬事实：</span></p>
      <ul class="strategy-list">${hardFacts}</ul>
      <p><span class="strategy-key">最近影响判断的事件：</span></p>
      <ul class="strategy-list">${recentEvents || "<li>暂无事件。</li>"}</ul>
    </section>
  `;
}

function buildForcedWinHtml(forcedWin) {
  const steps = forcedWin.steps.map((step) => `<li>${step}</li>`).join("");
  return `
    <div class="strategy-card">
      <section class="strategy-summary">
        <p><span class="strategy-key">必胜结论：</span><span class="strategy-danger">${forcedWin.title}</span></p>
        <p class="strategy-muted">${forcedWin.summary}</p>
      </section>

      <section class="strategy-section">
        <h3>一、已知事实</h3>
        <p>${forcedWin.facts}</p>
      </section>

      <section class="strategy-section">
        <h3>二、不可破解原因</h3>
        <p>${forcedWin.lockReason}</p>
      </section>

      <section class="strategy-section">
        <h3>三、执行顺序</h3>
        <ul class="strategy-list">${steps}</ul>
      </section>

      <section class="strategy-section">
        <h3>四、胜利结果</h3>
        <p><span class="strategy-danger">${forcedWin.result}</span></p>
      </section>
    </div>
  `;
}

function buildStrategyModel(player, includeIntervention = true) {
  const clueTarget = clueTargetFor(player);
  const knownRolePlayers = state.players.filter((candidate) => candidate.id !== player.id && knownRoleTo(player, candidate));
  const knownRoles = knownRolePlayers.map((candidate) => knownRoleTo(player, candidate));
  const remainingRoles = ROLE_DECK.filter(
    (role) => !sameRole(role, player) && !knownRoles.some((knownRole) => sameRole(role, knownRole)),
  );
  const clueClanValue = clueClan(clueTarget.clue);
  const knownClueTarget = knownRoleTo(player, clueTarget);
  const targetCandidates = knownClueTarget
    ? [knownClueTarget]
    : remainingRoles.filter((role) => clueClan(role.clue) === clueClanValue);
  const unknownPlayers = activePlayers().filter(
    (candidate) => candidate.id !== player.id && candidate.id !== clueTarget.id && !knownRoleTo(player, candidate),
  );
  const privateIntelTargets = privateIntelFor(player).map((entry) => getPlayer(entry.targetId)).filter(Boolean);
  const worlds = targetCandidates.map((targetRole) => ({
    targetRole,
    remainingUnknownRoles: remainingRoles.filter((role) => !sameRole(role, targetRole)),
  }));
  const actionScores = activePlayers()
    .filter((candidate) => candidate.id !== player.id)
    .map((candidate) => buildActionScore(player, clueTarget, unknownPlayers, worlds, candidate))
    .sort(compareActionScore);
  const assassinSkillRows = buildAssassinSkillRows(player, actionScores);
  const targetHasJesterCandidate = targetCandidates.some((role) => role.rank === 3);
  const targetEnemyCount = targetCandidates.filter((role) => role.clan !== player.clan).length;
  const targetAllyCount = targetCandidates.length - targetEnemyCount;

  return {
    player,
    clueTarget,
    unknownPlayers,
    targetCandidates,
    targetHasJesterCandidate,
    targetIsCertainEnemy: targetCandidates.length > 0 && targetEnemyCount === targetCandidates.length,
    targetIsCertainAlly: targetCandidates.length > 0 && targetAllyCount === targetCandidates.length,
    knownRolePlayers,
    privateIntelTargets,
    harlequinIntelDecision: buildHarlequinIntelDecision(player),
    impossibleNotes: buildImpossibleNotes(player, clueTarget, clueClanValue, remainingRoles, targetCandidates, knownRolePlayers),
    signals: signalsForPlayer(player),
    interventionEvaluations: includeIntervention ? buildInterventionEvaluationsFor(player) : [],
    assassinSkillRows,
    bestAssassinSkill: assassinSkillRows[0] || null,
    actionScores,
    bestAction: actionScores[0],
  };
}

function latestStrategyModel(player) {
  return strategySnapshotFor(player)?.model || buildStrategyModel(player);
}

function detectForcedWinFor(observer) {
  if (!observer || observer.captured || state.phase === "setup" || state.phase === "gameover") return null;
  return (
    detectAssassinSkillForcedWin(observer) ||
    detectUnblockableAttackForcedWin(observer) ||
    detectHarlequinCoordinatedForcedWin(observer) ||
    detectTempoRaceForcedWin(observer)
  );
}

function detectAssassinSkillForcedWin(observer) {
  if (state.phase !== "ability" || state.pendingAbility?.type !== "assassin") return null;
  const assassin = getPlayer(state.pendingAbility.playerId);
  if (!isKnownAlly(observer, assassin)) return null;

  const target = activePlayers().find(
    (candidate) =>
      candidate.id !== assassin.id &&
      candidate.wounds >= 2 &&
      isKnownEnemyLeader(observer, candidate),
  );
  if (!target) return null;

  return {
    title: `${assassin.name} 发动刺客技能击杀 ${target.name}`,
    summary: "刺客技能已经处于待结算阶段，目标是已确认敌方长老且已有2点伤害。",
    facts: `${observer.name} 已知 ${assassin.name} 是己方刺客；${target.name} 是敌方当前长老，且已经 ${target.wounds}/4 伤。`,
    lockReason: "刺客技能是2点不可干预技能伤害。目标从2伤或更高直接到4伤被捕获，中途公开 Rank 也不会触发长老能力。",
    steps: [
      `${assassin.name} 立即发动刺客技能指定 ${target.name}。`,
      `${target.name} 连续受到2点技能伤害，不能被其他玩家干预。`,
      `${target.name} 达到4伤并被捕获。`,
    ],
    result: `${target.name} 是敌方长老，捕获后 ${observer.clanName} 获胜。`,
  };
}

function detectUnblockableAttackForcedWin(observer) {
  if (state.phase !== "action") return null;
  const attacker = getPlayer(state.currentPlayerId);
  if (!isKnownAlly(observer, attacker)) return null;

  const target = activePlayers().find(
    (candidate) =>
      candidate.id !== attacker.id &&
      candidate.wounds >= 3 &&
      isKnownEnemyLeader(observer, candidate) &&
      !hasLegalIntervenerForAttack(attacker, candidate),
  );
  if (!target) return null;

  return {
    title: `${attacker.name} 直接攻击 ${target.name}`,
    summary: "当前持刀玩家可以直接攻击已确认的3伤敌方长老，且没有合法干预者。",
    facts: `${observer.name} 已知 ${attacker.name} 是己方玩家；${target.name} 是敌方当前长老，且已经 ${target.wounds}/4 伤。`,
    lockReason: "目标再受到1点普通伤害就会被捕获；当前场上不存在未公开 Rank 且可合法干预的第三方玩家。",
    steps: [
      `${attacker.name} 宣告攻击 ${target.name}。`,
      "无人可以合法干预，本次伤害必须由目标承受。",
      `${target.name} 达到4伤并被捕获。`,
    ],
    result: `${target.name} 是敌方长老，捕获后 ${observer.clanName} 获胜。`,
  };
}

function detectHarlequinCoordinatedForcedWin(observer) {
  if (observer.rank !== 3) return null;
  const intelTargets = privateIntelFor(observer).map((entry) => getPlayer(entry.targetId)).filter(Boolean);
  const enemyLeader = intelTargets.find((target) => target.wounds >= 2 && isKnownEnemyLeader(observer, target));
  if (!enemyLeader) return null;

  const readyAssassin = activePlayers().find(
    (candidate) =>
      candidate.id !== observer.id &&
      candidate.clan === observer.clan &&
      candidate.rank === 2 &&
      state.phase === "ability" &&
      state.pendingAbility?.type === "assassin" &&
      state.pendingAbility.playerId === candidate.id,
  );
  if (!readyAssassin) return null;

  return {
    title: `${observer.name} 指挥 ${readyAssassin.name} 刺杀 ${enemyLeader.name}`,
    summary: "小丑已经通过私密情报确认敌方长老，且己方刺客技能正在待结算。",
    facts: `${observer.name} 偷看确认 ${enemyLeader.name} 是敌方长老；${readyAssassin.name} 是己方刺客并且正在选择技能目标。`,
    lockReason: "这条路线不依赖欺骗或对方接受干预。刺客技能不可干预，2伤敌方长老会被技能直接捕获。",
    steps: [
      `${observer.name} 公开指认 ${enemyLeader.name} 是敌方长老。`,
      `${readyAssassin.name} 发动刺客技能指定 ${enemyLeader.name}。`,
      `${enemyLeader.name} 承受2点不可干预技能伤害并被捕获。`,
    ],
    result: `捕获敌方长老后，${observer.clanName} 获胜。`,
  };
}

function detectTempoRaceForcedWin(observer) {
  const race = buildTempoRaceModel(observer);
  if (!race.canCompare || race.ourWorst >= race.enemyBest) return null;

  return {
    title: `${observer.clanName} 进入刀数竞速必胜`,
    summary: `我方最坏还需 ${race.ourWorst} 刀，敌方最快还需 ${race.enemyBest} 刀。`,
    facts: `${race.ourFacts} ${race.enemyFacts}`,
    lockReason: `按敌方最佳防守计算，我方最多 ${race.ourWorst} 刀完成；按敌方最快进攻计算，对方至少 ${race.enemyBest} 刀完成。因为 ${race.ourWorst} < ${race.enemyBest}，对方无法在竞速中先完成捕获。`,
    steps: race.steps,
    result: `按当前已知局面推进，${observer.clanName} 会先捕获敌方长老。`,
  };
}

function buildBattleStrategyTableHtml(model) {
  const battle = buildBattleStrategyModel(model.player);
  const race = battle.race;
  const combo = battle.combo;
  const leaderRows = battle.leaderRows
    .map(
      (row) => `
        <tr>
          <td>${row.side}</td>
          <td>${row.player ? row.player.name : "未确认"}</td>
          <td>${row.wounds}</td>
          <td>${row.status}</td>
          <td>${row.recommendation}</td>
        </tr>
      `,
    )
    .join("");
  const comboRows = [
    ["是否可执行", combo.available ? "可执行" : "不可执行"],
    ["定位敌方长老", combo.canLocateEnemyLeader ? "已具备或可尝试定位" : "需要小丑偷看命中或通过排除法继续缩小"],
    ["主动权", combo.available ? "目标可拒绝敌方干预，敌方不能强行挡刀打断链条" : combo.blockReason],
    ["刺客技能后", combo.afterAssassinText],
    ["当前结论", combo.recommendation],
  ]
    .map(
      ([label, value]) => `
        <tr>
          <td>${label}</td>
          <td>${value}</td>
        </tr>
      `,
    )
    .join("");

  return `
    <section class="strategy-section">
      <h3>战局策略表</h3>
      <p><span class="strategy-key">核心目标：</span>找出敌方长老，计算我方还需几刀，对比敌方最快几刀能击杀我方长老。</p>
      <div class="strategy-table-wrap">
        <table class="strategy-table">
          <thead>
            <tr>
              <th>对象</th>
              <th>玩家</th>
              <th>伤害</th>
              <th>状态</th>
              <th>当前策略</th>
            </tr>
          </thead>
          <tbody>${leaderRows}</tbody>
        </table>
      </div>
      <p><span class="strategy-key">刀数竞速：</span>我方需要 <span class="strategy-danger">${race.ourRangeText}</span>；敌方需要 <span class="strategy-danger">${race.enemyRangeText}</span>。${race.verdict}</p>
      <div class="strategy-table-wrap">
        <table class="strategy-table">
          <thead>
            <tr>
              <th>刺客 + 小丑组合技</th>
              <th>判断</th>
            </tr>
          </thead>
          <tbody>${comboRows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function buildBattleStrategyModel(observer) {
  const enemyLeader = findKnownEnemyLeader(observer);
  const allyLeader = findAllyLeaderForStrategy(observer);
  const race = buildTempoRaceModel(observer);
  const combo = buildAssassinJesterComboModel(observer, enemyLeader);
  return {
    race,
    combo,
    leaderRows: [
      buildLeaderStrategyRow(observer, enemyLeader, "敌方长老", true),
      buildLeaderStrategyRow(observer, allyLeader, "己方长老", false),
    ],
  };
}

function buildLeaderStrategyRow(observer, leader, side, enemySide) {
  if (!leader) {
    return {
      side,
      player: null,
      wounds: "未知",
      status: enemySide ? "尚未确认敌方长老" : "尚未确认己方当前长老",
      recommendation: enemySide ? "优先用小丑/行为信号找人" : "先保护已知高价值队友，避免过度暴露",
    };
  }

  const wounds = `${leader.wounds}/4`;
  if (enemySide) {
    const recommendation =
      leader.wounds >= 3
        ? "普通攻击即可捕获，但要核算挡刀次数"
        : leader.wounds === 2
        ? "刺客技能可直接击杀，进入必胜优先级"
        : leader.wounds === 1
        ? "刺客技能可封印长老技能并推到3伤，随后核算剩余刀数"
        : "先压血或继续找刺客技能窗口";
    return { side, player: leader, wounds, status: hasRevealed(leader, "rank") ? "Rank已公开" : "身份已确认但Rank未必公开", recommendation };
  }

  const recommendation =
    leader.wounds >= 3
      ? "极危，避免任何伤害"
      : leader.wounds === 2
      ? "当前普通挡刀可触发技能但等待机会前怕被刺客击杀"
      : leader.wounds === 1
      ? "考虑通过普通伤害触发技能，避免被刺客封印"
      : "隐藏优先，满血不轻易挡刀";
  return { side, player: leader, wounds, status: elderAbilityAvailable(leader) ? "长老技能仍可发动" : "长老技能不可用或已转移", recommendation };
}

function buildTempoRaceModel(observer) {
  const enemyLeader = findKnownEnemyLeader(observer);
  const allyLeader = findAllyLeaderForStrategy(observer);
  const our = estimateCaptureKnives(observer.clan, enemyLeader);
  const enemy = estimateCaptureKnives(oppositeClan(observer.clan), allyLeader);
  const canCompare = Boolean(enemyLeader && allyLeader);
  const ourWorst = our.max;
  const enemyBest = enemy.min;
  const verdict = canCompare
    ? ourWorst < enemyBest
      ? `我方最坏刀数仍小于敌方最快刀数，满足必胜法则。`
      : rangesOverlap(our, enemy)
      ? `双方区间有重叠，只能算高优势或均势，不能显示必胜法则。`
      : `当前不满足严格必胜，只能作为战局优势参考。`
    : `双方长老信息不足，暂时不能判定必胜。`;

  return {
    canCompare,
    our,
    enemy,
    ourWorst,
    enemyBest,
    ourRangeText: rangeText(our),
    enemyRangeText: rangeText(enemy),
    verdict,
    ourFacts: enemyLeader ? `敌方长老 ${enemyLeader.name} 当前 ${enemyLeader.wounds}/4 伤。` : "敌方长老尚未确认。",
    enemyFacts: allyLeader ? `己方长老 ${allyLeader.name} 当前 ${allyLeader.wounds}/4 伤。` : "己方长老尚未确认。",
    steps: buildTempoRaceSteps(observer, enemyLeader, our),
  };
}

function buildTempoRaceSteps(observer, enemyLeader, ourEstimate) {
  if (!enemyLeader) return ["继续通过小丑偷看、公开标记和行为信号定位敌方长老。"];
  const steps = [`集中火力攻击 ${enemyLeader.name}，按最坏情况预计还需 ${ourEstimate.max} 刀。`];
  if (enemyLeader.wounds === 1) steps.push("若己方刺客技能可用，优先封印长老能力并把目标推到3伤。");
  if (enemyLeader.wounds >= 2) steps.push("若己方刺客技能可用，直接用技能完成捕获。");
  steps.push("若敌方用可用挡刀保护，则继续计算剩余挡刀次数，直到目标必须承伤。");
  return steps;
}

function estimateCaptureKnives(attackingClan, leader) {
  if (!leader) return { min: Infinity, max: Infinity, blocks: 0, leaderRemaining: Infinity };
  const leaderRemaining = Math.max(1, 4 - leader.wounds);
  const blocks = countEffectiveBlockers(leader.clan, leader.id);
  const assassin = activePlayers().find((player) => player.clan === attackingClan && player.rank === 2 && !hasRevealed(player, "rank"));
  const normalMin = leaderRemaining;
  const normalMax = leaderRemaining + blocks;
  let min = normalMin;
  let max = normalMax;
  let skillMin = null;
  let skillMax = null;

  if (assassin) {
    const projectedWounds = Math.min(4, leader.wounds + 2);
    const skillRemaining = Math.max(0, 4 - projectedWounds);
    skillMin = projectedWounds >= 4 ? 1 : 1 + skillRemaining;
    skillMax = projectedWounds >= 4 ? 1 : 1 + skillRemaining + blocks;
    min = Math.min(min, skillMin);
    max = Math.min(max, skillMax);
  }

  if (elderAbilityAvailable(leader)) {
    max += 1;
    if (skillMax !== null && leader.wounds === 0) skillMax += 1;
  }

  return { min, max, blocks, leaderRemaining, normalMin, normalMax, skillMin, skillMax };
}

function countEffectiveBlockers(defendingClan, leaderId) {
  return activePlayers().filter(
    (player) =>
      player.clan === defendingClan &&
      player.id !== leaderId &&
      !hasRevealed(player, "rank") &&
      player.wounds < 3,
  ).length;
}

function buildAssassinJesterComboModel(observer, enemyLeader) {
  const allyAssassin = activePlayers().find((player) => player.clan === observer.clan && player.rank === 2);
  const allyJester = activePlayers().find((player) => player.clan === observer.clan && player.rank === 3);
  const available = Boolean(
    allyAssassin &&
      allyJester &&
      !hasRevealed(allyAssassin, "rank") &&
      !hasRevealed(allyJester, "rank") &&
      allyAssassin.wounds < 3 &&
      allyJester.wounds < 3,
  );
  const blockReason = !allyAssassin
    ? "己方刺客未确认"
    : !allyJester
    ? "己方小丑未确认"
    : hasRevealed(allyAssassin, "rank") || hasRevealed(allyJester, "rank")
    ? "小丑或刺客已公开Rank，不能再次通过亮Rank触发技能"
    : allyAssassin.wounds >= 3 || allyJester.wounds >= 3
    ? "组合成员已3伤，再承伤会被捕获"
    : "条件不足";
  const locatedByIntel = Boolean(enemyLeader && (isKnownEnemyLeader(observer, enemyLeader) || hasPrivateIntel(observer, enemyLeader)));
  const afterAssassinText = enemyLeader
    ? enemyLeader.wounds >= 2
      ? "刺客技能可直接捕获敌方长老。"
      : enemyLeader.wounds === 1
      ? "刺客技能可封印敌方长老并推到3伤，后续核算挡刀和刀数。"
      : "刺客技能只能压到2伤，通常还不是终结路线。"
    : "敌方长老尚未定位，先看小丑偷看结果或排除法。";
  const recommendation = available
    ? locatedByIntel
      ? "可执行组合技，并把刺客技能用于已定位长老；目标可拒绝敌方干预，因此敌方不能强行打断。"
      : "可执行组合技来快速找长老；目标可拒绝敌方干预，因此敌方不能强行打断，但还不是必胜法则。"
    : `不可执行：${blockReason}。`;
  return { available, canLocateEnemyLeader: locatedByIntel, blockReason, afterAssassinText, recommendation };
}

function findKnownEnemyLeader(observer) {
  return activePlayers().find((player) => player.clan !== observer.clan && isKnownEnemyLeader(observer, player)) || null;
}

function findAllyLeaderForStrategy(observer) {
  const knownAllyLeader = activePlayers().find((player) => player.clan === observer.clan && isLeader(player) && isKnownAlly(observer, player));
  if (knownAllyLeader) return knownAllyLeader;
  return isLeader(observer) ? observer : null;
}

function elderAbilityAvailable(leader) {
  if (!leader || leader.rank !== 1) return false;
  return state.leaderRule[leader.clan] === "lowest" && !hasRevealed(leader, "rank");
}

function rangesOverlap(left, right) {
  return left.min <= right.max && right.min <= left.max;
}

function rangeText(range) {
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) return "未知";
  const best = range.min === range.max ? `${range.min}刀` : `${range.min}-${range.max}刀`;
  const normal = range.normalMin
    ? range.normalMin === range.normalMax
      ? `普通${range.normalMin}刀`
      : `普通${range.normalMin}-${range.normalMax}刀`
    : "";
  const skill = range.skillMin
    ? range.skillMin === range.skillMax
      ? `技能${range.skillMin}刀`
      : `技能${range.skillMin}-${range.skillMax}刀`
    : "";
  const detail = [skill, normal].filter(Boolean).join(" / ");
  return detail ? `${best}（${detail}）` : best;
}

function oppositeClan(clan) {
  return clan === "Rose" ? "Beast" : "Rose";
}

function hasLegalIntervenerForAttack(attacker, target) {
  return activePlayers().some(
    (player) =>
      player.id !== attacker.id &&
      player.id !== target.id &&
      !hasRevealed(player, "rank"),
  );
}


function buildActionScore(player, clueTarget, unknownPlayers, worlds, targetPlayer) {
  let score;
  const knownTargetRole = knownRoleTo(player, targetPlayer);
  if (knownTargetRole) {
    score = scoreFromRoles(player, targetPlayer, [knownTargetRole], 1, clockwiseDistance(clueTarget.id, targetPlayer.id));
  } else if (targetPlayer.id === clueTarget.id) {
    const roles = worlds.map((world) => world.targetRole);
    score = scoreFromRoles(player, targetPlayer, roles, roles.length || 1, clockwiseDistance(clueTarget.id, targetPlayer.id));
  } else {
    const roles = worlds.flatMap((world) => world.remainingUnknownRoles);
    const denominator = worlds.length * Math.max(unknownPlayers.length, 1);
    score = scoreFromRoles(player, targetPlayer, roles, denominator, clockwiseDistance(clueTarget.id, targetPlayer.id));
  }

  const behavior = behaviorModifierFor(player, targetPlayer);
  const contradiction = identityContradictionForAttack(player, targetPlayer, score);
  const captureOutcome = captureOutcomeFor(player, targetPlayer, 1);
  score.behaviorReasons = behavior.reasons;
  score.identityContradiction = contradiction;
  score.captureOutcome = captureOutcome;
  score.adjustedEnemyProbability = clamp01(probability(score.enemyNumerator, score.denominator) + behavior.enemyDelta - contradiction.penalty);
  score.adjustedAllyProbability = clamp01(probability(score.allyNumerator, score.denominator) + behavior.allyDelta);
  score.adjustedEnemyLeaderProbability = clamp01(probability(score.enemyLeaderNumerator, score.denominator) + behavior.enemyDelta * 0.4 - contradiction.penalty * 0.35);
  score.adjustedAllyLeaderProbability = clamp01(probability(score.allyLeaderNumerator, score.denominator) + behavior.allyDelta * 0.25);
  applyCaptureOutcomeToActionScore(score);
  applySpentAbilityTargetPenalty(player, targetPlayer, score);
  return score;
}

function applySpentAbilityTargetPenalty(observer, target, score) {
  if (score.captureOutcome.type === "win") return;

  const known = knownRoleTo(observer, target);
  const rankVisible = hasRevealed(target, "rank");
  const role = known?.role || (rankVisible ? target.role : null);
  if (!rankVisible || !role) return;

  if (role === "长老" && !isLeader(target)) {
    score.adjustedEnemyLeaderProbability = Math.min(score.adjustedEnemyLeaderProbability, 0.02);
    score.adjustedEnemyProbability = Math.min(score.adjustedEnemyProbability, 0.12);
    score.adjustedAllyLeaderProbability = Math.max(score.adjustedAllyLeaderProbability, 0.72);
    score.adjustedAllyProbability = Math.max(score.adjustedAllyProbability, 0.72);
    score.spentAbilityPenalty = "目标长老能力已发动，且已不再是当前领袖，继续攻击价值很低。";
  }

  if ((role === "刺客" || role === "小丑") && rankVisible) {
    score.adjustedEnemyLeaderProbability = Math.min(score.adjustedEnemyLeaderProbability, 0.02);
    score.spentAbilityPenalty = `${role} 的 Rank 已公开，核心技能价值已结算；除非确认捕获领袖，否则不应继续集火。`;
  }
}

function captureOutcomeFor(observer, target, damageAmount = 1) {
  if (target.wounds + damageAmount < 4) {
    return {
      type: "safe",
      label: "不会捕获",
      reason: "本次伤害不会造成第4点伤害。",
    };
  }

  const known = knownRoleTo(observer, target);
  if (known) {
    if (known.clan !== observer.clan && isLeader(target)) {
      return {
        type: "win",
        label: "确认胜利",
        reason: `${target.name} 已确认是敌方当前领袖，本次捕获会获胜。`,
      };
    }
    return {
      type: "lose",
      label: "抓错会输",
      reason: `${target.name} 已确认不是敌方当前领袖，本次捕获会让对方获胜。`,
    };
  }

  if (isKnownEnemyLeader(observer, target)) {
    return {
      type: "win",
      label: "确认胜利",
      reason: `${target.name} 已通过公开信息确认为敌方当前领袖。`,
    };
  }

  const visibleClan = visibleClanTo(observer, target);
  const visibleRank = knownRankTo(observer, target);
  if (visibleClan === observer.clan) {
    return {
      type: "lose",
      label: "抓错会输",
      reason: `${target.name} 的公开阵营倾向是己方，本次捕获会抓错。`,
    };
  }
  if (!visibleClan && visibleRank !== null) {
    const enemyClan = observer.clan === "Rose" ? "Beast" : "Rose";
    const enemyLeaderRank = state.leaderRule[enemyClan] === "highest" ? 3 : 1;
    if (visibleRank !== enemyLeaderRank) {
      return {
        type: "lose",
        label: "抓错会输",
        reason: `${target.name} 已公开 Rank ${visibleRank}，不是敌方当前领袖 Rank，本次捕获会抓错。`,
      };
    }
  }
  if (visibleClan && visibleRank !== null) {
    const leaderRank = state.leaderRule[visibleClan] === "highest" ? 3 : 1;
    if (visibleClan !== observer.clan && visibleRank !== leaderRank) {
      return {
        type: "lose",
        label: "抓错会输",
        reason: `${target.name} 的公开 Rank 不是敌方当前领袖 Rank，本次捕获会抓错。`,
      };
    }
  }

  return {
    type: "unknown",
    label: "身份不明，不应直接捕获",
    reason: `${target.name} 会被本次伤害捕获，但当前不能确认他是敌方领袖。`,
  };
}

function applyCaptureOutcomeToActionScore(score) {
  if (score.captureOutcome.type === "win") {
    score.adjustedEnemyLeaderProbability = 1;
    score.adjustedEnemyProbability = 1;
    score.adjustedAllyLeaderProbability = 0;
    score.adjustedAllyProbability = 0;
    score.capturePriority = 1;
    return;
  }

  if (score.captureOutcome.type === "lose") {
    score.adjustedEnemyLeaderProbability = -2;
    score.adjustedEnemyProbability = -2;
    score.adjustedAllyLeaderProbability = 2;
    score.adjustedAllyProbability = 2;
    score.capturePriority = -2;
    return;
  }

  if (score.captureOutcome.type === "unknown") {
    score.adjustedEnemyLeaderProbability = Math.min(score.adjustedEnemyLeaderProbability, 0.05);
    score.adjustedEnemyProbability = Math.min(score.adjustedEnemyProbability, 0.1);
    score.adjustedAllyLeaderProbability = Math.max(score.adjustedAllyLeaderProbability, 0.9);
    score.adjustedAllyProbability = Math.max(score.adjustedAllyProbability, 0.9);
    score.capturePriority = -1;
    return;
  }

  score.capturePriority = 0;
}

function scoreFromRoles(player, targetPlayer, roles, forcedDenominator = roles.length || 1, order = targetPlayer.id) {
  return {
    player: targetPlayer,
    denominator: forcedDenominator,
    order,
    enemyLeaderNumerator: roles.filter((role) => isEnemyLeaderRole(player, role)).length,
    enemyNumerator: roles.filter((role) => role.clan !== player.clan).length,
    allyLeaderNumerator: roles.filter((role) => isAllyLeaderRole(player, role)).length,
    allyNumerator: roles.filter((role) => role.clan === player.clan).length,
  };
}

function buildPrivateIntelHtml(model) {
  if (!model.privateIntelTargets.length) return "";

  const rows = model.privateIntelTargets
    .map(
      (target) => `
        <tr>
          <td>${target.name}</td>
          <td>${cardRoleLabel(target)}</td>
          <td>${target.clan === model.player.clan ? "己方" : "敌人"}</td>
          <td>${target.rank === 1 ? "长老关键位" : target.rank === 2 ? "刺客威胁位" : "小丑信息位"}</td>
        </tr>
      `,
    )
    .join("");

  return `
    <section class="strategy-section">
      <h3>小丑偷看结果 / 已知事实</h3>
      <p>这些身份是 ${model.player.name} 通过小丑能力获得的私密信息，只进入他的视角和策略推演，不会自动公开给其他玩家。</p>
      <div class="strategy-table-wrap">
        <table class="strategy-table">
          <thead>
            <tr>
              <th>玩家</th>
              <th>完整身份</th>
              <th>阵营关系</th>
              <th>战略价值</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function buildHarlequinIntelDispositionHtml(model) {
  const decision = model.harlequinIntelDecision;
  if (!decision) return "";

  const routeRows = [
    ["公开两张牌", decision.revealAll],
    ["只公开关键牌", decision.revealKey],
    ["公开敌方，隐藏队友", decision.revealEnemyHideAlly || decision.revealKey],
    ["暂时隐藏", decision.hide],
    ["撒谎/烟雾弹", decision.lie],
  ]
    .map(
      ([route, detail]) => `
        <tr class="${decision.routeLabel === route ? "strategy-row-highlight" : ""}">
          <td>${route}</td>
          <td>${detail.gain}</td>
          <td>${detail.risk}</td>
        </tr>
      `,
    )
    .join("");

  return `
    <section class="strategy-section">
      <h3>小丑信息处置</h3>
      <p><span class="strategy-key">公开原则：</span>敌方信息默认公开，队友信息默认隐藏。敌方长老最高优先，敌方刺客次优先，敌方小丑公开后主要用于防误导和防挡刀陷阱。</p>
      <p><span class="strategy-key">当前推荐：</span><span class="strategy-danger">${decision.routeLabel}</span>。${decision.reason}</p>
      <p><span class="strategy-key">推荐话术：</span>${escapeHtml(decision.chat)}</p>
      <div class="strategy-table-wrap">
        <table class="strategy-table">
          <thead>
            <tr>
              <th>路线</th>
              <th>收益</th>
              <th>风险</th>
            </tr>
          </thead>
          <tbody>${routeRows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function buildHarlequinIntelDecision(player) {
  if (player.rank !== 3) return null;

  const intelTargets = privateIntelFor(player).map((entry) => getPlayer(entry.targetId)).filter(Boolean);
  if (intelTargets.length < 2) return null;

  const enemies = intelTargets.filter((target) => target.clan !== player.clan);
  const allies = intelTargets.filter((target) => target.clan === player.clan);
  const enemyLeader = enemies.find((target) => target.rank === 1);
  const enemyAssassin = enemies.find((target) => target.rank === 2);
  const allyLeader = allies.find((target) => target.rank === 1);
  const allyAssassin = allies.find((target) => target.rank === 2);
  const keyEnemy = enemyLeader || enemyAssassin || enemies[0] || null;
  const keyAlly = allyLeader || allyAssassin || allies[0] || null;

  const revealAll = {
    gain: enemies.length === 2 ? "两张都是敌方信息，公开后可以立刻统一攻击目标。" : "信息最透明，队友不用再猜。",
    risk: allies.length ? "会把己方关键牌一起暴露，尤其是长老或刺客。" : "会暴露小丑已经掌握的全部筹码，后续误导空间下降。",
  };
  const revealKey = {
    gain: keyEnemy ? `公开 ${keyEnemy.name} 这张敌方牌，队友能立刻避开误导并调整火力。` : "没有明确敌方牌时，公开价值有限。",
    risk: keyAlly ? `如果同时看到了 ${keyAlly.name} 这类队友牌，必须隐藏队友完整身份。` : "如果只说结论不交代全部细节，其他玩家可能要求继续验真。",
  };
  const hide = {
    gain: keyAlly ? `可以保护 ${keyAlly.name} 这类己方关键位，不把队友送到敌方视野里。` : "保留信息差，避免敌方根据公开情报调整防守。",
    risk: "如果完全不说话，会显得没有收益，队友也无法配合。",
  };
  const lie = {
    gain: "可以制造烟雾，引诱敌方保错人、挡错刀，或暴露他们的站队。",
    risk: "一旦被左手见证、公开标记或后续身份打穿，小丑信誉会快速下降。",
  };

  if (enemyLeader) {
    return {
      route: "reveal_key",
      routeLabel: "只公开关键牌",
      reason: `${enemyLeader.name} 是敌方长老，公开这张牌的收益高于继续隐藏；另一张牌如果涉及队友，可以先不全摊。`,
      chat: pickLine(
        [
          `我看到了关键位。${enemyLeader.name} 是我们要处理的核心，先别乱挡，队友听我排一下刀。`,
          `我确认一张大牌：${enemyLeader.name} 是对面核心。另一张我先不急着全说。`,
          `${enemyLeader.name} 这张牌很关键，我建议先围着他打，不要把刀乱交出去。`,
          `我不全摊两张，但结论先给：${enemyLeader.name} 是优先目标。`,
        ],
        player.id,
        enemyLeader.id,
        state.logIndex,
      ),
      revealAll,
      revealKey,
      revealEnemyHideAlly: {
        gain: `公开敌方牌：${enemyText}，队友能立刻避开误导并调整攻击目标。`,
        risk: keyAlly ? `隐藏 ${keyAlly.name} 的完整身份，避免己方关键位被敌方锁定。` : "需要承受其他玩家追问另一张牌的压力。",
      },
      hide,
      lie,
    };
  }

  if (enemies.length && allies.length) {
    const enemyText = enemies.map((target) => `${target.name} 是对面${target.role}`).join("，");
    const protectedAllyText = keyAlly ? `；另一张涉及队友，我不卖。` : "";
    return {
      route: "reveal_key",
      routeLabel: "公开敌方，隐藏队友",
      reason: `偷看结果里同时有敌方牌和队友牌。当前默认公开敌方信息：${enemyText}，但隐藏队友完整身份。`,
      chat: pickLine(
        [
          `${enemyText}，这张我确认了。${protectedAllyText}队友别被他带节奏。`,
          `我先公开敌方信息：${enemyText}。${protectedAllyText}我们按这条线调整目标。`,
          `我看到了敌方牌：${enemyText}。${protectedAllyText}先别问另一张，别把队友卖出去。`,
          `${enemyText}，先把这张敌方信息摊出来。${protectedAllyText}`,
        ],
        player.id,
        enemies[0].id,
        keyAlly?.id || 0,
        state.logIndex,
      ),
      revealAll,
      revealKey,
      hide,
      lie,
    };
  }

  if (enemies.length === 2) {
    const names = enemies.map((target) => `${target.name} 是 ${fullRoleLabel(target)}`).join("，");
    return {
      route: "reveal_all",
      routeLabel: "公开两张牌",
      reason: "偷看的两张都是敌方牌，公开不会暴露己方关键身份，收益高于继续藏信息。",
      chat: pickLine(
        [
          `我直接摊牌：${names}。现在按这个信息打。`,
          `这两张我可以公开，都是对面的人：${names}。别再乱猜了。`,
          `我看完了，信息能摊：${names}。接下来集中处理他们。`,
        ],
        player.id,
        enemies[0].id,
        enemies[1].id,
        state.logIndex,
      ),
      revealAll,
      revealKey,
      hide,
      lie,
    };
  }

  if (allyLeader || allyAssassin) {
    const pressureTarget = keyEnemy || modelSafeBestTarget(player);
    return {
      route: "hide",
      routeLabel: "暂时隐藏",
      reason: `偷看结果里有己方关键位 ${keyAlly.name}，完整公开会把队友暴露给敌方；更好的做法是只给行动结论。`,
      chat: pickLine(
        [
          `我看完了，但现在全说出来会把队友也暴露。我先给结论：这刀别乱接，先压 ${pressureTarget.name}。`,
          `两张牌我先不全摊，里面有不能随便卖的信息。现在先看 ${pressureTarget.name} 的反应。`,
          `我有信息，但不适合一次说干净。队友先别急着亮，先把压力给到 ${pressureTarget.name}。`,
        ],
        player.id,
        keyAlly.id,
        pressureTarget.id,
        state.logIndex,
      ),
      revealAll,
      revealKey,
      hide,
      lie,
    };
  }

  if (keyEnemy) {
    return {
      route: "lie",
      routeLabel: "撒谎/烟雾弹",
      reason: `${keyEnemy.name} 是敌方牌但不是长老，直接摊牌未必立刻获胜；可以用模糊说法压他，观察谁急着保护。`,
      chat: pickLine(
        [
          `我看到的信息不适合全摊，${keyEnemy.name} 现在比表面上更可疑。你们先看场上谁急着保他。`,
          `我先不报完整身份，${keyEnemy.name} 这边有问题，谁想替他说话可以先站出来。`,
          `${keyEnemy.name} 不是一张可以放着不管的牌。我先压他，看反应。`,
        ],
        player.id,
        keyEnemy.id,
        state.logIndex,
      ),
      revealAll,
      revealKey,
      hide,
      lie,
    };
  }

  const fallbackTarget = modelSafeBestTarget(player);
  return {
    route: "hide",
    routeLabel: "暂时隐藏",
    reason: "偷看结果没有直接形成击杀或封印路线，继续保留信息差更有价值，但必须给队友一个行动方向。",
    chat: `我看完了，但这两张现在不适合全说。先别乱挡，先把压力放到 ${fallbackTarget.name}。`,
    revealAll,
    revealKey,
    hide,
    lie,
  };
}

function modelSafeBestTarget(player) {
  return activePlayers().find((target) => target.id !== player.id && target.clan !== player.clan) ||
    activePlayers().find((target) => target.id !== player.id) ||
    player;
}

function buildHarlequinIntelChat(player) {
  const decision = buildHarlequinIntelDecision(player);
  return decision?.chat || "我看完了，但这两张现在不适合全说。先别乱挡，等我把信息整理一下。";
}

function publishCriticalPrivateIntelIfNeeded(player) {
  const enemyTargets = privateIntelFor(player)
    .map((entry) => getPlayer(entry.targetId))
    .filter((target) => target && target.clan !== player.clan);
  if (!enemyTargets.length) return false;

  let published = false;
  enemyTargets.forEach((target) => {
    const key = `${player.id}:${target.id}:enemy-${target.rank}`;
    state.disclosedIntelKeys ||= [];
    if (state.disclosedIntelKeys.includes(key)) return;

    state.disclosedIntelKeys.push(key);
    addLog(`${player.name} 公开敌方情报：${target.name} 是 ${fullRoleLabel(target)}，队友信息继续隐藏。`);
    addChatMessage(
      player.id,
      buildEnemyIntelChat(player, target),
      true,
      ["reveal_intel", "claim_identity", "accuse"],
    );
    published = true;
  });
  return published;
}

function buildEnemyIntelChat(player, target) {
  if (isLeader(target)) return buildCriticalEnemyLeaderIntelChat(player, target);
  if (target.rank === 2) {
    return pickLine(
      [
        `${target.name} 是对面刺客，这张我确认了。另一张如果是队友，我先不卖。`,
        `我先公开敌方牌：${target.name} 是对面刺客。队友注意别让他舒服开技能。`,
        `${target.name} 这张是敌方刺客，先把这个信息摊出来，别被他带节奏。`,
        `我看到了敌方刺客：${target.name}。其他信息我先保留，别把队友暴露出去。`,
      ],
      player.id,
      target.id,
      state.logIndex,
    );
  }
  return pickLine(
    [
      `${target.name} 是对面小丑，这张牌我确认了。队友别被他带节奏。`,
      `我先公开敌方牌：${target.name} 是对面小丑。别让他靠话术骗挡刀。`,
      `${target.name} 这张是敌方小丑，先记住，后面别被他的烟雾弹牵着走。`,
      `我看到了敌方小丑：${target.name}。另一张如果是队友，我不卖。`,
    ],
    player.id,
    target.id,
    state.logIndex,
  );
}

function buildCriticalEnemyLeaderIntelChat(player, target) {
  return pickLine(
    [
      `我摊一张关键牌：${target.name} 是对面长老。队友别分散了，接下来围着 ${target.name} 打。`,
      `我看到了核心信息，${target.name} 是敌方长老。我们现在的目标很明确，先压他。`,
      `${target.name} 是对面长老，这个信息我直接公开。队友不要乱挡，刀往他身上排。`,
      `关键位找到了：${target.name} 是敌方长老。队友出来配合，别把刀浪费到别处。`,
      `我不藏这条信息：${target.name} 就是对面的长老。现在先集火他，后面按血量算刀。`,
    ],
    player.id,
    target.id,
    state.logIndex,
  );
}

function compareActionScore(left, right) {
  return (
    (right.capturePriority || 0) - (left.capturePriority || 0) ||
    right.adjustedEnemyLeaderProbability - left.adjustedEnemyLeaderProbability ||
    right.adjustedEnemyProbability - left.adjustedEnemyProbability ||
    left.adjustedAllyLeaderProbability - right.adjustedAllyLeaderProbability ||
    left.adjustedAllyProbability - right.adjustedAllyProbability ||
    left.order - right.order
  );
}

function identityContradictionForAttack(attacker, target, score) {
  if (attacker.rank !== 3) return { penalty: 0, reason: "" };

  const attackerShownClan = clueClan(attacker.clue);
  const targetShownClan = clueClan(target.clue) || visibleClanTo(attacker, target);
  const sameShownColor = attackerShownClan && targetShownClan && attackerShownClan === targetShownClan;
  if (!sameShownColor) return { penalty: 0, reason: "" };

  const enemyLeaderProb = probability(score.enemyLeaderNumerator, score.denominator);
  const enemyProb = probability(score.enemyNumerator, score.denominator);
  const isHighValueTarget = enemyLeaderProb >= 0.66 || enemyProb >= 0.9 || target.wounds >= 3;
  const penalty = isHighValueTarget ? 0.08 : 0.28;
  const reason = isHighValueTarget
    ? `${attacker.name} 攻击同色目标会暴露身份矛盾，但目标价值足够高，可以用“假同色/反色小丑”解释。`
    : `${attacker.name} 对外颜色和 ${target.name} 一致，主动攻击会让见证人质疑其身份。`;
  return { penalty, reason };
}

function buildAssassinSkillRows(assassin, actionScores) {
  if (assassin.rank !== 2) return [];

  return activePlayers()
    .filter((target) => target.id !== assassin.id)
    .map((target) => buildAssassinSkillRow(assassin, target, actionScores.find((score) => score.player.id === target.id)))
    .sort(compareAssassinSkillRows);
}

function buildAssassinSkillRow(assassin, target, score) {
  const denominator = score?.denominator || 1;
  const enemyLeaderProb = probability(score?.enemyLeaderNumerator || 0, denominator);
  const enemyProb = probability(score?.enemyNumerator || 0, denominator);
  const allyLeaderProb = probability(score?.allyLeaderNumerator || 0, denominator);
  const allyProb = probability(score?.allyNumerator || 0, denominator);
  const wounds = target.wounds;
  const projectedWounds = Math.min(4, wounds + 2);
  const captureOutcome = captureOutcomeFor(assassin, target, 2);
  const winProb = projectedWounds >= 4 ? enemyLeaderProb : 0;
  const sealProb = wounds >= 1 ? enemyLeaderProb : 0;
  const timingMultiplier = wounds >= 2 ? 1 : wounds === 1 ? 0.72 : 0.24;
  const killPressure = projectedWounds >= 4 ? enemyProb * 30 : projectedWounds === 3 ? enemyProb * 18 : enemyProb * 10;
  let skillScore =
    enemyLeaderProb * 100 * timingMultiplier +
    killPressure +
    sealProb * 28 -
    allyLeaderProb * 85 -
    allyProb * 22 +
    wounds * 3;
  if (captureOutcome.type === "win") skillScore += 500;
  if (captureOutcome.type === "lose") skillScore = -1000;
  if (captureOutcome.type === "unknown") skillScore -= 280;

  return {
    player: target,
    denominator,
    enemyLeaderProb,
    enemyProb,
    allyLeaderProb,
    allyProb,
    wounds,
    projectedWounds,
    winProb,
    sealProb,
    captureOutcome,
    resultText: assassinSkillResultText(wounds, projectedWounds),
    sealText: assassinSkillSealText(wounds, enemyLeaderProb),
    skillScore,
  };
}

function compareAssassinSkillRows(left, right) {
  return (
    captureOutcomeRank(right.captureOutcome) - captureOutcomeRank(left.captureOutcome) ||
    right.skillScore - left.skillScore ||
    right.winProb - left.winProb ||
    right.enemyLeaderProb - left.enemyLeaderProb ||
    right.enemyProb - left.enemyProb ||
    left.allyLeaderProb - right.allyLeaderProb ||
    left.player.id - right.player.id
  );
}

function captureOutcomeRank(outcome) {
  if (outcome?.type === "win") return 2;
  if (outcome?.type === "safe") return 0;
  if (outcome?.type === "unknown") return -1;
  if (outcome?.type === "lose") return -2;
  return 0;
}

function assassinSkillResultText(wounds, projectedWounds) {
  if (projectedWounds >= 4) return "技能造成第3、4点伤害，可直接捕获；若目标是敌方长老则立即胜利。";
  if (wounds === 1) return "技能会把目标推到3/4；若过程中公开 Rank，则因技能伤害不触发能力，相当于封印长老技能。";
  return "技能只造成2点伤害并逼出两个标记；目标后续普通受伤或挡刀时仍可能公开 Rank 并发动能力。";
}

function assassinSkillSealText(wounds, enemyLeaderProb) {
  if (wounds >= 2) return `捕获优先；封印价值已转化为击杀/胜利概率 ${percent(enemyLeaderProb)}。`;
  if (wounds === 1) return `高：若目标是敌方长老，Rank 被技能伤害打出时不能发动长老能力，封印概率 ${percent(enemyLeaderProb)}。`;
  return "低：0伤长老通常只会先公开两个阵营标记，尚未直接打出 Rank。";
}

function clockwiseDistance(fromPlayerId, toPlayerId) {
  if (fromPlayerId === toPlayerId) return 0;
  return toPlayerId > fromPlayerId
    ? toPlayerId - fromPlayerId
    : state.players.length - fromPlayerId + toPlayerId;
}

function probability(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function isEnemyLeaderRole(player, role) {
  return role.clan !== player.clan && role.rank === 1;
}

function isAllyLeaderRole(player, role) {
  return role.clan === player.clan && role.rank === 1;
}

function buildImpossibleNotes(player, clueTarget, clueClanValue, remainingRoles, targetCandidates, knownRolePlayers = []) {
  const notes = [];
  const excludedOwnRole = ROLE_DECK.find((role) => sameRole(role, player));
  if (excludedOwnRole) {
    notes.push(`已排除 ${roleText(excludedOwnRole)}，因为这就是我的身份。`);
  }

  knownRolePlayers.forEach((knownPlayer) => {
    notes.push(`已确认 ${knownPlayer.name} 是 ${roleText(knownPlayer)}，该身份不再进入其他未知玩家候选。`);
  });

  const knownClueTarget = knownRoleTo(player, clueTarget);
  if (knownClueTarget) {
    return notes;
  }

  remainingRoles
    .filter((role) => clueClan(role.clue) !== clueClanValue)
    .forEach((role) => {
      notes.push(`${clueTarget.name} 不可能是 ${roleText(role)}，因为该身份显示的颜色不是${colorTextFromClue(clueTarget.clue)}。`);
    });

  if (!targetCandidates.some((role) => role.rank === 3)) {
    notes.push(`${clueTarget.name} 的候选身份里没有小丑，所以这里不能再用小丑反色解释他的颜色。`);
  }
  return notes;
}

function buildReasoningParagraphs(model) {
  const { player, clueTarget, bestAction } = model;
  const roleGoal =
    player.rank === 1
      ? "我是 <span class=\"strategy-key\">Rank 1 长老</span>，默认规则下很可能是本方当前领袖。我的首要目标是提高打中<span class=\"strategy-danger\">敌方领袖</span>的概率，同时避免过早暴露自己的 Rank。"
      : player.rank === 2
      ? "我是 <span class=\"strategy-key\">Rank 2 刺客</span>，技能价值在于一次造成 2 点不可干预伤害。我的首要目标是找到<span class=\"strategy-danger\">敌方领袖</span>或高概率敌人，避免把技能浪费在队友身上。"
      : "我是 <span class=\"strategy-key\">Rank 3 小丑</span>，已知自己不是领袖。我的目标是扰乱敌人的视野，让他们分不清队友，浪费技能或帮我挡刀；同时尽快找出对方 <span class=\"strategy-danger\">Rank 1 长老</span>，并寻找合适机会发动偷看技能。";
  const certainty =
    model.targetIsCertainEnemy
      ? `<span class="strategy-danger">${clueTarget.name} 在我的候选世界里必然是敌人。</span>`
      : model.targetIsCertainAlly
      ? `<span class="strategy-key">${clueTarget.name} 在我的候选世界里必然是队友。</span>`
      : `${clueTarget.name} 仍有敌人和队友两种可能，需要和其他目标的胜率排序比较。`;
  const harlequinIntelReasoning = model.harlequinIntelDecision
    ? `<p>我已经发动过小丑技能，当前不应该沉默。信息处置推荐是 <span class="strategy-danger">${model.harlequinIntelDecision.routeLabel}</span>：${model.harlequinIntelDecision.reason}</p>`
    : "";
  return `
    <p>${roleGoal}</p>
    ${harlequinIntelReasoning}
    <p>${certainty} 当前排序最高的是 <span class="strategy-danger">${bestAction.player.name}</span>：P(敌方领袖)=<span class="strategy-danger">${formatFraction(bestAction.enemyLeaderNumerator, bestAction.denominator)}</span>，P(敌人)=<span class="strategy-danger">${formatFraction(bestAction.enemyNumerator, bestAction.denominator)}</span>。传刀不会增加信息，且可能把主动权交给敌人，因此不作为当前最优推荐。</p>
  `;
}

function buildPublicStatement(model) {
  if (model.harlequinIntelDecision) {
    return escapeHtml(model.harlequinIntelDecision.chat);
  }

  if (state.phase === "ability" && state.pendingAbility?.type === "assassin" && state.pendingAbility.playerId === model.player.id && model.bestAssassinSkill) {
    const best = model.bestAssassinSkill;
    return `我现在发动刺客技能的收益是${best.wounds >= 2 ? "直接捕获高价值目标" : best.wounds === 1 ? "封印可能的长老技能并推到3伤" : "绕过干预造成2点压力"}。当前最合理目标是 <span class="strategy-danger">${best.player.name}</span>。`;
  }

  const { clueTarget, bestAction } = model;
  const clueColor = colorTextFromClue(clueTarget.clue);
  if (model.player.rank === 3 && bestAction.identityContradiction?.penalty > 0) {
    return `我知道 ${bestAction.player.name} 表面颜色和我接近，直接打他会显得矛盾。所以我的说法不能是“按颜色打”，而是怀疑他是假同色、反色小丑，或者他的行为和颜色不一致。当前仍选择打他，是因为他的目标价值高于这次身份矛盾成本。`;
  }
  if (model.targetIsCertainEnemy && bestAction.player.id === clueTarget.id) {
    return `我看到 <span class="strategy-danger">${clueTarget.name}</span> 的颜色明显偏敌方。先打一刀开信息，看谁出来保他。`;
  }
  if (model.targetIsCertainAlly) {
    return `我看到 ${clueTarget.name} 的颜色更像队友，这一刀不该打他。我会先打概率更高的 <span class="strategy-danger">${bestAction.player.name}</span>。`;
  }
  if (model.targetHasJesterCandidate) {
    return `我看到 ${clueTarget.name} 是${clueColor}，但候选里确实还有小丑，所以颜色不是铁身份。当前按概率排序，先打 <span class="strategy-danger">${bestAction.player.name}</span>。`;
  }
  if (bestAction.spentAbilityPenalty) {
    return `${bestAction.spentAbilityPenalty} 当前改为寻找更高价值目标：<span class="strategy-danger">${bestAction.player.name}</span>。`;
  }
  return `我看到 ${clueTarget.name} 是${clueColor}，候选里没有小丑反色空间。当前按概率排序，先打 <span class="strategy-danger">${bestAction.player.name}</span>。`;
}

function buildAssassinTimingHtml(model) {
  if (model.player.rank !== 2) return "";

  const rows = model.assassinSkillRows
    .map(
      (row) => `
        <tr>
          <td>${row.player.name}</td>
          <td><span class="strategy-danger">${percent(row.enemyLeaderProb)}</span></td>
          <td>${percent(row.enemyProb)}</td>
          <td>${row.wounds}/4</td>
          <td><span class="${row.captureOutcome.type === "lose" || row.captureOutcome.type === "unknown" ? "strategy-danger" : "strategy-key"}">${row.captureOutcome.label}</span></td>
          <td>${row.resultText}</td>
          <td>${row.sealText}</td>
          <td><span class="strategy-danger">${percent(row.winProb)}</span></td>
          <td><span class="strategy-danger">${row.skillScore.toFixed(1)}</span></td>
        </tr>
      `,
    )
    .join("");
  const best = model.bestAssassinSkill;

  return `
    <section class="strategy-section">
      <h3>刺客技能时机</h3>
      <p>刺客技能是一次性 <span class="strategy-key">2点不可干预技能伤害</span>。如果这次技能伤害打出 Rank，目标不能发动该 Rank 能力，所以对疑似敌方长老的价值随当前伤害明显变化。</p>
      ${
        best
          ? `<p><span class="strategy-key">当前技能推荐：</span><span class="strategy-danger">${best.player.name}</span>。${best.resultText}；P(敌方长老)=<span class="strategy-danger">${percent(best.enemyLeaderProb)}</span>。</p>`
          : `<p class="strategy-muted">当前没有可选技能目标。</p>`
      }
      <div class="strategy-table-wrap">
        <table class="strategy-table">
          <thead>
            <tr>
              <th>目标</th>
              <th>P(敌方长老)</th>
              <th>P(敌人)</th>
              <th>当前伤害</th>
              <th>捕获结果</th>
              <th>技能后结果</th>
              <th>封印价值</th>
              <th>击杀/胜利概率</th>
              <th>综合收益</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function buildWitnessStrategyHtml(model) {
  const player = model.player;
  const rightNeighbor = clueTargetFor(player);
  const leftWitness = previousSeatFor(player);
  const ownColor = playerColorText(player);
  const seenColor = playerColorText(rightNeighbor);
  const roleAdvice =
    player.rank === 3
      ? `我是 <span class="strategy-key">小丑</span>，我的颜色是反色。${leftWitness.name} 看到的是一个真实观察结果，但这个结果会误导别人判断我的阵营。可以利用他作证来制造烟雾，争取挡刀、降低敌方对我的集火，或诱导敌方浪费技能。`
      : `我是 ${player.rank === 1 ? "长老" : "刺客"}，我的颜色通常代表真实阵营。需要建立可信度时，可以让 ${leftWitness.name} 证明他看到的颜色；如果他公开支持我，这比普通口头发言更有价值。`;

  return `
    <section class="strategy-section">
      <h3>颜色见证与话术</h3>
      <p>我看到 <span class="strategy-danger">${rightNeighbor.name}</span> 的颜色是 <span class="strategy-key">${seenColor}</span>；<span class="strategy-danger">${leftWitness.name}</span> 看过我的颜色，我对外呈现的颜色是 <span class="strategy-key">${ownColor}</span>。</p>
      <p>${roleAdvice}</p>
      <p class="strategy-muted">行为推断只作为软信息：${leftWitness.name} 如果公开支持我，我的可信度上升；如果他反驳我，说明我的话术和他看到的颜色冲突，信誉下降。该信息不会改写真身份，只影响当前阶段的社交判断。</p>
    </section>
  `;
}

function buildJesterBreakoutHtml(model) {
  const player = model.player;
  if (player.rank !== 3) return "";

  const exposed = hasRevealed(player, "rank") || player.wounds >= 2 || model.signals.some((signal) => signal.targetId === player.id);
  const intelTargets = privateIntelFor(player).map((entry) => getPlayer(entry.targetId)).filter(Boolean);
  const intelText = intelTargets.length
    ? `我已经偷看过 ${intelTargets.map((target) => target.name).join("、")}，可以把这些私密信息转化成团队指挥。`
    : "我还没有偷看结果，当前最重要的是找到一次可控机会触发小丑技能。";
  const breakoutAdvice = exposed
    ? "如果我已经骗不到对方技能，或者没人愿意接受我挡刀，就不要继续把资源浪费在伪装上。可以公开自己是小丑，请队友攻击我，让我通过普通伤害公开 Rank 并发动技能，尽快找出敌方长老。"
    : "如果伪装仍然有效，先保留反色带来的误导价值；但只要挡刀触发技能的收益高于继续隐藏，就要主动用话术争取承伤。";

  return `
    <section class="strategy-section">
      <h3>小丑暴露后的破局路线</h3>
      <p>${intelText}</p>
      <p>${breakoutAdvice}</p>
      <p class="strategy-muted">这不是必胜法则：只要路线依赖队友配合、对方误判、或还没确认敌方长老，就只能作为最优策略，不显示必胜按钮。</p>
    </section>
  `;
}

function buildElderInterventionRiskHtml(model) {
  const player = model.player;
  if (player.rank !== 1) return "";

  const woundText =
    player.wounds >= 2
      ? "我已经2伤，若再被刺客技能命中会直接进入被捕获风险，主动挡刀基本不可取。"
      : player.wounds === 1
      ? "我已经1伤，刺客技能会把我推到3伤，并且技能伤害打出的Rank不会触发长老能力。"
      : "我现在满血，主动挡刀的唯一合理性是避免“所有人都挡，只有我不挡”带来的反向长老嫌疑。";

  return `
    <section class="strategy-section">
      <h3>挡刀暴露 Rank 风险</h3>
      <p>当前版型里，挡刀成功必须公开 <span class="strategy-danger">Rank 1</span>，这等于暴露长老身份。公开后，对面刺客会把我视为核心目标。</p>
      <p>${woundText}</p>
      <p class="strategy-muted">因此长老挡刀不是普通保护行为，只有在不挡会造成更大确定损失，或需要用高风险动作伪装身份时，才考虑执行。</p>
    </section>
  `;
}

function buildJesterContradictionHtml(model) {
  const player = model.player;
  if (player.rank !== 3) return "";

  const contradictionRows = model.actionScores
    .filter((score) => score.identityContradiction?.penalty > 0)
    .map(
      (score) => `
        <tr>
          <td>${score.player.name}</td>
          <td>${playerColorText(player)}</td>
          <td>${playerColorText(score.player)}</td>
          <td><span class="strategy-danger">${score.identityContradiction.penalty.toFixed(2)}</span></td>
          <td>${score.identityContradiction.reason}</td>
        </tr>
      `,
    )
    .join("");

  return `
    <section class="strategy-section">
      <h3>身份矛盾成本</h3>
      <p>我是小丑，对外颜色是反色。攻击与我对外颜色一致的目标，会让见证人质疑：如果我们看起来同色，我为什么要打他？</p>
      ${
        contradictionRows
          ? `<div class="strategy-table-wrap">
              <table class="strategy-table">
                <thead>
                  <tr>
                    <th>目标</th>
                    <th>我的对外颜色</th>
                    <th>目标颜色</th>
                    <th>矛盾成本</th>
                    <th>解释要求</th>
                  </tr>
                </thead>
                <tbody>${contradictionRows}</tbody>
              </table>
            </div>`
          : `<p class="strategy-muted">当前推荐攻击目标没有明显同色矛盾。</p>`
      }
    </section>
  `;
}

function buildCurrentStageHtml(model) {
  const { player } = model;
  const signalItems = model.signals.map((signal) => `<li>${signalText(signal)}</li>`).join("");
  const signalBlock = signalItems
    ? `<p><span class="strategy-key">公开行为修正：</span></p><ul class="strategy-list">${signalItems}</ul>`
    : `<p class="strategy-muted">暂无公开行为修正，当前只按基础概率判断。</p>`;

  if (state.phase === "ability" && state.pendingAbility?.type === "assassin" && state.pendingAbility.playerId === player.id) {
    const best = model.bestAssassinSkill;
    return `
      <section class="strategy-section strategy-stage-section">
        <h3>当前阶段判断</h3>
        <p>我正在结算 <span class="strategy-key">刺客技能</span>。此时不能按普通攻击排序判断，因为技能伤害不可干预，且技能伤害打出的 Rank 不触发角色能力。</p>
        ${
          best
            ? `<p><span class="strategy-key">当前技能目标：</span><span class="strategy-danger">${best.player.name}</span>。理由：P(敌方长老)=${percent(best.enemyLeaderProb)}，当前伤害 ${best.wounds}/4，${best.resultText}</p>`
            : `<p class="strategy-muted">当前没有可选技能目标。</p>`
        }
        ${signalBlock}
      </section>
    `;
  }

  if (state.phase === "intervention" && state.pendingAttack) {
    const attacker = getPlayer(state.pendingAttack.attackerId);
    const target = getPlayer(state.pendingAttack.targetId);
    if (player.id === target.id) {
      return buildTargetInterventionStageHtml(player, attacker, signalBlock);
    }
    if (state.pendingAttack.volunteerIds.includes(player.id)) {
      const evaluation = evaluateInterventionForTarget(target, player);
      return `
        <section class="strategy-section strategy-stage-section">
          <h3>当前阶段判断</h3>
          <p>我已经提出替 ${target.name} 挡刀。目标会评估我到底是队友保护，还是敌方想抢下一刀主动权。</p>
          <p><span class="strategy-key">目标视角下我的干预收益：</span>${evaluation.reason}</p>
          ${signalBlock}
        </section>
      `;
    }
    if (eligibleInterveners().some((candidate) => candidate.id === player.id)) {
      const evaluation = evaluateInterventionForTarget(target, player);
      const advice = evaluation.offerScore > 0 ? "可以提出干预，用暴露Rank换信息和信任。" : "不建议提出干预，收益不足或暴露风险偏高。";
      return `
        <section class="strategy-section strategy-stage-section">
          <h3>当前阶段判断</h3>
          <p>${attacker.name} 正在攻击 ${target.name}，我可以选择是否干预。</p>
          <p><span class="strategy-key">干预建议：</span><span class="${evaluation.offerScore > 0 ? "strategy-danger" : "strategy-key"}">${advice}</span></p>
          <p>${evaluation.reason}</p>
          ${signalBlock}
        </section>
      `;
    }
    return `
      <section class="strategy-section strategy-stage-section">
        <h3>当前阶段判断</h3>
        <p>${attacker.name} 正在攻击 ${target.name}。我不是本次目标，也暂时不是有效干预者，重点观察谁愿意站出来以及目标是否接受。</p>
        ${signalBlock}
      </section>
    `;
  }

  return `
    <section class="strategy-section strategy-stage-section">
      <h3>当前阶段判断</h3>
      <p>当前不在干预阶段，主要任务是按胜率排序选择攻击目标或保留主动权。</p>
      ${signalBlock}
    </section>
  `;
}

function buildStrategySummaryHtml(model, bestScore, bestEnemyProb, bestEnemyLeaderProb, bestAllyLeaderProb) {
  if (state.phase === "ability" && state.pendingAbility?.type === "assassin" && state.pendingAbility.playerId === model.player.id) {
    const best = model.bestAssassinSkill;
    if (best) {
      return `
        <section class="strategy-summary">
          <p><span class="strategy-key">结论摘要：</span><span class="strategy-danger">发动刺客技能攻击 ${best.player.name}</span></p>
          <p class="strategy-muted">原因：${best.resultText}；P(敌方长老)=${percent(best.enemyLeaderProb)}，击杀/胜利概率=${percent(best.winProb)}，综合收益 ${best.skillScore.toFixed(1)}。</p>
        </section>
      `;
    }
  }

  if (state.phase === "intervention" && state.pendingAttack) {
    const target = getPlayer(state.pendingAttack.targetId);
    if (model.player.id === target.id) {
      const evaluations = buildInterventionEvaluationsFor(target);
      const best = evaluations[0];
      if (best && best.evaluation.acceptScore > 0) {
        return `
          <section class="strategy-summary">
            <p><span class="strategy-key">结论摘要：</span><span class="strategy-danger">接受 ${best.volunteer.name} 干预</span></p>
            <p class="strategy-muted">原因：综合收益 ${best.evaluation.acceptScore.toFixed(2)}，P(队友)=${percent(best.evaluation.allyProb)}，敌方主动权风险=${percent(best.evaluation.enemyInitiativeRisk)}。</p>
          </section>
        `;
      }
      return `
        <section class="strategy-summary">
          <p><span class="strategy-key">结论摘要：</span><span class="strategy-danger">拒绝全部干预，自己承伤</span></p>
          <p class="strategy-muted">原因：当前干预者的综合收益不足，接受可能让敌方抢下一刀主动权或让我方关键角色过早暴露。</p>
        </section>
      `;
    }
  }

  const conclusionReason =
    bestScore.enemyLeaderNumerator > 0
      ? `敌方领袖概率 ${bestEnemyLeaderProb}`
      : `敌人概率 ${bestEnemyProb}`;
  return `
    <section class="strategy-summary">
      <p><span class="strategy-key">结论摘要：</span><span class="strategy-danger">攻击 ${bestScore.player.name}</span></p>
      <p class="strategy-muted">原因：${conclusionReason}；同时误伤己方领袖概率 ${bestAllyLeaderProb}。</p>
    </section>
  `;
}

function buildTargetInterventionStageHtml(target, attacker, signalBlock) {
  const evaluations = buildInterventionEvaluationsFor(target);
  const rows = evaluations
    .map(
      ({ volunteer, evaluation }) => `
        <tr>
          <td>${volunteer.name}</td>
          <td><span class="strategy-danger">${percent(evaluation.allyProb)}</span></td>
          <td>${percent(evaluation.enemyProb)}</td>
          <td>${percent(evaluation.allyLeaderRisk)}</td>
          <td>${percent(evaluation.enemyInitiativeRisk)}</td>
          <td><span class="strategy-danger">${evaluation.acceptScore.toFixed(2)}</span></td>
        </tr>
      `,
    )
    .join("");
  const best = evaluations[0];
  const conclusion = best && best.evaluation.acceptScore > 0
    ? `接受 <span class="strategy-danger">${best.volunteer.name}</span> 干预。`
    : `拒绝全部干预，自己承伤。`;

  return `
    <section class="strategy-section strategy-stage-section">
      <h3>当前阶段判断</h3>
      <p><span class="strategy-danger">${attacker.name}</span> 正在攻击我，因此 ${attacker.name} 在我的视角里敌意上升。我可以喊队友挡刀，也可以用求援观察谁会站出来。</p>
      ${signalBlock}
      <p><span class="strategy-key">多人干预收益排序：</span>${conclusion}</p>
      ${
        evaluations.length
          ? `<div class="strategy-table-wrap">
              <table class="strategy-table strategy-intervention-table">
                <thead>
                  <tr>
                    <th>干预者</th>
                    <th>P(队友)</th>
                    <th>P(敌人)</th>
                    <th>P(己方领袖)</th>
                    <th>敌方主动权风险</th>
                    <th>综合收益</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>`
          : `<p class="strategy-muted">目前还没有玩家提出干预，我只能先准备自己承伤。</p>`
      }
    </section>
  `;
}

function buildInterventionEvaluationsFor(player) {
  if (state.phase !== "intervention" || !state.pendingAttack || state.pendingAttack.targetId !== player.id) return [];
  return state.pendingAttack.volunteerIds
    .map(getPlayer)
    .map((volunteer) => ({ volunteer, evaluation: evaluateInterventionForTarget(player, volunteer) }))
    .sort((left, right) => right.evaluation.acceptScore - left.evaluation.acceptScore);
}

function signalText(signal) {
  const actor = getPlayer(signal.actorId);
  const target = getPlayer(signal.targetId);
  if (signal.type === "attack") return `${actor.name} 攻击 ${target.name}：在 ${target.name} 视角中，${actor.name} 敌意上升。`;
  if (signal.type === "intervention_offer") return `${actor.name} 愿意替 ${target.name} 挡刀：可能是队友保护，也可能是想抢下一刀主动权或借挡刀触发技能。`;
  if (signal.type === "intervention_accept") return `${actor.name} 接受 ${target.name} 干预：记录为阶段性信任。`;
  if (signal.type === "intervention_reject") return `${actor.name} 拒绝 ${target.name} 干预：说明当时收益不足或风险偏高。`;
  return "未知公开行为。";
}

function buildFinalAction(model) {
  const { clueTarget, bestAction } = model;
  if (bestAction.captureOutcome?.type === "lose") {
    return `不补刀 ${bestAction.player.name}：该目标已确认不是敌方领袖，捕获会直接抓错。改为寻找敌方领袖或先打不会立即捕获的目标。`;
  }
  if (bestAction.captureOutcome?.type === "unknown") {
    return `暂不直接捕获 ${bestAction.player.name}：目标身份还不能确认是敌方领袖，先选择不会立刻抓错的施压路线。`;
  }
  if (bestAction.captureOutcome?.type === "win") {
    return `直接攻击 <span class="strategy-danger">${bestAction.player.name}</span>：目标已确认是敌方当前领袖，本次捕获可以获胜。`;
  }
  if (bestAction.spentAbilityPenalty) {
    return `${bestAction.spentAbilityPenalty} 不继续围绕该类目标消耗攻击，改为攻击 <span class="strategy-danger">${bestAction.player.name}</span>。`;
  }
  if (bestAction.player.id === clueTarget.id) {
    return `不传刀给 ${clueTarget.name}，直接攻击 <span class="strategy-danger">${clueTarget.name}</span>。`;
  }
  return `不攻击 ${clueTarget.name}，也不把匕首传给 ${clueTarget.name}。行动：攻击胜率排序最高的 <span class="strategy-danger">${bestAction.player.name}</span>。`;
}

function sameRole(left, right) {
  return left.clan === right.clan && left.rank === right.rank;
}

function roleText(role) {
  return `${role.clanName} / ${role.role} / Rank ${role.rank}`;
}

function formatFraction(numerator, denominator) {
  const divisor = gcd(numerator, denominator);
  const simpleNumerator = numerator / divisor;
  const simpleDenominator = denominator / divisor;
  const percent = ((numerator / denominator) * 100).toFixed(1).replace(/\.0$/, "");
  return `${simpleNumerator}/${simpleDenominator} = ${percent}%`;
}

function gcd(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

function isLeader(player) {
  const clanPlayers = state.players.filter((candidate) => candidate.clan === player.clan);
  const ranks = clanPlayers.map((candidate) => candidate.rank);
  const leaderRank = state.leaderRule[player.clan] === "highest" ? Math.max(...ranks) : Math.min(...ranks);
  return player.rank === leaderRank;
}

function oppositeClanName(clan) {
  return clan === "Rose" ? "野兽氏族" : "玫瑰氏族";
}

function chooseRevealMarker(player) {
  const markers = availableMarkers(player);
  const clanMarker = player.clan === "Rose" ? "rose" : "beast";

  if (firstAvailableMarkerOfType(player, "unknown")) return firstAvailableMarkerOfType(player, "unknown");
  if (player.rank === 1 && player.wounds < 2 && firstAvailableMarkerOfType(player, clanMarker)) {
    return firstAvailableMarkerOfType(player, clanMarker);
  }
  if (player.wounds >= 2 && firstAvailableMarkerOfType(player, clanMarker)) return firstAvailableMarkerOfType(player, clanMarker);
  if (markers.includes("rank")) return "rank";
  return markers[0];
}

function chooseAttackTarget(current) {
  const candidates = activePlayers().filter((player) => player.id !== current.id);
  return candidates
    .map((player) => ({ player, score: attackScore(current, player) }))
    .sort((left, right) => right.score - left.score)[0].player;
}

function chooseAssassinSkillTarget(assassin) {
  const model = latestStrategyModel(assassin);
  return model.bestAssassinSkill?.player || chooseAttackTarget(assassin);
}

function attackScore(current, target) {
  let score = target.wounds * 4;
  if (believesOpposingClan(current, target)) score += 14;
  if (visibleLeaderRisk(current, target) === "enemy") score += 20;
  if (hasRevealed(target, "unknown")) score += 2;
  if (believesSameClan(current, target)) score -= 18;
  if (visibleLeaderRisk(current, target) === "ally") score -= 30;
  return score;
}

function chooseIntervener(attacker, target) {
  const candidates = eligibleInterveners()
    .map((player) => ({ player, evaluation: evaluateInterventionOffer(player, target, attacker) }))
    .filter(({ evaluation }) => evaluation.offerScore > 0);
  if (!candidates.length) return null;

  return candidates.sort((left, right) => right.evaluation.offerScore - left.evaluation.offerScore)[0].player;
}

function chooseAcceptedIntervener(target) {
  const ranked = state.pendingAttack.volunteerIds
    .map(getPlayer)
    .map((volunteer) => ({ volunteer, evaluation: evaluateInterventionForTarget(target, volunteer) }))
    .sort((left, right) => right.evaluation.acceptScore - left.evaluation.acceptScore);

  if (!ranked.length || ranked[0].evaluation.acceptScore <= 0) return null;
  return ranked[0].volunteer;
}

function infoValueScore(observer, player) {
  let score = player.wounds * 2;
  if (hasRevealed(player, "rank")) score += 3;
  if (hasRevealed(player, "unknown")) score += 2;
  if (visibleLeaderRisk(observer, player) !== "unknown") score += 6;
  return score;
}

function chooseHarlequinPeekTarget(owner) {
  const candidates = activePlayers()
    .filter((player) => player.id !== owner.id && !state.pendingAbility.selectedIds.includes(player.id));
  const freshCandidates = candidates.filter((player) => !knownRoleTo(owner, player) && !isHighlyConfirmedHarlequinTo(owner, player));
  const pool = freshCandidates.length ? freshCandidates : candidates.filter((player) => !knownRoleTo(owner, player));
  const finalPool = pool.length ? pool : candidates;
  return finalPool
    .map((player) => ({ player, score: harlequinPeekScore(owner, player) }))
    .sort((left, right) => right.score - left.score || left.player.id - right.player.id)[0].player;
}

function harlequinPeekScore(observer, player) {
  if (knownRoleTo(observer, player)) return -1000;

  let score = infoValueScore(observer, player);
  const visibleClan = visibleClanTo(observer, player);
  const visibleRank = knownRankTo(observer, player);
  if (visibleClan && visibleClan !== observer.clan && visibleRank === 1) score += 60;
  if (visibleClan && visibleClan !== observer.clan && visibleRank === 2) score += 42;
  if (visibleClan && visibleClan !== observer.clan) score += 22;
  if (visibleRank === 1) score += 20;
  if (visibleRank === 2) score += 14;
  if (player.wounds >= 2) score += 10;
  if (player.id === clueTargetFor(observer).id) score += 4;
  if (isHighlyConfirmedHarlequinTo(observer, player)) score -= 80;
  return score;
}

function isHighlyConfirmedHarlequinTo(observer, player) {
  if (knownRoleTo(observer, player)) return false;
  return (
    hasRevealed(player, "rank") &&
    player.rank === 3 &&
    state.gameEvents.some(
      (event) =>
        event.type === "private_intel" &&
        event.actorId === player.id &&
        event.targetId === observer.id,
    )
  );
}

function hasOpposingClanMarker(current, target) {
  const opposingMarker = current.clan === "Rose" ? "beast" : "rose";
  return hasRevealed(target, opposingMarker);
}

function explainAttackPurpose(current, target) {
  const captureOutcome = captureOutcomeFor(current, target, 1);
  if (captureOutcome.type === "win") return `目标已确认是敌方领袖，攻击可以直接捕获并获胜。`;
  if (captureOutcome.type === "lose") return `该目标不是敌方领袖，正常策略不应补刀；如果执行就是误捕风险。`;
  if (captureOutcome.type === "unknown") return `目标会被本次攻击捕获，但当前不能确认其为敌方领袖，必须谨慎。`;
  if (target.wounds >= 3) return "目标已经3伤，但本次捕获不会抓错时才值得补刀。";
  if (visibleLeaderRisk(current, target) === "enemy") return "根据公开Rank和已知阵营线索，目标疑似敌方领袖，值得集中火力。";
  if (believesOpposingClan(current, target)) return "根据公开标记或自己看过的线索，目标更像敌对阵营，需要继续施压。";
  if (believesSameClan(current, target)) return "这是一次冒险攻击，用来测试同阵营线索是否可靠。";
  return "当前只掌握公开信息，先攻击未明身份玩家，迫使其公开更多标记。";
}

function explainInterventionPurpose(volunteer, target) {
  if (visibleLeaderRisk(volunteer, target) === "ally") return `${target.name} 根据自己可见的信息疑似本方领袖，需要保护。`;
  if (target.wounds >= 2) return `${target.name} 伤害偏高，代为承伤可以拖延捕获风险。`;
  return `${target.name} 根据自己可见的信息像同阵营玩家，干预可以换取信任并打乱攻击节奏。`;
}

function explainAcceptPurpose(target, accepted) {
  if (believesSameClan(target, accepted)) return "根据自己可见的信息，干预者像队友，接受保护可以降低被捕获风险。";
  return "利用对方主动暴露Rank，换取更多公开情报。";
}

function explainRevealPurpose(marker) {
  if (marker === "unknown") return "先隐藏真实阵营，避免过早成为集火目标。";
  if (marker === "rank") return "公开位置等级，触发角色能力并帮助队友判断领袖风险。";
  return "公开阵营倾向，让同阵营玩家更容易判断是否保护自己。";
}

function attackEvidence(observer, target) {
  const parts = [];
  const visibleClan = visibleClanTo(observer, target);
  const visibleRank = knownRankTo(observer, target);
  if (visibleClan) parts.push(`${observer.name} 看到 ${target.name} 的阵营倾向为${clanName(visibleClan)}`);
  if (visibleRank !== null) parts.push(`${target.name} 的Rank对 ${observer.name} 可见为 ${visibleRank}`);
  if (target.revealed.length) parts.push(`${target.name} 已公开 ${target.revealed.map((marker) => markerRevealLabel(marker, target)).join("、")}`);
  parts.push(`${target.name} 当前 ${target.wounds} 伤`);
  return parts.join("；");
}

function interventionEvidence(observer, target) {
  const visibleClan = visibleClanTo(observer, target);
  const visibleRank = knownRankTo(observer, target);
  const parts = [];
  if (visibleClan) parts.push(`${observer.name} 看到 ${target.name} 的阵营倾向为${clanName(visibleClan)}`);
  if (visibleRank !== null) parts.push(`${target.name} 的Rank对 ${observer.name} 可见为 ${visibleRank}`);
  parts.push(`${target.name} 当前 ${target.wounds} 伤`);
  return parts.join("；");
}

function acceptEvidence(target, accepted = null) {
  if (!accepted) return "没有干预者在目标视角下显示出同阵营倾向";
  const visibleClan = visibleClanTo(target, accepted);
  const rank = knownRankTo(target, accepted);
  const parts = [];
  if (visibleClan) parts.push(`${target.name} 看到 ${accepted.name} 的阵营倾向为${clanName(visibleClan)}`);
  if (rank !== null) parts.push(`${accepted.name} 的Rank对 ${target.name} 可见为 ${rank}`);
  return parts.length ? parts.join("；") : "没有额外公开信息";
}

function recordSignal(type, payload) {
  state.publicSignals.push({
    type,
    ...payload,
    index: nextLogIndex(),
  });
  recordGameEvent(type, payload);
}

function recordGameEvent(type, payload = {}, options = {}) {
  state.gameEvents.push({
    id: state.gameEvents.length + 1,
    type,
    ...payload,
    phase: state.phase,
    currentPlayerId: state.currentPlayerId,
  });

  if (options.recompute === false || !state.players.length) return;
  recomputeAllStrategies(type);
}

function recomputeAllStrategies(reason = "事件更新") {
  if (!state.players.length) return;

  const snapshots = {};
  state.players.forEach((player) => {
    const model = buildStrategyModel(player);
    snapshots[player.id] = {
      playerId: player.id,
      reason,
      eventCount: state.gameEvents.length,
      hardFacts: buildHardFactsFor(player),
      recentEvents: relevantEventsFor(player, 8),
      model,
      forcedWin: detectForcedWinFor(player),
      updatedAt: Date.now(),
    };
  });
  state.strategySnapshots = snapshots;
  refreshOpenStrategyModal();
}

function strategySnapshotFor(player) {
  if (!state.strategySnapshots[player.id]) {
    recomputeAllStrategies("即时策略计算");
  }
  return state.strategySnapshots[player.id] || null;
}

function refreshOpenStrategyModal() {
  if (identityModal.classList.contains("hidden") || !modalBox.classList.contains("strategy-mode") || !state.strategyModalPlayerId) return;
  const player = getPlayer(state.strategyModalPlayerId);
  if (!player) return;
  modalTitle.textContent = `${player.name} 当前最优策略`;
  modalBody.innerHTML = buildStrategyHtml(player);
}

function buildHardFactsFor(player) {
  const clueTarget = clueTargetFor(player);
  return [
    `我的身份：${fullRoleLabel(player)}`,
    `我开局看到 ${clueTarget.name} 的颜色：${playerColorText(clueTarget)}`,
    `我当前伤害：${player.wounds}/4`,
    `当前阶段：${state.phase}`,
    ...privateIntelFor(player).map((entry) => {
      const target = getPlayer(entry.targetId);
      return target ? `私密偷看：${target.name} 是 ${fullRoleLabel(target)}` : "";
    }).filter(Boolean),
    ...state.players
      .filter((target) => target.captured || target.revealed.length)
      .map((target) => `${target.name} 公开信息：${target.revealed.map((marker) => markerRevealLabel(marker, target)).join("、") || "无"}；伤害 ${target.wounds}/4${target.captured ? `；已捕获=${fullRoleLabel(target)}` : ""}`),
  ];
}

function relevantEventsFor(player, limit = 8) {
  return state.gameEvents
    .filter((event) => isEventVisibleToPlayer(player, event))
    .slice(-limit);
}

function isEventVisibleToPlayer(player, event) {
  if (event.privateForId) return event.privateForId === player.id;
  return true;
}

function eventTextFor(player, event) {
  const actor = event.actorId ? getPlayer(event.actorId) : null;
  const target = event.targetId ? getPlayer(event.targetId) : null;
  if (event.type === "chat") return `${actor?.name || "系统"} 发言：${event.text}`;
  if (event.type === "attack") return `${actor?.name} 攻击 ${target?.name}`;
  if (event.type === "intervention_offer") return `${actor?.name} 提出替 ${target?.name} 挡刀`;
  if (event.type === "intervention_accept") return `${actor?.name} 接受 ${target?.name} 挡刀`;
  if (event.type === "intervention_reject") return `${actor?.name} 拒绝 ${target?.name} 挡刀`;
  if (event.type === "reveal") return `${actor?.name} 公开 ${event.markerLabel}，伤害 ${event.wounds}/4`;
  if (event.type === "ability") return `${actor?.name} 发动 ${event.ability} 能力`;
  if (event.type === "private_intel") return `${actor?.name} 偷看 ${target?.name} 的完整身份`;
  if (event.type === "capture") return `${target?.name} 被捕获`;
  if (event.type === "dagger") return `匕首转移给 ${target?.name}`;
  return event.type;
}

function signalsForPlayer(player) {
  return state.publicSignals.filter(
    (signal) =>
      signal.actorId === player.id ||
      signal.targetId === player.id ||
      signal.attackerId === player.id,
  );
}

function behaviorModifierFor(observer, target) {
  let enemyDelta = 0;
  let allyDelta = 0;
  const reasons = [];

  state.publicSignals.forEach((signal) => {
    if (signal.type === "attack" && signal.actorId === target.id && signal.targetId === observer.id) {
      enemyDelta += 0.25;
      reasons.push(`${target.name} 攻击过我，敌意上升`);
    }
    if (signal.type === "intervention_offer" && signal.actorId === target.id && signal.targetId === observer.id) {
      allyDelta += 0.2;
      reasons.push(`${target.name} 愿意替我挡刀，队友倾向上升，但仍可能想抢下一刀主动权`);
    }
    if (signal.type === "intervention_accept" && signal.actorId === observer.id && signal.targetId === target.id) {
      allyDelta += 0.1;
      reasons.push(`我曾接受 ${target.name} 干预，阶段性信任上升`);
    }
    if (signal.type === "intervention_reject" && signal.actorId === observer.id && signal.targetId === target.id) {
      enemyDelta += 0.08;
      reasons.push(`我曾拒绝 ${target.name} 干预，说明当时收益不足或风险偏高`);
    }
  });

  state.gameEvents.forEach((event) => {
    if (event.type !== "chat" || event.actorId !== target.id || target.id === observer.id) return;
    const tags = event.tags || [];
    if (tags.includes("reveal_intel")) {
      allyDelta += 0.04;
      reasons.push(`${target.name} 公开信息，可信度小幅上升`);
    }
    if (tags.includes("withhold_intel")) {
      enemyDelta += 0.03;
      reasons.push(`${target.name} 表示暂不全说信息，需要继续观察`);
    }
    if (tags.includes("misdirect")) {
      enemyDelta += 0.04;
      reasons.push(`${target.name} 使用烟雾弹/试探话术，风险小幅上升`);
    }
    if (tags.includes("request_help") || tags.includes("protect")) {
      allyDelta += 0.02;
      reasons.push(`${target.name} 在公开发言中寻求配合或保护`);
    }
    if (tags.includes("accuse")) {
      enemyDelta += 0.02;
      reasons.push(`${target.name} 公开施压他人，攻击性小幅上升`);
    }
  });

  return { enemyDelta, allyDelta, reasons };
}

function elderInterventionExposureRisk(volunteer, target) {
  if (volunteer.rank !== 1 || hasRevealed(volunteer, "rank")) {
    return { acceptPenalty: 0, offerPenalty: 0, reason: "" };
  }

  const woundPenalty = volunteer.wounds >= 2 ? 0.75 : volunteer.wounds === 1 ? 0.58 : 0.42;
  const targetEmergency = isLeader(target) || target.wounds >= 2 ? 0.18 : 0;
  const offerPenalty = Math.max(0.25, woundPenalty - targetEmergency);
  const acceptPenalty = Math.max(0.18, offerPenalty * 0.65);
  const riskText =
    volunteer.wounds >= 2
      ? `${volunteer.name} 已经2伤，挡刀公开Rank 1后极易被刺客直接击杀。`
      : volunteer.wounds === 1
      ? `${volunteer.name} 已经1伤，挡刀公开Rank 1后会进入刺客封印/3伤倒计时。`
      : `${volunteer.name} 满血挡刀也会公开Rank 1；唯一收益是避免“不挡刀更像长老”的反向嫌疑。`;

  return {
    acceptPenalty,
    offerPenalty,
    reason: `长老暴露风险：挡刀成功必须公开Rank。${riskText}`,
  };
}

function evaluateInterventionOffer(volunteer, target, attacker = null) {
  const model = buildStrategyModel(volunteer, false);
  const score = model.actionScores.find((entry) => entry.player.id === target.id);
  const denominator = score?.denominator || 1;
  const allyProb = probability(score?.allyNumerator || 0, denominator);
  const enemyProb = probability(score?.enemyNumerator || 0, denominator);
  const allyLeaderProb = probability(score?.allyLeaderNumerator || 0, denominator);
  const enemyLeaderProb = probability(score?.enemyLeaderNumerator || 0, denominator);
  const knownTarget = knownRoleTo(volunteer, target);
  const targetIsKnownEnemy = Boolean(knownTarget && knownTarget.clan !== volunteer.clan);
  const targetIsKnownEnemyLeader = Boolean(targetIsKnownEnemy && isLeader(target));
  const targetIsKnownAllyKey = Boolean(knownTarget && knownTarget.clan === volunteer.clan && (knownTarget.rank === 1 || knownTarget.rank === 2));
  const attackerPressure = attacker && isKnownEnemyLeader(volunteer, attacker) ? 0.12 : 0;
  const attackerLeaderInference = attacker ? inferredElderFromClanMarkers(volunteer, attacker) : null;
  const assassinCounterOpportunity = Boolean(
    attacker &&
      volunteer.rank === 2 &&
      !hasRevealed(volunteer, "rank") &&
      (isKnownEnemyLeader(volunteer, attacker) || (attackerLeaderInference?.enemy && attackerLeaderInference.currentLeader)),
  );
  const targetEmergency = target.wounds >= 2 ? 0.28 : target.wounds === 1 ? 0.12 : 0;
  const infoValue = hasRevealed(volunteer, "rank") ? 0.02 : 0.08;
  const enemyProtectionPenalty = targetIsKnownEnemyLeader ? 2.2 : targetIsKnownEnemy ? 1.2 : enemyLeaderProb * 1.3 + enemyProb * 0.45;
  const elderExposure = elderInterventionExposureRisk(volunteer, target);
  const elderSelfPenalty = volunteer.rank === 1 && !hasRevealed(volunteer, "rank")
    ? volunteer.wounds >= 1 ? 1.25 : 0.95
    : 0;
  const assassinSelfPenalty = volunteer.rank === 2 && !hasRevealed(volunteer, "rank") && volunteer.wounds === 0 && !assassinCounterOpportunity ? 0.35 : 0;
  const assassinCounterBonus = assassinCounterOpportunity
    ? attacker.wounds >= 2
      ? 2.1
      : attacker.wounds === 1
      ? 1.75
      : 1.15
    : 0;
  const keyAllyBonus = targetIsKnownAllyKey ? 0.85 : allyLeaderProb * 0.35 + allyProb * 0.42;
  const offerScore =
    keyAllyBonus +
    targetEmergency +
    infoValue +
    attackerPressure -
    enemyProtectionPenalty -
    elderExposure.offerPenalty -
    elderSelfPenalty -
    assassinSelfPenalty +
    assassinCounterBonus;
  const reasonParts = [];
  if (targetIsKnownEnemyLeader) reasonParts.push(`${volunteer.name} 已知 ${target.name} 是敌方长老，不能替他挡刀。`);
  if (targetIsKnownEnemy && !targetIsKnownEnemyLeader) reasonParts.push(`${target.name} 在 ${volunteer.name} 视角中是敌方，主动保护收益为负。`);
  if (volunteer.rank === 1 && !hasRevealed(volunteer, "rank")) reasonParts.push(`${volunteer.name} 是未公开长老，挡刀会暴露 Rank 1。`);
  if (volunteer.rank === 2 && !hasRevealed(volunteer, "rank") && volunteer.wounds === 0 && !assassinCounterOpportunity) reasonParts.push(`${volunteer.name} 满血刺客挡刀开技能的时机偏早。`);
  if (assassinCounterOpportunity) reasonParts.push(`${volunteer.name} 可借挡刀公开刺客 Rank，并立刻用技能压制已暴露的敌方长老 ${attacker.name}。`);
  if (targetIsKnownAllyKey) reasonParts.push(`${target.name} 是已知己方关键位，存在例外保护价值。`);

  return {
    volunteer,
    allyProb,
    enemyProb,
    allyLeaderProb,
    enemyLeaderProb,
    offerScore,
    reason: reasonParts.join(" ") || `从 ${volunteer.name} 自己视角评估，保护 ${target.name} 的收益为 ${offerScore.toFixed(2)}。`,
  };
}

function evaluateInterventionForTarget(target, volunteer) {
  const score = buildStrategyModel(target, false).actionScores.find((entry) => entry.player.id === volunteer.id);
  const denominator = score?.denominator || 1;
  const allyProb = probability(score?.allyNumerator || 0, denominator);
  const enemyProb = probability(score?.enemyNumerator || 0, denominator);
  const allyLeaderRisk = probability(score?.allyLeaderNumerator || 0, denominator);
  const enemyLeaderRisk = probability(score?.enemyLeaderNumerator || 0, denominator);
  const behavior = behaviorModifierFor(target, volunteer);
  const adjustedAlly = clamp01(allyProb + behavior.allyDelta);
  const adjustedEnemy = clamp01(enemyProb + behavior.enemyDelta);
  const infoGain = hasRevealed(volunteer, "rank") ? 0.05 : 0.18;
  const damageRelief = target.wounds >= 2 ? 0.35 : 0.22;
  const enemyInitiativeRisk = adjustedEnemy * 0.35;
  const allyLeaderExposureRisk = allyLeaderRisk * 0.4;
  const enemySkillRisk = enemyProb * 0.15;
  const elderExposure = elderInterventionExposureRisk(volunteer, target);
  const acceptScore = adjustedAlly + infoGain + damageRelief - enemyInitiativeRisk - allyLeaderExposureRisk - enemySkillRisk - elderExposure.acceptPenalty;
  const offerScore = adjustedAlly + damageRelief - enemyInitiativeRisk - allyLeaderExposureRisk - elderExposure.offerPenalty;
  const reason = `接受收益：少吃1点伤害，并迫使 ${volunteer.name} 公开Rank；风险：若其为敌人，可能拿到下一刀主动权或借Rank触发技能。${elderExposure.reason}当前估计 P(队友)=${percent(adjustedAlly)}，P(敌人)=${percent(adjustedEnemy)}，P(己方领袖)=${percent(allyLeaderRisk)}，综合收益 ${acceptScore.toFixed(2)}。`;

  return {
    volunteer,
    allyProb: adjustedAlly,
    enemyProb: adjustedEnemy,
    allyLeaderRisk,
    enemyLeaderRisk,
    infoGain,
    enemyInitiativeRisk,
    elderExposure,
    acceptScore,
    offerScore,
    reasons: behavior.reasons,
    reason,
  };
}

function buildInterventionOfferChat(volunteer, target) {
  const evaluation = evaluateInterventionForTarget(target, volunteer);
  if (volunteer.rank === 1) {
    return `我可以替 ${target.name} 挡刀，但这不是普通保护：挡刀成功会让我公开 Rank 1，也就是暴露长老身份。只有在我判断“不挡更像长老”或目标损失更大时，这个高风险伪装才值得考虑。当前综合收益 ${evaluation.offerScore.toFixed(2)}。`;
  }
  return `我愿意替 ${target.name} 挡刀。我的价值是暴露Rank换信息，并帮目标少吃1点伤害；你们也可以观察我这么做到底是队友保护，还是想抢下一刀主动权。当前目标视角下我约为队友 ${percent(evaluation.allyProb)}。`;
}

function buildRejectInterventionReason(target) {
  const evaluations = state.pendingAttack.volunteerIds.map((id) => evaluateInterventionForTarget(target, getPlayer(id)));
  if (!evaluations.length) return "没有可接受的干预者";
  const best = evaluations.sort((left, right) => right.acceptScore - left.acceptScore)[0];
  return `我评估后认为接受 ${best.volunteer.name} 的综合收益不足，主要风险是敌方抢下一刀主动权、借挡刀触发技能，或让我方关键角色过早暴露。`;
}

function buildAcceptInterventionChat(target, accepted) {
  return pickLine(
    [
      `我让 ${accepted.name} 挡这刀。先看看他亮什么，后面再说。`,
      `${accepted.name} 站出来了，那这刀给他接。`,
      `我选 ${accepted.name} 挡一下。别急，先把信息打出来。`,
      `这刀让 ${accepted.name} 接，我先记这个选择。`,
      `行，我同意 ${accepted.name} 帮我挡。`,
      `这刀让 ${accepted.name} 接，大家看结果。`,
    ],
    target.id,
    accepted.id,
    state.logIndex,
  );
}

function buildRejectInterventionChat(target) {
  const volunteers = state.pendingAttack?.volunteerIds || [];
  if (!volunteers.length) {
    return pickLine(
      [
        `没人出来，那这刀我自己吃。`,
        `没人挡就算了，我自己扛。`,
        `这刀没人接，我自己亮。`,
      ],
      target.id,
      state.logIndex,
    );
  }
  return pickLine(
    [
      `这刀我自己吃，先别抢挡。`,
      `我不接挡刀。现在让别人挡，节奏太乱。`,
      `都先别挡，我自己来。`,
      `这次我不让别人接，后面看亮出来的信息。`,
      `我拒绝挡刀，先把这刀吃下来。`,
    ],
    target.id,
    volunteers.length,
    state.logIndex,
  );
}

function buildInterventionOfferChat(volunteer, target) {
  const attacker = state.pendingAttack?.attackerId ? getPlayer(state.pendingAttack.attackerId) : null;
  const canCounterLeader =
    volunteer.rank === 2 &&
    attacker &&
    !hasRevealed(volunteer, "rank") &&
    (isKnownEnemyLeader(volunteer, attacker) ||
      (inferredElderFromClanMarkers(volunteer, attacker)?.enemy &&
        inferredElderFromClanMarkers(volunteer, attacker)?.currentLeader));
  if (canCounterLeader) {
    return pickLine(
      [
        `${target.name}，这刀我可以接。${attacker.name} 已经像对面长老了，我亮出来以后能直接给他压力。`,
        `我来挡有收益：不是单纯替你吃刀，是能反手压 ${attacker.name}。你要信我就让我接。`,
        `${attacker.name} 这个位置很关键。我可以接刀开局面，但你来决定。`,
        `这刀我能挡，挡完我有办法处理 ${attacker.name}。`,
      ],
      volunteer.id,
      target.id,
      attacker.id,
      state.logIndex,
    );
  }
  if (volunteer.rank === 1) {
    return pickLine(
      [
        `我能挡，但这事风险很大，我不想白白亮身份。${target.name} 你自己判断要不要接。`,
        `我可以站出来，不过这刀让我接不便宜。你要是真需要，我可以挡。`,
        `我不是随便挡刀的人。${target.name} 你想清楚，要我接就点我。`,
        `这刀我能挡一下，但别把这当成普通保护。`,
      ],
      volunteer.id,
      target.id,
      state.logIndex,
    );
  }
  if (volunteer.rank === 3) {
    return pickLine(
      [
        `我可以接这刀，至少能把局面打亮一点。`,
        `${target.name}，你要是信我，这刀我来吃。`,
        `我愿意挡一下，看看谁紧张。`,
        `这刀我能接，接不接你决定。`,
      ],
      volunteer.id,
      target.id,
      state.logIndex,
    );
  }
  return pickLine(
    [
      `我可以挡一下，但你自己决定要不要接。`,
      `${target.name}，需要的话我来接这刀。`,
      `我能帮你挡，但别急着定，先看清楚。`,
      `这刀我可以站出来，接不接看你。`,
      `我愿意挡一下，至少能多亮点信息。`,
    ],
    volunteer.id,
    target.id,
    state.logIndex,
  );
}

function buildCasualSkillChat(player, target, context = "") {
  if (player.rank === 2) {
    return pickLine(
      [
        `我用技能打 ${target.name}。这刀不能挡，我要直接把压力打出来。`,
        `${target.name} 这里我直接上技能，不给人挡。`,
        `我技能给 ${target.name}。现在别绕了，直接压他。`,
        `这次我点 ${target.name}，技能伤害，挡不了。`,
        context === "leader" ? `${target.name} 是关键位，我技能直接打他。` : `我技能先打 ${target.name}，看他怎么掉标记。`,
      ],
      player.id,
      target.id,
      state.logIndex,
    );
  }
  return pickLine(
    [
      `我先看 ${target.name}。`,
      `${target.name} 这里我想确认一下。`,
      `我看一眼 ${target.name}，后面好判断。`,
      `先把 ${target.name} 的身份弄清楚。`,
    ],
    player.id,
    target.id,
    state.logIndex,
  );
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function percent(value) {
  return `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

function visibleClanTo(observer, target) {
  if (observer.id === target.id) return target.clan;
  if (hasRevealed(target, "rose")) return "Rose";
  if (hasRevealed(target, "beast")) return "Beast";
  if (canSeeClue(observer, target)) return clueClan(target.clue);
  return null;
}

function believesSameClan(observer, target) {
  return visibleClanTo(observer, target) === observer.clan;
}

function believesOpposingClan(observer, target) {
  const visibleClan = visibleClanTo(observer, target);
  return visibleClan !== null && visibleClan !== observer.clan;
}

function visibleLeaderRisk(observer, target) {
  const inferred = inferredElderFromClanMarkers(observer, target);
  if (inferred && inferred.currentLeader) return inferred.enemy ? "enemy" : "ally";

  const visibleClan = visibleClanTo(observer, target);
  const visibleRank = knownRankTo(observer, target);
  if (!visibleClan || visibleRank === null) return "unknown";

  const leaderRank = state.leaderRule[visibleClan] === "highest" ? 3 : 1;
  if (visibleRank !== leaderRank) return "unknown";
  return visibleClan === observer.clan ? "ally" : "enemy";
}

function knownRankTo(observer, target) {
  if (observer.id === target.id || hasRevealed(target, "rank")) return target.rank;
  if (inferredElderFromClanMarkers(observer, target)) return 1;
  return null;
}

function knownRoleTo(observer, target) {
  if (observer.id === target.id || target.captured || hasPrivateIntel(observer, target)) return target;
  return null;
}

function isKnownAlly(observer, target) {
  const known = knownRoleTo(observer, target);
  return known ? known.clan === observer.clan : false;
}

function isKnownEnemyLeader(observer, target) {
  const known = knownRoleTo(observer, target);
  if (known) return known.clan !== observer.clan && isLeader(target);

  const inferred = inferredElderFromClanMarkers(observer, target);
  if (inferred) return inferred.enemy && inferred.currentLeader;

  const visibleClan = visibleClanTo(observer, target);
  const visibleRank = knownRankTo(observer, target);
  if (!visibleClan || visibleRank === null) return false;
  const leaderRank = state.leaderRule[visibleClan] === "highest" ? 3 : 1;
  return visibleClan !== observer.clan && visibleRank === leaderRank;
}

function inferredElderFromClanMarkers(observer, target) {
  const revealedClan = hasRevealed(target, "rose") ? "Rose" : hasRevealed(target, "beast") ? "Beast" : null;
  if (!revealedClan || state.players.length !== 6) return null;

  const clanMarkerRoles = ROLE_DECK.filter((role) =>
    role.markers.some((marker) => markerType(marker) === (revealedClan === "Rose" ? "rose" : "beast")),
  );
  const onlyElderHasClanMarkers = clanMarkerRoles.length > 0 && clanMarkerRoles.every((role) => role.rank === 1);
  if (!onlyElderHasClanMarkers) return null;

  const enemy = revealedClan !== observer.clan;
  const color = revealedClan === "Rose" ? "红色" : "蓝色";
  return {
    clan: revealedClan,
    rank: 1,
    enemy,
    currentLeader: state.leaderRule[revealedClan] === "lowest",
    reason: `当前1-3版型里，只有长老会公开${color}阵营标记，因此${target.name}高度指向${color}长老。`,
  };
}

function hasPrivateIntel(observer, target) {
  return privateIntelFor(observer).some((entry) => entry.targetId === target.id);
}

function privateIntelFor(player) {
  return state.privateIntel?.[player.id] || [];
}

function canSeeClue(observer, target) {
  return nextSeatId(observer.id) === target.id;
}

function clueTargetFor(observer) {
  return getPlayer(nextSeatId(observer.id));
}

function previousSeatFor(player) {
  return getPlayer(previousSeatId(player.id));
}

function nextSeatId(playerId) {
  return playerId === state.players.length ? 1 : playerId + 1;
}

function previousSeatId(playerId) {
  return playerId === 1 ? state.players.length : playerId - 1;
}

function clueClan(clue) {
  if (clue.includes("玫瑰")) return "Rose";
  if (clue.includes("野兽")) return "Beast";
  return null;
}

function clanName(clan) {
  return clan === "Rose" ? "玫瑰氏族" : "野兽氏族";
}

function clueProfileLine(player) {
  return `线索：${player.markers
    .filter((marker) => markerType(marker) !== "rank")
    .map((marker) => markerTemplate(marker, player))
    .join("")}`;
}

function visibleColorClueLine(player) {
  return `线索：${clueMarkerTemplate(player.clue)}`;
}

function clueMarkerTemplate(clue) {
  const clan = clueClan(clue);
  if (clan === "Rose") {
    return clanMarkerTemplate("Rose");
  }
  if (clan === "Beast") {
    return clanMarkerTemplate("Beast");
  }
  return `<span class="marker unknown">?</span>`;
}

function clanMarkerTemplate(clan) {
  const type = clan === "Rose" ? "rose" : "beast";
  const label = clan === "Rose" ? "玫瑰阵营" : "野兽阵营";
  return `<span class="marker ${type} marker-icon-only" title="${label}" aria-label="${label}">🌹</span>`;
}

function unknownMarkerTemplate() {
  return `<span class="marker unknown">?</span>`;
}

function playerColorText(player) {
  return colorTextFromClue(player.clue);
}

function colorTextFromClue(clue) {
  const clan = clueClan(clue);
  if (clan === "Rose") return "红色";
  if (clan === "Beast") return "蓝色";
  return "未知";
}

function getPlayer(playerId) {
  return state.players.find((player) => player.id === playerId);
}

function visibleLogs() {
  const publicLogs = state.publicLogs.map((entry) => ({ ...entry, private: false }));
  if (isGodView()) {
    const allPrivateLogs = Object.entries(state.privateLogs).flatMap(([playerId, entries]) =>
      entries.map((entry) => ({
        ...entry,
        text: `[私密: 玩家 ${playerId}] ${entry.text}`,
        private: true,
      })),
    );
    return [...publicLogs, ...allPrivateLogs].sort((left, right) => left.index - right.index);
  }
  if (!state.viewerId) return publicLogs;

  const privateLogs = (state.privateLogs[state.viewerId] || []).map((entry) => ({
    ...entry,
    text: `[私密] ${entry.text}`,
    private: true,
  }));
  return [...publicLogs, ...privateLogs].sort((left, right) => left.index - right.index);
}

function addLog(message) {
  state.publicLogs.push({ text: message, index: nextLogIndex() });
}

function addPrivateLog(playerId, message) {
  if (!state.privateLogs[playerId]) state.privateLogs[playerId] = [];
  state.privateLogs[playerId].push({ text: message, index: nextLogIndex() });
}

function addPrivateIntel(playerId, target) {
  if (!state.privateIntel) state.privateIntel = {};
  if (!state.privateIntel[playerId]) state.privateIntel[playerId] = [];
  if (state.privateIntel[playerId].some((entry) => entry.targetId === target.id)) return;
  state.privateIntel[playerId].push({
    targetId: target.id,
    clan: target.clan,
    rank: target.rank,
    role: target.role,
  });
}

function nextLogIndex() {
  state.logIndex = (state.logIndex || 0) + 1;
  return state.logIndex;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char];
  });
}

function stripHtml(value) {
  return String(value).replace(/<[^>]*>/g, "");
}

function createButton(label, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  return button;
}

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const randomIndex = randomInt(index + 1);
    [items[index], items[randomIndex]] = [items[randomIndex], items[index]];
  }
  return items;
}

function dealRoles() {
  let shuffled = shuffle([...ROLE_DECK]);
  for (let attempt = 0; attempt < 8 && dealSignature(shuffled) === state.lastDealSignature; attempt += 1) {
    shuffled = shuffle([...ROLE_DECK]);
  }
  return shuffled;
}

function dealSignature(roles) {
  return roles.map((role) => `${role.clan}-${role.rank}`).join("|");
}

function randomInt(maxExclusive) {
  if (globalThis.crypto?.getRandomValues) {
    const array = new Uint32Array(1);
    globalThis.crypto.getRandomValues(array);
    return array[0] % maxExclusive;
  }
  return Math.floor(Math.random() * maxExclusive);
}

function randomItem(items) {
  return items[randomInt(items.length)];
}

render();
