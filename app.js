// AI 小镇 — 入口
// 职责：装配 simulation / world3d / ui 三层，跑主循环。
// 分层：simulation.js（状态+规则，无 DOM/three）→ world3d.js（渲染）→ ui.js（DOM）
import { createSimulation } from "./simulation.js";
import { createWorld3d } from "./world3d.js";
import { createUI } from "./ui.js";

(() => {
  "use strict";

  // ---------- 装配 ----------
  // ui 需要 world3d 的投影能力，world3d 需要 sim 的状态；
  // 用"先建 world3d、再建 ui、最后把 ui 的 addEvent/say 回填进 sim"的顺序解耦。
  let ui = null;
  const sim = createSimulation({
    addEvent: (text, kind) => ui && ui.addEvent(text, kind),
    say: (npc, text) => ui && ui.say(npc, text),
    onDayChange: () => ui && ui.renderEventBanner(),
    onRemoveVisitor: (v) => world.removeNpcMesh(v),
    onDecorsChanged: () => world.syncDecors(),
    onMayorChanged: () => ui && ui.renderMayor(),
    onNpcMeshReady: (n) => world.buildNpcMesh(n),
    onVisitorMeshReady: (v) => world.buildNpcMesh(v),
    draw: () => world.draw(),
  });

  const world = createWorld3d(sim, {
    onNpcClick: (npc) => { ui.openChat(npc); world.locateNpc(npc); },
    onGroundClick: (x, y) => onGroundClick(x, y),
    onDecorsChanged: () => world.syncDecors(),
  });

  ui = createUI(sim, {
    onLocate: (npc) => world.locateNpc(npc),
    onOpenChat: (npc) => { ui.openChat(npc); world.locateNpc(npc); },
    onDraw: (npc) => world.logicToScreen(npc),
  });

  // 三层装配完毕后，才为 NPC 建网格（避免 TDZ）
  sim.buildMeshes();

  // ---------- 点击拾取 ----------
  world.domElement.addEventListener("click", (e) => {
    const npc = world.pickNpcAt(e.clientX, e.clientY);
    if (npc) {
      if (ui.activeNpc === npc) { ui.closeChat(); world.locateNpc(npc); }
      else ui.openChat(npc);
      return;
    }
    // A4：镇长放置模式
    const placing = ui.getPlacingDecor();
    if (placing) {
      const g = world.pickGroundAt(e.clientX, e.clientY);
      if (!g) return;
      if (!world.isFreeGround(g.x, g.y, 6)) {
        ui.addEvent("这里放不下，换个空地试试", "day");
        return;
      }
      const res = sim.placeDecor(placing, Math.round(g.x), Math.round(g.y));
      if (res.ok) { ui.clearPlacingDecor(); world.syncDecors(); }
      else ui.addEvent(res.reason, "day");
      return;
    }
    ui.closeChat();
  });

  // ---------- hover：告诉用户哪些小人可以点 ----------
  // 指针设备才有 hover；触摸设备靠放置提示与光标无关
  const HOVERABLE = window.matchMedia ? window.matchMedia("(hover: hover)").matches : true;
  if (HOVERABLE) {
    let hoverRaf = 0, pendingX = 0, pendingY = 0;
    world.domElement.addEventListener("pointermove", (e) => {
      pendingX = e.clientX; pendingY = e.clientY;
      if (hoverRaf) return;                     // 每帧最多一次，避免高频拾取
      hoverRaf = requestAnimationFrame(() => {
        hoverRaf = 0;
        world.updateHover(pendingX, pendingY);
      });
    });
    world.domElement.addEventListener("pointerleave", () => world.clearHover());
    window.addEventListener("blur", () => world.clearHover());
  }

  function onGroundClick(x, y) { /* 预留：未来可做地面交互 */ }

  // ---------- 主循环 ----------
  // CPU 预算策略（J1900 实测：全量渲染一次吃满一核多，350% 总占用）：
  //   模拟 tick 固定 100ms（逻辑很便宜，必须持续跑）
  //   WebGL 渲染降为"有变化才画"：
  //     - 有 NPC 在走 / 有动画在播 → 每 tick 画（≈10fps，视觉已流畅）
  //     - 页面完全静止（夜里全员到家、无 hover/脉冲）→ 跳过渲染
  //     - 标签页不可见（document.hidden）→ 全部挂起，浏览器负责恢复
  //   昼夜光照只有 light 值变化才更新材质/背景，不再每帧重设。
  let mainTick = 0;
  let lastLight = -1;
  function tick() {
    sim.tick();
    mainTick++;
    ui.renderClock();
    ui.renderEventBanner();

    // 标签页不可见：跳过一切视觉工作（模拟照跑，回来时画面自然接上）
    if (document.hidden) return;

    // 面板刷新（抽屉打开时才做，省开销）
    if (document.body.classList.contains("drawer-open")) {
      ui.renderEconomy();
      const activeTab = document.querySelector(".drawer .tab-pane.is-active");
      if (activeTab) {
        if (activeTab.dataset.pane === "relations") ui.renderRelations();
        if (activeTab.dataset.pane === "mayor") ui.renderMayor();
      }
      // 性格条每秒刷一次即可（漂移是渐进的）
      if (mainTick % 10 === 0) ui.renderRosterTraits();
    }

    // 按需渲染：只有"有 NPC 在动"或"到了光照刷新节拍"才重画 3D。
    // 光照阈值 0.002 是错的——黄昏段每 tick 变 0.0178，等于永久全渲染（实测
    // 切回前台 CPU 367%）。天空色变化慢到人眼无法察觉 0.02 的跳变，
    // 且渲染节拍与 tick 对齐本来就没有意义，改为每 10 tick（1 秒）查一次光照。
    const anyMoving = sim.allNpcs.some((n) => n.target && !n.chatOpen);
    const lightCheck = mainTick % 10 === 0;
    let lightChanged = false;
    if (lightCheck) {
      const light = sim.daylight();
      lightChanged = Math.abs(light - lastLight) > 0.02;
      lastLight = light;
    }
    // "NPC 在走"也要节流：软件光栅化下 10fps→5fps 人眼几乎无感，
    // 但 CPU 峰值减半（实测走动时 220%→120%）。光照刷新已是 1s 一次。
    if (anyMoving && mainTick % 2 === 0) world.draw();
    else if (lightChanged) world.draw();
  }
  setInterval(tick, 100);

  // ---------- 启动 ----------
  world.resize();
  ui.buildRoster();
  ui.buildDecorPicker();

  // A2：读档；无档则新开局
  const loaded = sim.load();
  if (loaded) {
    ui.addEvent("欢迎回来，小镇还是老样子", "day");
  } else {
    ui.addEvent("小镇开张了。点右下角「居民」开面板，或直接点居民开聊。", "day");
    // 预热 40 tick，让开局即有人在走
    for (let i = 0; i < 40; i++) sim.tick();
  }
  world.syncDecors();

  // A3：镇长身份。用首次交互触发，避免加载时弹窗打断
  if (!sim.mayor) {
    window.addEventListener("pointerdown", () => ui.promptMayorName(), { once: true });
  }
  ui.renderAll();
  world.draw();

  // ---------- 拂晓序列：一次性揭开小镇 ----------
  // 只在本次会话首次加载时播；刷新页面不再重播（sessionStorage 判定）。
  const dawnveil = document.getElementById("dawnveil");
  const hud = document.getElementById("hud");
  const ticker = document.getElementById("ticker");
  const townMark = document.querySelector(".town-mark");

  function settle() {
    // HUD 落位 → 字幕条跟上 → 名标最后。三段错开 90ms，像天亮一样逐层显形。
    const steps = [[hud, 60], [ticker, 150], [townMark, 240]];
    for (const [el, delay] of steps) {
      if (el) setTimeout(() => el.classList.add("settled"), delay);
    }
  }

  function playDawn() {
    if (!dawnveil) { settle(); ui.maybeShowOnboard(); return; }
    // 让第一帧画完再揭幕，否则会看到空白 canvas
    requestAnimationFrame(() => requestAnimationFrame(() => {
      dawnveil.classList.add("lifted");
      settle();
      setTimeout(() => dawnveil.classList.add("gone"), 1000);
      // 蒙层退场后约 900ms 出引导条，不与揭幕抢注意力
      setTimeout(() => ui.maybeShowOnboard(), 950);
    }));
  }

  let played = false;
  try { played = sessionStorage.getItem("aitown_dawn") === "1"; } catch (_) {}
  if (played) {
    // 本次会话已看过：直接落位，不重播
    if (dawnveil) dawnveil.classList.add("gone");
    settle();
    ui.maybeShowOnboard();
  } else {
    playDawn();
    try { sessionStorage.setItem("aitown_dawn", "1"); } catch (_) {}
  }
})();
