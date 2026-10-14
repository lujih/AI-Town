// AI 小镇 — UI 层
// 职责：HUD / 字幕条 / 全日志 / 抽屉（名册、聊天、经济、关系图、镇长）/ 气泡。
// 本模块只操作 DOM，不含模拟规则，也不 import three。
// 对外暴露 createUI(sim, hooks)。

const SPEECH_MS = 2800;

export function createUI(sim, hooks = {}) {
  const H = {
    onLocate: hooks.onLocate || (() => {}),
    onOpenChat: hooks.onOpenChat || (() => {}),
    onDraw: hooks.onDraw || (() => {}),
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const clockEl = $("clock"), dayLabelEl = $("daylabel");
  const tickerTrack = $("tickerTrack"), tickerLog = $("tickerLog"), tickerExpand = $("tickerExpand");
  const speechEl = $("speech");
  const drawer = $("drawer"), drawerTab = $("drawerTab"), drawerClose = $("drawerClose");
  const chatMeta = $("chatMeta"), chatLog = $("chatLog"), chatForm = $("chatForm"), chatInput = $("chatInput");
  const goalForm = $("goalForm"), goalInput = $("goalInput");
  const roster = $("roster");
  const totalGoldEl = $("totalGold"), fundEl = $("townFund");
  const shopCafeEl = $("shopCafe"), shopParkEl = $("shopPark"), shopMarketEl = $("shopMarket");
  const leaderboard = $("leaderboard"), rankMeta = $("rankMeta");
  const relationCanvas = $("relationCanvas");
  const relationEmpty = $("relationEmpty");
  const mayorPanel = $("mayorPanel"), mayorNameEl = $("mayorName");
  const eventBanner = $("eventBanner");
  const decorPicker = $("decorPicker");
  const placingHint = $("placingHint");
  const a11yLog = $("a11yLog");

  // ---------- 状态 ----------
  let events = [];              // 全量缓冲（最近 60 条）
  let tickerLogBody = null;
  let drawerOpen = false;
  let activeNpc = null;
  let placingDecor = null;      // A4：正在放置的装饰物 id
  let sayTimer = null;
  let typingTimer = null;
  let lastFocusBeforeDrawer = null;

  // 重大事件才播报给读屏器（新一天 / 小镇事件 / 重置），气泡是装饰性的
  function announce(text) { if (a11yLog) a11yLog.textContent = text; }

  // ---------- 事件 / 字幕条 ----------
  function addEvent(text, kind = "") {
    events.unshift({ time: sim.clockText(), text, kind });
    if (events.length > 60) events.pop();
    renderTicker();
    if (tickerLog.classList.contains("open")) renderLog();
    // 重大事件播报给读屏器
    if (kind === "day") announce(text);
  }

  // 字幕条：只更新文本，排头那条极轻落定（不滑入）
  function renderTicker() {
    const items = events.slice(0, 3);
    while (tickerTrack.children.length < 3) tickerTrack.appendChild(makeTickerItem(null));
    for (let i = 0; i < 3; i++) {
      const slot = tickerTrack.children[i];
      const e = items[i];
      if (!e) { slot.style.visibility = "hidden"; continue; }
      slot.style.visibility = "";
      const label = slot.lastElementChild;
      if (label.textContent !== e.text) {
        const fresh = i === 0 && slot.textContent.trim() !== "";
        label.textContent = e.text;
        slot.className = `ticker-item ${e.kind}${fresh ? " is-fresh" : ""}`;
      }
    }
  }

  function makeTickerItem(e) {
    const el = document.createElement("li");
    el.className = `ticker-item ${e ? e.kind : ""}`;
    const dot = document.createElement("i");
    dot.className = "dot";
    const label = document.createElement("span");
    if (e) label.textContent = e.text;
    el.appendChild(dot); el.appendChild(label);
    return el;
  }

  function renderLog() {
    if (!tickerLogBody) {
      tickerLogBody = document.createElement("ol");
      tickerLogBody.className = "log-body";
      tickerLog.appendChild(tickerLogBody);
    }
    tickerLogBody.innerHTML = "";
    for (const e of events) {
      const li = document.createElement("li");
      li.className = e.kind;
      const dot = document.createElement("i"); dot.className = "dot";
      const t = document.createElement("span"); t.className = "log-time"; t.textContent = e.time;
      const msg = document.createElement("span"); msg.textContent = e.text;
      li.append(dot, t, msg);
      tickerLogBody.appendChild(li);
    }
    tickerLogBody.scrollTop = 0;
  }

  tickerExpand.addEventListener("click", () => {
    const open = tickerLog.classList.toggle("open");
    tickerExpand.textContent = open ? "⌃" : "⌄";
    tickerExpand.setAttribute("aria-label", open ? "收起全部事件" : "展开全部事件");
    tickerExpand.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) renderLog();
  });

  // ---------- 气泡 ----------
  function say(npc, text) {
    speechEl.textContent = `${npc.name}：${text}`;
    const s = H.onDraw ? H.onDraw(npc) : null;
    if (s) {
      const elW = window.innerWidth, elH = window.innerHeight;
      speechEl.style.left = `${Math.max(140, Math.min(elW - 140, s.x))}px`;
      speechEl.style.top = `${Math.max(70, s.y - 64)}px`;
    }
    speechEl.classList.remove("hidden");
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => speechEl.classList.add("hidden"), SPEECH_MS);
    addEvent(`${npc.name} 说：${text}`, "speak");
  }

  // ---------- 首次引导 ----------
  const onboardEl = $("onboard"), onboardBtn = $("onboardBtn");
  const ONBOARD_KEY = "aitown_onboarded";
  function maybeShowOnboard() {
    let seen = false;
    try { seen = !!localStorage.getItem(ONBOARD_KEY); } catch (_) {}
    if (seen || !onboardEl) return;
    onboardEl.classList.remove("hidden");
  }
  function dismissOnboard() {
    if (!onboardEl) return;
    onboardEl.classList.add("hidden");
    try { localStorage.setItem(ONBOARD_KEY, "1"); } catch (_) {}
  }
  if (onboardBtn) onboardBtn.addEventListener("click", dismissOnboard);
  // 任何一次真实交互都算"进去看看"
  ["pointerdown", "keydown"].forEach((ev) =>
    window.addEventListener(ev, () => { if (onboardEl && !onboardEl.classList.contains("hidden")) dismissOnboard(); }, { once: true }));

  // ---------- 抽屉：Esc 关闭 + 焦点归还 ----------
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // 放置模式优先退出
    if (placingDecor) { clearPlacingDecor(); return; }
    if (drawerOpen) {
      setDrawer(false);
      if (lastFocusBeforeDrawer) lastFocusBeforeDrawer.focus();
    }
  });

  // ---------- 时钟 / 事件横幅 ----------
  function renderClock() {
    clockEl.textContent = sim.clockText();
    dayLabelEl.textContent = `第 ${sim.dayCount} 天`;
  }
  function renderEventBanner() {
    const ev = sim.activeEvent;
    // 变化检测：横幅每 tick 都被调用，没事件时不能反复 add/remove class，
    // 有事件时更不能每 tick innerHTML 重建（每秒 10 次的 DOM 浪费）。
    if (!ev) {
      if (!eventBanner.classList.contains("hidden")) eventBanner.classList.add("hidden");
      return;
    }
    const sig = ev.id + "|" + ev.name;
    if (eventBanner.dataset.sig === sig && !eventBanner.classList.contains("hidden")) return;
    eventBanner.dataset.sig = sig;
    eventBanner.classList.remove("hidden");
    eventBanner.innerHTML = "";
    const name = document.createElement("strong");
    name.textContent = ev.name;
    const desc = document.createElement("span");
    desc.textContent = ev.desc;
    eventBanner.append(name, desc);
  }

  // ---------- 抽屉 / Tab ----------
  function setDrawer(open) {
    if (open && !drawerOpen) lastFocusBeforeDrawer = document.activeElement;
    drawerOpen = open;
    document.body.classList.toggle("drawer-open", open);
    if (open) { renderRosterGold(); renderEconomy(); renderRelations(); renderMayor(); }
  }
  drawerTab.addEventListener("click", () => setDrawer(true));
  drawerClose.addEventListener("click", () => setDrawer(false));

  function switchTab(name) {
    document.querySelectorAll(".drawer .tab").forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".drawer .tab-pane").forEach((pn) => pn.classList.toggle("is-active", pn.dataset.pane === name));
    if (name === "chat") renderRosterGold();
    if (name === "economy") renderEconomy();
    if (name === "relations") renderRelations();
    if (name === "mayor") renderMayor();
  }
  document.querySelectorAll(".drawer-tabs .tab").forEach((b) =>
    b.addEventListener("click", () => switchTab(b.dataset.tab)));

  // ---------- 聊天 ----------
  function openChat(npc) {
    activeNpc = npc;
    sim.openChat(npc);
    chatMeta.textContent = `${npc.emoji} ${npc.name} · ${npc.personality.label} · ${npc.job}`;
    chatForm.classList.remove("hidden");
    goalForm.classList.remove("hidden");
    goalInput.value = npc.dailyGoal || "";
    goalInput.dataset.npc = npc.id;
    chatLog.innerHTML = "";
    addChatMsg("npc", `你好，我是${npc.name}，镇上${npc.job}。今天${sim.lightOf()}，要不要聊两句？`);
    setDrawer(true);
    switchTab("chat");
    highlightRoster(npc);
    chatLog.scrollTop = chatLog.scrollHeight;
    chatInput.focus();
    sim.mayorChat();
  }
  function closeChat() {
    if (activeNpc) sim.closeChat(activeNpc);
    activeNpc = null;
    chatMeta.textContent = "点击居民或名册开始对话";
    chatForm.classList.add("hidden");
    goalForm.classList.add("hidden");
    chatLog.innerHTML = "";
    unhighlightRoster();
  }
  function addChatMsg(role, text) {
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    div.textContent = text;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  // NPC 正在输入：发出消息后到回复前的空档给个反馈
  function showTyping() {
    hideTyping();
    const el = document.createElement("div");
    el.className = "typing";
    el.id = "typingIndicator";
    el.setAttribute("aria-label", "对方正在输入");
    el.innerHTML = "<i></i><i></i><i></i>";
    chatLog.appendChild(el);
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  function hideTyping() {
    const el = document.getElementById("typingIndicator");
    if (el) el.remove();
  }

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !activeNpc) return;
    chatInput.value = "";
    activeNpc.stats.chats++;
    sim.remember(activeNpc, "player", text);
    addChatMsg("user", text);
    activeNpc.chatOpen = true;
    const reply = sim.respond(activeNpc, text);
    const delay = 400 + Math.random() * 400;
    showTyping();
    typingTimer = setTimeout(() => {
      hideTyping();
      addChatMsg("npc", reply);
      say(activeNpc, reply);
    }, delay);
  });

  goalForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const npc = sim.npcs[Number(goalInput.dataset.npc)];
    if (!npc) return;
    const text = goalInput.value.trim();
    if (!text) {
      npc.dailyGoal = null; npc.goalBoost = null;
      addEvent(`${npc.name} 的目标清空了`, "day");
      return;
    }
    sim.parseGoal(npc, text);
    sim.mayorGoal();
    addEvent(`${npc.name} 的新目标：${text}`, "day");
    addChatMsg("npc", `收到，我今天就按这个方向来：「${text}」。`);
    goalInput.value = npc.dailyGoal;
  });

  // ---------- 名册 ----------
  function buildRoster() {
    roster.innerHTML = "";
    for (const n of sim.npcs) {
      const li = document.createElement("li");
      li.tabIndex = 0;
      li.dataset.id = n.id;
      const avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.style.background = n.personality.color;
      avatar.textContent = n.emoji;
      const nm = document.createElement("div");
      const nameEl = document.createElement("div");
      nameEl.className = "r-name"; nameEl.textContent = n.name;
      const typeEl = document.createElement("div");
      typeEl.className = "r-type"; typeEl.textContent = `${n.job} · ${n.personality.label}`;
      nm.append(nameEl, typeEl);
      // B1：三轴性格倾向条
      nm.appendChild(buildTraits(n));
      const gold = document.createElement("span");
      gold.className = "r-gold"; gold.dataset.npc = n.id; gold.textContent = `${n.gold} 金`;
      li.append(avatar, nm, gold);
      li.addEventListener("click", () => { openChat(n); H.onLocate(n); });
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openChat(n); H.onLocate(n); }
        // 方向键在名册里导航
        else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const items = [...roster.querySelectorAll("li")];
          const i = items.indexOf(li);
          const next = items[e.key === "ArrowDown" ? i + 1 : i - 1];
          if (next) next.focus();
        }
      });
      roster.appendChild(li);
    }
  }

  const TRAIT_COLORS = { sociability: "#ffd97a", frugality: "#7ee0a0", curiosity: "#ffb347" };
  function buildTraits(n) {
    const wrap = document.createElement("div");
    wrap.className = "traits";
    for (const [key, v] of Object.entries(n.traits)) {
      const meta = sim.TRAIT_META[key];
      if (!meta) continue;
      const row = document.createElement("div");
      row.className = "trait-row";
      const label = document.createElement("span");
      label.className = "trait-label"; label.textContent = meta.label;
      const bar = document.createElement("span");
      bar.className = "trait-bar";
      const fill = document.createElement("i");
      fill.className = "trait-fill";
      fill.style.width = `${Math.round(v * 100)}%`;
      fill.style.background = TRAIT_COLORS[key] || "var(--accent)";
      fill.dataset.trait = key;
      bar.appendChild(fill);
      row.append(label, bar);
      wrap.appendChild(row);
    }
    return wrap;
  }

  // B1：随性格漂移更新名册上的条（每秒一次足够，省开销）
  function renderRosterTraits() {
    roster.querySelectorAll("li").forEach((li) => {
      const n = sim.npcs[Number(li.dataset.id)];
      if (!n) return;
      li.querySelectorAll(".trait-fill").forEach((fill) => {
        const v = n.traits[fill.dataset.trait];
        if (v !== undefined) fill.style.width = `${Math.round(v * 100)}%`;
      });
    });
  }
  function renderRosterGold() {
    roster.querySelectorAll(".r-gold").forEach((el) => {
      const n = sim.npcs[Number(el.dataset.npc)];
      if (n) el.textContent = `${n.gold} 金`;
    });
  }
  function highlightRoster(npc) {
    roster.querySelectorAll("li").forEach((li) =>
      li.classList.toggle("is-chatted", Number(li.dataset.id) === npc.id));
  }
  function unhighlightRoster() {
    roster.querySelectorAll("li").forEach((li) => li.classList.remove("is-chatted"));
  }

  // ---------- 经济 ----------
  function renderEconomy() {
    totalGoldEl.textContent = sim.townFunds();
    if (fundEl) fundEl.textContent = sim.townFunds();
    const cafe = sim.POIS[0], park = sim.POIS[2], market = sim.POIS[5];
    shopCafeEl.textContent = `${cafe.stock} 份 · ${cafe.price}金`;
    shopParkEl.textContent = `${park.stock} 份 · ${park.price}金`;
    shopMarketEl.textContent = `${market.stock} 份 · ${market.price}金`;
    renderLeaderboard();
  }
  function renderLeaderboard() {
    const ranked = sim.npcs.map((n) => ({ n, score: sim.npcScore(n) })).sort((a, b) => b.score - a.score);
    leaderboard.innerHTML = "";
    ranked.forEach((row, i) => {
      const li = document.createElement("li");
      li.className = "lb-item";
      const rank = document.createElement("span");
      rank.className = "lb-rank"; rank.textContent = i + 1;
      const avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.style.background = row.n.personality.color;
      avatar.textContent = row.n.emoji;
      const name = document.createElement("span");
      name.className = "lb-name"; name.textContent = `${row.n.name} · ${row.n.job}`;
      const score = document.createElement("span");
      score.className = "lb-score"; score.textContent = `${row.score} 分`;
      li.append(rank, avatar, name, score);
      li.addEventListener("click", () => { openChat(row.n); H.onLocate(row.n); });
      leaderboard.appendChild(li);
    });
    const top = ranked[0];
    rankMeta.textContent = top ? `今日最活跃：${top.n.name}（${top.score} 分）` : "";
  }

  // ---------- B4 关系网络 ----------
  function renderRelations() {
    const cv = relationCanvas;
    if (!cv) return;
    // 空状态：还没有任何偶遇时，画布是空的，用文案说明原因
    let hasAny = false;
    for (const a of Object.values(sim.relations))
      for (const r of Object.values(a)) if (r.count > 0) hasAny = true;
    if (!hasAny) {
      cv.classList.add("hidden");
      if (relationEmpty) relationEmpty.classList.remove("hidden");
      return;
    }
    cv.classList.remove("hidden");
    if (relationEmpty) relationEmpty.classList.add("hidden");

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const c = cv.getContext("2d");
    c.scale(dpr, dpr);
    c.clearRect(0, 0, w, h);

    const nodes = sim.npcs.map((n, i) => ({
      n, x: w / 2 + Math.cos((i / sim.npcs.length) * Math.PI * 2) * (w / 2 - 34),
      y: h / 2 + Math.sin((i / sim.npcs.length) * Math.PI * 2) * (h / 2 - 34),
    }));
    const byId = Object.fromEntries(nodes.map((nd) => [nd.n.id, nd]));

    // 连线：线宽=交互次数，颜色=友好/摩擦
    for (const a of sim.npcs) {
      for (const b of sim.npcs) {
        if (a.id >= b.id) continue;
        const r = sim.relations[a.id]?.[b.id];
        if (!r || r.count === 0) continue;
        const A = byId[a.id], B = byId[b.id];
        if (!A || !B) continue;
        c.lineWidth = Math.min(4, 1 + r.count * 0.4);
        c.strokeStyle = r.friend >= r.friction
          ? `rgba(126,224,160,${Math.min(0.85, 0.3 + r.friend * 0.15)})`
          : `rgba(255,140,120,${Math.min(0.85, 0.3 + r.friction * 0.15)})`;
        c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(B.x, B.y); c.stroke();
        if (r.count > 1) {
          const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
          c.fillStyle = "rgba(232,236,255,0.75)";
          c.font = "10px system-ui";
          c.textAlign = "center"; c.textBaseline = "middle";
          c.fillText(String(r.count), mx, my);
        }
      }
    }
    // 节点
    for (const nd of nodes) {
      c.beginPath(); c.arc(nd.x, nd.y, 13, 0, Math.PI * 2);
      c.fillStyle = nd.n.personality.color; c.fill();
      c.lineWidth = 2; c.strokeStyle = "rgba(232,236,255,0.85)"; c.stroke();
      c.fillStyle = "#0d1330";
      c.font = "11px system-ui"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(nd.n.name, nd.x, nd.y + 24);
      // 交互次数角标
      const total = Object.values(sim.relations[nd.n.id] || {}).reduce((s, r) => s + r.count, 0);
      if (total > 0) {
        c.beginPath(); c.arc(nd.x + 10, nd.y - 10, 7, 0, Math.PI * 2);
        c.fillStyle = "#ffb347"; c.fill();
        c.fillStyle = "#1a1408";
        c.font = "9px system-ui";
        c.fillText(String(total), nd.x + 10, nd.y - 10);
      }
    }
    // 图例
    c.textAlign = "left"; c.textBaseline = "top";
    c.font = "11px system-ui";
    c.fillStyle = "rgba(126,224,160,0.9)"; c.fillText("— 友好", 8, 8);
    c.fillStyle = "rgba(255,140,120,0.9)"; c.fillText("— 摩擦", 60, 8);
    c.fillStyle = "rgba(139,148,194,0.9)"; c.fillText("数字 = 交互次数", 8, h - 18);
  }

  // ---------- A3 镇长面板 ----------
  function renderMayor() {
    const m = sim.mayor;
    if (!m) { mayorPanel.classList.add("hidden"); return; }
    mayorPanel.classList.remove("hidden");
    mayorNameEl.textContent = `${m.name} · 任期第 ${sim.dayCount - m.since + 1} 天`;
    const stats = [
      ["聊天次数", m.chats],
      ["设定目标", m.goals],
      ["见证时刻", m.seen],
      ["装饰放置", sim.decors.length],
    ];
    mayorPanel.querySelectorAll("[data-stat]").forEach((el) => {
      const found = stats.find(([k]) => k === el.dataset.stat);
      if (found) el.textContent = found[1];
    });
  }
  // 镇长命名：内联小窗，不用 prompt()——原生弹窗会阻塞主线程并打断动效
  function promptMayorName() {
    if (sim.mayor) return;
    const existing = document.getElementById("mayorAsk");
    if (existing) return;
    const box = document.createElement("div");
    box.className = "onboard";
    box.id = "mayorAsk";
    box.style.maxWidth = "min(84vw, 320px)";
    box.innerHTML = `
      <h2 class="onboard-title" style="font-size: var(--t-body); margin-bottom: var(--sp-2);">这个小镇要怎么称呼你？</h2>
      <input id="mayorNameInput" type="text" maxlength="12" placeholder="镇长名字（可留空跳过）"
             style="width:100%; padding:var(--sp-2) var(--sp-3); background:var(--panel-2);
                    border:1px solid var(--line-strong); border-radius:var(--r-box);
                    color:var(--ink); font-size:var(--t-ui); font-family:var(--font-body);" />
      <div style="display:flex; gap:var(--sp-2); justify-content:flex-end; margin-top:var(--sp-4);">
        <button class="onboard-btn" id="mayorSkip"
                style="background:transparent; color:var(--ink-dim); border:1px solid var(--line-strong);">跳过</button>
        <button class="onboard-btn" id="mayorOk">就叫这个</button>
      </div>`;
    document.getElementById("stage").appendChild(box);
    const input = document.getElementById("mayorNameInput");
    const finish = (useName) => {
      const v = (input.value || "").trim();
      if (useName && v) sim.setMayorName(v);
      box.remove();
    };
    document.getElementById("mayorOk").addEventListener("click", () => finish(true));
    document.getElementById("mayorSkip").addEventListener("click", () => finish(false));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    if (input.focus) input.focus();
  }

  // ---------- A4 装饰放置 ----------
  function buildDecorPicker() {
    decorPicker.innerHTML = "";
    for (const d of sim.DECOR_TYPES) {
      const btn = document.createElement("button");
      btn.className = "decor-btn";
      btn.dataset.decor = d.id;
      btn.innerHTML = `<span class="decor-name">${d.name}</span><span class="decor-cost">${d.cost} 金</span>`;
      btn.addEventListener("click", () => {
        placingDecor = placingDecor === d.id ? null : d.id;
        decorPicker.querySelectorAll(".decor-btn").forEach((b) =>
          b.classList.toggle("is-placing", b.dataset.decor === placingDecor));
        addEvent(placingDecor ? `选择放置点：${d.name}（点击地面空地）` : "取消放置", "day");
        if (placingHint) placingHint.classList.toggle("hidden", !placingDecor);
      });
      decorPicker.appendChild(btn);
    }
  }
  function getPlacingDecor() { return placingDecor; }
  function clearPlacingDecor() {
    placingDecor = null;
    decorPicker.querySelectorAll(".decor-btn").forEach((b) => b.classList.remove("is-placing"));
    if (placingHint) placingHint.classList.add("hidden");
  }

  // ---------- HUD 控制 ----------
  const pauseBtn = $("pauseBtn"), speedBtn = $("speedBtn"), resetBtn = $("resetBtn");
  function renderControls() {
    pauseBtn.textContent = sim.paused ? "▶" : "⏸";
    pauseBtn.setAttribute("aria-label", sim.paused ? "继续" : "暂停");
    speedBtn.textContent = `${sim.speed}x`;
  }
  pauseBtn.addEventListener("click", () => { sim.togglePaused(); renderControls(); });
  speedBtn.addEventListener("click", () => { sim.cycleSpeed(); renderControls(); });
  resetBtn.addEventListener("click", () => {
    if (!confirm("重置小镇？NPC 状态、金币、库存将还原到初始，装饰与关系也会清空。")) return;
    sim.reset();
    sim.newWorld();
    events = [];
    if (tickerLogBody) tickerLogBody.innerHTML = "";
    closeChat();
    clearPlacingDecor();
    renderTicker(); renderEconomy(); renderRelations(); renderMayor(); renderClock(); renderControls();
    addEvent("小镇已重置", "day");
    H.onDraw && H.onDraw();
  });

  // ---------- 对外 ----------
  return {
    addEvent, say, announce, renderClock, renderEventBanner, renderTicker,
    renderEconomy, renderRelations, renderMayor, renderControls,
    buildRoster, renderRosterGold, renderRosterTraits, buildDecorPicker,
    openChat, closeChat, switchTab, setDrawer, promptMayorName,
    getPlacingDecor, clearPlacingDecor,
    maybeShowOnboard, dismissOnboard,
    hideTyping,
    get activeNpc() { return activeNpc; },
    renderAll() {
      renderClock(); renderEventBanner(); renderTicker(); renderEconomy();
      renderRelations(); renderMayor(); renderControls(); renderRosterGold();
      renderRosterTraits();
    },
  };
}
