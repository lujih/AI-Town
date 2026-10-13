// AI 小镇 — 模拟层
// 职责：世界状态（时间 / POI / NPC / 镇长）+ 全部模拟规则。
// 本模块不 import three，也不碰 DOM，可独立测试。
// 对外暴露 createSimulation(hooks)，hooks 提供 UI 侧能力（事件、气泡、存档等）。

// ---------- 常量 ----------
const DAY_LENGTH = 2400;          // 一天 = 2400 游戏分钟
const MINUTES_PER_TICK = 4;
const TICK_MS = 100;
const STAY_TICKS = 12;            // 到店停留（tick）
const LONG_STAY_FACTOR = 6;
const LONG_STAY_CHANCE = 0.15;
const GOLD_CAP = 999;
const DAILY_ALLOWANCE = 20;
const RESTOCK_INTERVAL_MIN = 120; // 每 2 游戏小时补货一次
const RESTOCK_AMOUNT = 3;
const SAVE_KEY = "aitown_save_v2";
const SPEED_KEY = "aitown_speed";

// ---------- 静态数据 ----------
// POI：仅保留模拟需要的字段（3D 配色由 world3d 的 ROOF_STYLE 接管）
const POIS = [
  { id: "cafe", name: "咖啡馆", x: 70, y: 90, w: 150, h: 110, price: 30, stock: 50 },
  { id: "lib", name: "图书馆", x: 700, y: 80, w: 150, h: 110, price: 0, stock: 0 },
  { id: "park", name: "公园", x: 350, y: 380, w: 200, h: 130, price: 10, stock: 30 },
  { id: "home1", name: "小住宅", x: 90, y: 400, w: 130, h: 90, price: 0, stock: 0 },
  { id: "home2", name: "公寓", x: 640, y: 380, w: 150, h: 110, price: 0, stock: 0 },
  { id: "market", name: "集市", x: 380, y: 70, w: 180, h: 120, price: 20, stock: 40 },
];
// price=0 的 POI（lib/home1/home2）取 0 仅作兜底，restock 会跳过它们
const POI_INITIAL_STOCK = { cafe: 50, lib: 0, park: 30, home1: 0, home2: 0, market: 40 };

const NAMES = ["小北", "阿澈", "柚子", "老周", "林可", "豆豆", "阿凯", "苏苏"];
const JOBS = ["咖啡师", "图书管理员", "园艺师", "矿工", "记者", "快递员", "店主", "学生"];
const START_POINTS = [
  { x: 150, y: 450 }, { x: 700, y: 430 }, { x: 450, y: 130 }, { x: 430, y: 420 },
  { x: 470, y: 410 }, { x: 140, y: 150 }, { x: 690, y: 140 }, { x: 420, y: 430 },
];
const EMOJIS = ["🙂", "😄", "😎", "🤓"];

const PERSONALITIES = [
  { key: "saver", label: "节俭型", color: "#4ade80",
    likes: ["公园"], dislikes: ["咖啡馆"],
    chat: ["又存了点钱，感觉生活很踏实。", "今天没去咖啡馆，省下的咖啡钱够买一周的面包了。", "公园的椅子很便宜，坐着看云也很舒服。"] },
  { key: "social", label: "社交型", color: "#38bdf8",
    likes: ["咖啡馆", "集市"], dislikes: ["图书馆"],
    chat: ["刚才在咖啡馆认识了一个新邻居，聊得超开心！", "集市上那家水果铺今天人好多，下次一起去？", "我话多吗？我觉得小镇上大家都挺爱聊天的。"] },
  { key: "nerd", label: "学术型", color: "#c084fc",
    likes: ["图书馆"], dislikes: ["集市"],
    chat: ["新读到一本书，讲小镇经济循环的，很有意思。", "今天花 30 金币买了杯咖啡，但我觉得图书馆更值。", "你信玄学吗？我最近在读一本关于概率的书。"] },
  { key: "adventurer", label: "冒险型", color: "#fb923c",
    likes: ["集市", "公园"], dislikes: ["小住宅"],
    chat: ["今天去了集市最北边，看到了一家新开的面包房！", "冒险不是去哪，是愿意多走一步。", "今晚在公园散步的时候看到一只猫，超可爱。"] },
];

// B1：性格三轴。初始值由 personality 决定，之后随行为漂移。
const TRAIT_SEED = {
  saver:      { sociability: 0.30, frugality: 0.85, curiosity: 0.45 },
  social:     { sociability: 0.85, frugality: 0.35, curiosity: 0.55 },
  nerd:       { sociability: 0.35, frugality: 0.55, curiosity: 0.90 },
  adventurer: { sociability: 0.60, frugality: 0.45, curiosity: 0.95 },
};
const TRAIT_META = {
  sociability: { label: "社交", color: "var(--speech)" },
  frugality:   { label: "节俭", color: "var(--money)" },
  curiosity:   { label: "好奇", color: "var(--accent)" },
};
const TRAIT_MAP = { social: "sociability", buy: "frugality", arrive: "curiosity" };

// B3：随机小镇事件。apply 必须真的改数值/概率，不能只弹日志。
const TOWN_EVENTS = [
  { id: "market_day", name: "集市大集", desc: "集市备货充足，大家买东西更勤了",
    durationH: 6,
    apply(sim) { sim.modifiers.marketBias = 1.6; sim.modifiers.spendBoost = 1.3; } },
  { id: "rain", name: "下雨了", desc: "户外冷清，咖啡馆坐满了人",
    durationH: 4,
    apply(sim) { sim.modifiers.outdoorAvoid = 1; sim.modifiers.cafeBias = 2.0; } },
  { id: "festival", name: "小镇节日", desc: "全员涌向公园，今天不谈钱",
    durationH: 5,
    apply(sim) { sim.modifiers.parkBias = 3.0; sim.modifiers.spendBoost = 0.3; } },
  { id: "visitor", name: "远方来客", desc: "一位陌生旅人在镇上巡游一天",
    durationH: 24, once: true,
    apply(sim) { sim.spawnVisitor(); } },
];

// A4：镇长可放置的装饰物
const DECOR_TYPES = [
  { id: "flower", name: "花坛", cost: 60, build: "flower" },
  { id: "bench", name: "长椅", cost: 100, build: "bench" },
  { id: "lamp", name: "路灯", cost: 150, build: "lamp" },
  { id: "fountain", name: "喷泉", cost: 300, build: "fountain" },
  { id: "statue", name: "雕像", cost: 500, build: "statue" },
];

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const clampSpeed = (s) => (s === 2 || s === 4 ? s : 1);
const randomFrom = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------- 模拟工厂 ----------
export function createSimulation(hooks = {}) {
  const H = {
    addEvent: hooks.addEvent || (() => {}),
    say: hooks.say || (() => {}),
    onDayChange: hooks.onDayChange || (() => {}),
    onRemoveVisitor: hooks.onRemoveVisitor || (() => {}),
    onDecorsChanged: hooks.onDecorsChanged || (() => {}),
    onNpcMeshReady: hooks.onNpcMeshReady || (() => {}),
    onVisitorMeshReady: hooks.onVisitorMeshReady || (() => {}),
    onMayorChanged: hooks.onMayorChanged || (() => {}),
    draw: hooks.draw || (() => {}),
  };

  // ---------- 世界时间 ----------
  let gameTime = 9 * 60;
  let dayCount = 1;
  let paused = false;
  let speed = clampSpeed(Number(safeStorage("get", SPEED_KEY)) || 1);

  // ---------- 镇长 ----------
  let mayor = null;   // { name, since: dayCount, chats: 0, goals: 0, seen: 0 }

  // ---------- NPC ----------
  let npcs = [];
  const visitorPool = [];
  let activeVisitor = null;

  // ---------- 关系网络（A1 产物，B4 消费）----------
  // relations[aId][bId] = { count, friend, friction }
  let relations = {};

  // ---------- 世界修饰物（A4）----------
  let decors = [];

  // ---------- 事件修饰符（B3）----------
  let modifiers = { marketBias: 1, cafeBias: 1, parkBias: 1, spendBoost: 1, outdoorAvoid: 0 };
  let activeEvent = null;   // { id, name, desc, endsAt }

  function safeStorage(op, key, val) {
    try { return op === "get" ? localStorage.getItem(key) : localStorage.setItem(key, val); }
    catch (_) { return null; }
  }

  function makeNpc(i, isVisitor = false) {
    const p = PERSONALITIES[i % PERSONALITIES.length];
    const seed = TRAIT_SEED[p.key];
    const base = {
      id: i, name: NAMES[i % NAMES.length], personality: p,
      job: JOBS[i % JOBS.length],
      x: START_POINTS[i % START_POINTS.length].x,
      y: START_POINTS[i % START_POINTS.length].y,
      target: null, speed: 1.5 + Math.random() * 1.5,
      gold: 50 + Math.floor(Math.random() * 80),
      home: POIS[i % 2 === 0 ? 3 : 4],
      stayTicks: 0,
      emoji: EMOJIS[i % EMOJIS.length],
      chatOpen: false, chatLines: p.chat,
      dailyGoal: null, goalBoost: null,
      // B1 动态性格
      traits: { ...seed },
      // B2 记忆（跨天不清空）
      memory: [],
      // 镇长好感
      mayorFavor: 0,
      stats: { spend: 0, social: 0, chats: 0, arrived: 0 },
      isVisitor: isVisitor,
    };
    return base;
  }

  function initNpcs() {
    npcs = NAMES.map((_, i) => makeNpc(i));
    // 不在这里建网格：渲染层尚未装配，由调用方在建好 world 后调 buildMeshes()
  }

  // 渲染层装配完成后调用：为每个 NPC 建网格
  function buildMeshes() {
    for (const n of npcs) H.onNpcMeshReady(n);
  }

  // ---------- B1 性格漂移 ----------
  function drift(npc, kind, delta) {
    const key = TRAIT_MAP[kind];
    if (!key) return;
    // 带衰减的指数移动平均：单次行为影响小，长期趋势明显
    npc.traits[key] = clamp01(npc.traits[key] * 0.97 + (npc.traits[key] + delta) * 0.03);
  }

  // ---------- B2 记忆 ----------
  function remember(npc, from, text) {
    npc.memory.push({ day: dayCount, from, text });
    if (npc.memory.length > 12) npc.memory.shift();
  }
  function recall(npc, n = 3) { return npc.memory.slice(-n); }

  // ---------- A1 NPC 偶遇 ----------
  const MEET_RANGE = 32;          // 逻辑单位
  const MEET_COOLDOWN = 90;       // tick，避免同一对反复触发
  const now = () => tickCount;    // 用 tick 数而非墙上时钟，保证确定性
  function tryMeet() {
    for (let i = 0; i < npcs.length; i++) {
      for (let j = i + 1; j < npcs.length; j++) {
        const a = npcs[i], b = npcs[j];
        if (a.chatOpen || b.chatOpen) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > MEET_RANGE) continue;
        if (now() - (relations[a.id]?.[b.id]?.lastAt || -1e9) < MEET_COOLDOWN) continue;
        meet(a, b);
      }
    }
  }

  function meet(a, b) {
    const rel = (relations[a.id] ??= {});
    const r = (rel[b.id] ??= { count: 0, friend: 0, friction: 0, lastAt: -1e9 });
    r.count++; r.lastAt = now();

    const aSoc = a.traits.sociability, bSoc = b.traits.sociability;
    const compatible = !a.personality.dislikes.includes(b.personality.likes[0])
                    && !b.personality.dislikes.includes(a.personality.likes[0]);
    const friendly = compatible && Math.random() < 0.35 + (aSoc + bSoc) * 0.3;

    if (friendly) {
      r.friend++;
      a.stats.social++; b.stats.social++;
      drift(a, "social", 0.25); drift(b, "social", 0.25);
      const topic = pickMeetingTopic(a, b);
      H.say(a, topic.a); H.say(b, topic.b);
      H.addEvent(`${a.name} 和 ${b.name} 在${poiNameNear(a)}聊了起来`, "speak");
      remember(a, b.name, `和${b.name}聊了天`);
      remember(b, a.name, `和${a.name}聊了天`);
    } else {
      r.friction++;
      H.addEvent(`${a.name} 和 ${b.name} 擦肩而过，没搭上话`, "move");
    }
  }

  function pickMeetingTopic(a, b) {
    const topics = [
      { a: `嘿，${b.name}，你也在这儿。`, b: `是啊，${a.name}，真巧。` },
      { a: `${b.name}，听说你今天目标是「${b.dailyGoal || "随便逛逛"}」？`, b: "嗯，随便走走。你呢？" },
      { a: `我最近在${poiNameNear(a)}花了点钱。`, b: "我倒是攒着，舍不得花。" },
    ];
    // 若一方有目标，优先聊目标（信息传播）
    if (a.dailyGoal || b.dailyGoal) {
      const who = a.dailyGoal ? a : b;
      const other = who === a ? b : a;
      return {
        a: who === a ? `我今天的打算是「${who.dailyGoal}」。` : `你呢，今天打算干嘛？`,
        b: who === b ? `我今天的打算是「${who.dailyGoal}」。` : `听起来不错，加油。`,
      };
    }
    return randomFrom(topics);
  }

  function poiNameNear(npc) {
    let best = null, bd = Infinity;
    for (const p of POIS) {
      const d = Math.hypot(npc.x - (p.x + p.w / 2), npc.y - (p.y + p.h / 2));
      if (d < bd) { bd = d; best = p; }
    }
    return best ? best.name : "街上";
  }

  // ---------- 目标解析（规则式）----------
  function parseGoal(npc, text) {
    const t = text.toLowerCase();
    const likes = [];
    let socialBias = false, saveBias = false, workBias = false;

    if (/(赚钱|打工|工作|赚金币|攒钱)/.test(t)) workBias = true;
    if (/(咖啡|cafe)/.test(t)) likes.push("咖啡馆");
    if (/(集市|购物|买东西)/.test(t)) likes.push("集市");
    if (/(公园|散步|锻炼|休息)/.test(t)) likes.push("公园");
    if (/(图书馆|读书|学习)/.test(t)) likes.push("图书馆");
    if (/(朋友|社交|聊天|交朋友)/.test(t)) { socialBias = true; likes.push("咖啡馆"); likes.push("集市"); }
    if (/(省钱|节俭|别花)/.test(t)) saveBias = true;

    npc.dailyGoal = text;
    npc.goalBoost = { likes, socialBias, saveBias, workBias };
    if (!npc.chatOpen) pickNextTarget(npc);
  }

  function pickNextTarget(npc) {
    if (npc.chatOpen) return;
    const boost = npc.goalBoost;
    const homeChance = 0.1;
    const pool = POIS.filter((p) => p !== npc.home);

    // B3 事件修饰：雨天避开户外
    if (modifiers.outdoorAvoid && !npc.isVisitor) {
      const indoor = pool.filter((p) => p.id !== "park");
      if (indoor.length) npc.target = randomFrom(indoor);
      else npc.target = randomFrom(pool);
      H.addEvent(`${npc.name} 躲雨前往「${npc.target.name}」`, "move");
      return;
    }

    // 优先级 1：玩家目标 likes
    if (boost && boost.likes.length && Math.random() < 0.6) {
      npc.target = POIS.find((p) => boost.likes.includes(p.name)) || null;
      if (npc.target) { H.addEvent(`${npc.name} 按目标前往「${npc.target.name}」`, "move"); return; }
    }
    // 优先级 2：性格 likes（B3 事件加成）
    if (Math.random() < 0.5) {
      const weighted = [];
      for (const p of POIS) {
        if (!npc.personality.likes.includes(p.name)) continue;
        let w = 1;
        if (p.id === "park") w *= modifiers.parkBias;
        if (p.id === "cafe") w *= modifiers.cafeBias;
        if (p.id === "market") w *= modifiers.marketBias;
        for (let k = 0; k < w; k++) weighted.push(p);
      }
      if (weighted.length) { npc.target = randomFrom(weighted); H.addEvent(`${npc.name} 前往「${npc.target.name}」`, "move"); return; }
    }
    // 优先级 3：回家
    if (Math.random() < homeChance) { npc.target = npc.home; H.addEvent(`${npc.name} 回家了`, "move"); return; }
    // 优先级 3.5：打工目标
    if (boost && boost.workBias && Math.random() < 0.7) {
      npc.target = POIS.find((p) => p.id === "market") || POIS.find((p) => p.id === "cafe");
      if (npc.target) { H.addEvent(`${npc.name} 去「${npc.target.name}」干活赚金币`, "move"); return; }
    }
    // 优先级 4：随机
    npc.target = randomFrom(pool);
    H.addEvent(`${npc.name} 前往「${npc.target.name}」`, "move");
  }

  function moveToward(npc, gameMin) {
    if (!npc.target || npc.chatOpen) return;
    const tx = npc.target.x + npc.target.w / 2;
    const ty = npc.target.y + npc.target.h / 2;
    const dx = tx - npc.x, dy = ty - npc.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) { arrivePoi(npc); return; }
    const step = Math.min(npc.speed * gameMin, dist);
    npc.x += (dx / dist) * step;
    npc.y += (dy / dist) * step;
    npc.x = Math.max(4, Math.min(896, npc.x));
    npc.y = Math.max(34, Math.min(556, npc.y));
  }

  function arrivePoi(npc) {
    const poi = npc.target;
    npc.target = null;
    npc.stats.arrived++;
    drift(npc, "arrive", 0.2);
    npc.stayTicks = STAY_TICKS;

    let buyChance = 0.7 - npc.traits.frugality * 0.4;   // B1：节俭倾向直接压消费
    if (npc.goalBoost?.saveBias) buyChance = 0.2;
    if (modifiers.spendBoost !== 1) buyChance *= modifiers.spendBoost;

    if (poi.price > 0 && Math.random() < buyChance) consume(npc, poi);
    else { H.say(npc, randomFrom(npc.personality.chat)); drift(npc, "arrive", 0.1); }

    if (npc.goalBoost?.socialBias && Math.random() < 0.5) {
      npc.stats.social++;
      H.say(npc, "刚才认识的新朋友，聊得真开心！");
    }
    if (npc.goalBoost?.workBias && poi.price > 0 && Math.random() < 0.6) earn(npc, poi);

    if (Math.random() < LONG_STAY_CHANCE) npc.stayTicks = STAY_TICKS * LONG_STAY_FACTOR;
  }

  function earn(npc, poi) {
    const pay = poi.price * 2;
    npc.gold = Math.min(GOLD_CAP, npc.gold + pay);
    npc.stats.spend -= pay;
    H.addEvent(`${npc.name} 在${poi.name}打工赚了 ${pay} 金币`, "money");
    H.say(npc, `在${poi.name}打了一天工，赚了 ${pay} 金币。`);
  }

  function consume(npc, poi) {
    if (npc.gold < poi.price) { H.say(npc, "金币不够，这次不买了。"); return; }
    npc.gold -= poi.price;
    npc.stats.spend += poi.price;
    poi.stock = Math.max(0, poi.stock - 1);
    drift(npc, "buy", -0.15);
    H.addEvent(`${npc.name} 在${poi.name}花了 ${poi.price} 金币`, "money");
    H.say(npc, `在${poi.name}买了一份，感觉不错！`);
  }

  function stayTick(npc) {
    if (npc.chatOpen || npc.target) return;
    if (npc.stayTicks > 0) {
      npc.stayTicks--;
      if (npc.stayTicks === 0) pickNextTarget(npc);
    }
  }

  function nightCheck(npc) {
    if (npc.chatOpen) return;
    const t = (gameTime / 60) % 24;
    if ((t >= 22 || t < 6) && !npc.target && npc.stayTicks === 0) pickNextTarget(npc);
  }

  // ---------- 补货 ----------
  let lastRestockAt = 9 * 60;
  function restock(force = false) {
    const elapsed = (gameTime - lastRestockAt + DAY_LENGTH) % DAY_LENGTH;
    if (!force && elapsed < RESTOCK_INTERVAL_MIN) return;
    lastRestockAt = gameTime;
    for (const p of POIS) {
      if (p.price <= 0) continue;
      const cap = POI_INITIAL_STOCK[p.id] ?? 30;
      if (p.stock < cap) {
        p.stock = Math.min(cap, p.stock + RESTOCK_AMOUNT);
        H.addEvent(`「${p.name}」补货至 ${p.stock}`, "money");
      }
    }
  }

  // ---------- B3 随机事件 ----------
  function rollEvent() {
    if (activeEvent) return;
    if (Math.random() > 0.25) return;   // 每游戏日 25% 概率
    const candidates = TOWN_EVENTS.filter((e) => !(e.once && usedOnce.has(e.id)));
    if (!candidates.length) return;
    const ev = randomFrom(candidates);
    activeEvent = { id: ev.id, name: ev.name, desc: ev.desc, endsAt: gameTime + ev.durationH * 60 };
    if (ev.once) usedOnce.add(ev.id);
    modifiers = { marketBias: 1, cafeBias: 1, parkBias: 1, spendBoost: 1, outdoorAvoid: 0 };
    ev.apply(sim);
    H.addEvent(`【小镇事件】${ev.name}：${ev.desc}`, "day");
  }
  const usedOnce = new Set();

  function checkEventEnd() {
    if (!activeEvent) return;
    if (gameTime >= activeEvent.endsAt) {
      H.addEvent(`【小镇事件】${activeEvent.name} 结束了`, "day");
      activeEvent = null;
      modifiers = { marketBias: 1, cafeBias: 1, parkBias: 1, spendBoost: 1, outdoorAvoid: 0 };
      if (activeVisitor) { H.onRemoveVisitor(activeVisitor); activeVisitor = null; }
    }
  }

  function spawnVisitor() {
    if (activeVisitor) return;
    const v = makeNpc(99, true);
    v.name = "旅人";
    v.job = "远方来客";
    v.emoji = "🧭";
    v.gold = 200;
    activeVisitor = v;
    H.onVisitorMeshReady(v);
    H.addEvent("一位远方旅人来到了小镇", "day");
  }

  // ---------- 昼夜 ----------
  function daylight() {
    const t = (gameTime / 60) % 24;
    if (t < 5) return 0.12;
    if (t < 7) return 0.12 + ((t - 5) / 2) * 0.88;
    if (t < 17) return 1.0;
    if (t < 20) return 1.0 - ((t - 17) / 3) * 0.8;
    if (t < 21.5) return 0.2 - ((t - 20) / 1.5) * 0.08;
    return 0.12;
  }

  function clockText() {
    const totalMin = Math.floor(gameTime) % DAY_LENGTH;
    const h = Math.floor(totalMin / 60), m = totalMin % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  // ---------- 主循环 ----------
  let tickCount = 0;
  function tick() {
    if (paused) return;
    const gameMin = MINUTES_PER_TICK * speed;
    gameTime += gameMin;
    tickCount++;

    if (gameTime >= DAY_LENGTH) {
      gameTime -= DAY_LENGTH;
      dayCount++;
      for (const n of npcs) {
        n.gold = Math.min(GOLD_CAP, n.gold + DAILY_ALLOWANCE);
        n.dailyGoal = null;
        n.goalBoost = null;
        n.stats = { spend: 0, social: 0, chats: 0, arrived: 0 };
        // B1：性格缓慢回归基准，避免无限漂移
        for (const k of Object.keys(n.traits)) {
          const base = TRAIT_SEED[n.personality.key][k];
          n.traits[k] = clamp01(n.traits[k] * 0.9 + base * 0.1);
        }
      }
      H.addEvent("新的一天，津贴到账", "day");
      H.onDayChange(dayCount);
      restock(true);
      rollEvent();
      maybeSave();
    }

    checkEventEnd();
    for (const n of npcs) { nightCheck(n); stayTick(n); moveToward(n, gameMin); }
    if (activeVisitor) { stayTick(activeVisitor); moveToward(activeVisitor, gameMin); }
    tryMeet();
    restock();

    if (mayor && tickCount % 20 === 0) { mayor.seen++; H.onMayorChanged(); }
    maybeSave();
  }

  let lastSaveTick = -1e9;
  function maybeSave() {
    if (tickCount - lastSaveTick < 300) return;   // 约 30 秒真实时间
    lastSaveTick = tickCount;
    save();
  }

  // ---------- 聊天 ----------
  function openChat(npc) { npc.chatOpen = true; }
  function closeChat(npc) { if (npc) npc.chatOpen = false; }

  function respond(npc, text) {
    const t = text.toLowerCase();
    const p = npc.personality;

    if (/(你好|hi|hello|嗨)/i.test(t)) {
      return `${jobGreeting(npc)}嗨，我是${npc.name}！${randomFrom(p.chat)}`;
    }
    if (/(还记得|上次|昨天|之前|我说过)/i.test(t)) {
      // 优先回述玩家说过的话（玩家最想知道"它记得我"），再退到自己的经历
      const fromPlayer = npc.memory.filter((m) => m.from === "player");
      const m = fromPlayer.length ? fromPlayer[fromPlayer.length - 1] : recall(npc, 3)[0];
      if (m) return `我记得${m.from === "player" ? "你" : m.from}说过「${m.text}」。`;
      return "我们还没聊过什么吧？多跟我说说话。";
    }
    if (/(目标|打算|计划|今天干嘛|要做什么)/i.test(t)) {
      if (npc.dailyGoal) return `我今天打算：${npc.dailyGoal}。你帮我把把关？`;
      return "今天没特别打算，走两步再说。要不你帮我定个？";
    }
    if (/(性格|脾气|为人)/i.test(t)) {
      const t1 = dominantTrait(npc);
      return `大家说我偏${TRAIT_META[t1].label}，大概是吧。`;
    }
    if (/(工作|上班|职业|做什么|营生)/i.test(t)) {
      return `我是镇上${npc.job}。日子过得去，攒钱要紧。`;
    }
    if (/(钱|金币|gold)/i.test(t)) {
      if (npc.traits.frugality > 0.7) return `我现在 ${npc.gold} 金币，打算攒着，不乱花。`;
      if (npc.traits.sociability > 0.7) return `我现在 ${npc.gold} 金币，够请你看杯咖啡了！`;
      return `我现在 ${npc.gold} 金币，够生活，也能偶尔奢侈一下。`;
    }
    if (/(咖啡|cafe|咖啡馆)/i.test(t)) {
      if (p.dislikes.includes("咖啡馆")) return "我不太喜欢咖啡馆，更喜欢安静待着。";
      return "咖啡馆不错，我常去。要不要一起？";
    }
    if (/(图书馆|读书|书)/i.test(t)) {
      if (p.key === "nerd") return "图书馆是我最爱的地方，我读得正入迷呢。";
      if (p.dislikes.includes("图书馆")) return "图书馆太安静了，我坐不住。";
      return "图书馆挺舒服的，偶尔也去看看。";
    }
    if (/(天气|今天)/i.test(t)) {
      return `今天${lightOf()}。小镇上的日子就是平凡而美好。`;
    }
    if (/(公园|散步|走)/i.test(t)) {
      if (p.likes.includes("公园")) return "公园是我每天必去的地方！";
      return "公园不错，有空去走走。";
    }
    if (/(集市|买东西)/i.test(t)) {
      const market = POIS.find((p) => p.id === "market");
      return `集市的库存剩 ${market.stock} 份，要不要看看？`;
    }
    if (/(朋友|社交|聊天)/i.test(t)) {
      const friends = Object.entries(relations[npc.id] || {})
        .filter(([, r]) => r.friend > 0).length;
      return `我在镇上认识 ${friends} 个聊得来的人。`;
    }
    return `${jobGreeting(npc)}${randomFrom(p.chat)}`;
  }

  function jobGreeting(npc) {
    const JOB_STYLE = {
      "咖啡师": "刚擦完吧台，", "图书管理员": "从书架后探出身子，",
      "园艺师": "手上还沾着泥，", "矿工": "背着工具包，",
      "记者": "手里拿着笔记本，", "快递员": "刚送完一趟，",
      "店主": "站在自家铺子门口，", "学生": "书包还没放下，",
    };
    return JOB_STYLE[npc.job] || "";
  }
  function dominantTrait(npc) {
    let best = "sociability", bv = -1;
    for (const [k, v] of Object.entries(npc.traits)) if (v > bv) { bv = v; best = k; }
    return best;
  }
  function lightOf() {
    const d = daylight();
    return d > 0.75 ? "很好" : d > 0.45 ? "有点凉" : d > 0.2 ? "挺安静" : "夜深了";
  }

  // ---------- 镇长 ----------
  function setMayorName(name) {
    const fresh = !mayor;
    mayor = { name, since: dayCount, chats: 0, goals: 0, seen: 0 };
    H.addEvent(`${name} 成为小镇的${fresh ? "首任" : "新任"}镇长`, "day");
    H.onMayorChanged();
  }
  function mayorChat() { if (mayor) { mayor.chats++; H.onMayorChanged(); } }
  function mayorGoal() { if (mayor) { mayor.goals++; H.onMayorChanged(); } }

  // ---------- A4 装饰 ----------
  function townFunds() { return npcs.reduce((s, n) => s + n.gold, 0); }
  function placeDecor(typeId, x, y) {
    const type = DECOR_TYPES.find((d) => d.id === typeId);
    if (!type) return { ok: false, reason: "未知装饰物" };
    const budget = townFunds();
    if (budget < type.cost) return { ok: false, reason: "小镇资金不足" };
    decors.push({ id: `${type.id}_${Date.now()}`, type: type.id, x, y, placedDay: dayCount });
    H.onDecorsChanged(decors);
    H.addEvent(`镇长放置了${type.name}`, "day");
    maybeSave();
    return { ok: true };
  }
  function removeDecor(decorId) {
    decors = decors.filter((d) => d.id !== decorId);
    H.onDecorsChanged(decors);
    maybeSave();
  }
  function decorComment(npc) {
    if (!decors.length || Math.random() > 0.25) return;
    const d = randomFrom(decors);
    const type = DECOR_TYPES.find((t) => t.id === d.type);
    H.say(npc, `${type.name}还挺好看的，镇长有心了。`);
  }

  // ---------- 存档（A2）----------
  function save() {
    safeStorage("set", SAVE_KEY, JSON.stringify({
      v: 2, gameTime, dayCount, tickCount,
      mayor, decors,
      npcs: npcs.map((n) => ({
        id: n.id, x: Math.round(n.x), y: Math.round(n.y), gold: n.gold,
        dailyGoal: n.dailyGoal, traits: n.traits, memory: n.memory,
        mayorFavor: n.mayorFavor, stats: n.stats,
      })),
      stocks: Object.fromEntries(POIS.map((p) => [p.id, p.stock])),
    }));
  }
  function load() {
    const raw = safeStorage("get", SAVE_KEY);
    if (!raw) return false;
    try {
      const s = JSON.parse(raw);
      if (s.v !== 2) return false;
      gameTime = s.gameTime; dayCount = s.dayCount; tickCount = s.tickCount || 0;
      mayor = s.mayor || null; decors = s.decors || [];
      for (const saved of s.npcs) {
        const n = npcs[saved.id];
        if (!n) continue;
        Object.assign(n, {
          x: saved.x, y: saved.y, gold: saved.gold, dailyGoal: saved.dailyGoal,
          traits: saved.traits, memory: saved.memory || [], mayorFavor: saved.mayorFavor || 0,
          stats: saved.stats, target: null, stayTicks: 0, goalBoost: null,
        });
      }
      for (const [id, stock] of Object.entries(s.stocks || {})) {
        const p = POIS.find((q) => q.id === id);
        if (p) p.stock = stock;
      }
      lastRestockAt = gameTime;
      return true;
    } catch (_) { return false; }
  }
  function newWorld() {
    try { localStorage.removeItem(SAVE_KEY); } catch (_) {}
  }

  // ---------- 对外 ----------
  const sim = {
    // 常量（UI 层需要）
    POIS, PERSONALITIES, DECOR_TYPES, TRAIT_META, DAY_LENGTH, GOLD_CAP,
    // 状态访问
    get gameTime() { return gameTime; },
    get dayCount() { return dayCount; },
    get npcs() { return npcs; },
    get allNpcs() { return activeVisitor ? [...npcs, activeVisitor] : npcs; },
    get visitor() { return activeVisitor; },
    get relations() { return relations; },
    get decors() { return decors; },
    get modifiers() { return modifiers; },
    get activeEvent() { return activeEvent; },
    get mayor() { return mayor; },
    get speed() { return speed; },
    get paused() { return paused; },
    get tickCount() { return tickCount; },
    // 操作
    tick, save, load, newWorld,
    setSpeed(s) { speed = clampSpeed(s); safeStorage("set", SPEED_KEY, String(speed)); },
    cycleSpeed() { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; safeStorage("set", SPEED_KEY, String(speed)); },
    setPaused(v) { paused = v; },
    togglePaused() { paused = !paused; },
    clockText, daylight, lightOf,
    parseGoal, respond, openChat, closeChat, remember, recall, spawnVisitor,
    setMayorName, mayorChat, mayorGoal,
    placeDecor, removeDecor, decorComment,
    npcScore(n) { return Math.abs(n.stats.spend) + n.stats.social * 20 + n.stats.chats * 15 + n.stats.arrived * 5; },
    townFunds,
    reset() {
      for (const n of npcs) {
        n.x = START_POINTS[n.id % START_POINTS.length].x;
        n.y = START_POINTS[n.id % START_POINTS.length].y;
        n.target = null; n.stayTicks = 0;
        n.gold = 50 + Math.floor(Math.random() * 80);
        n.chatOpen = false; n.dailyGoal = null; n.goalBoost = null;
        n.traits = { ...TRAIT_SEED[n.personality.key] };
        n.memory = []; n.mayorFavor = 0;
        n.stats = { spend: 0, social: 0, chats: 0, arrived: 0 };
      }
      for (const p of POIS) p.stock = POI_INITIAL_STOCK[p.id] ?? 0;
      gameTime = 9 * 60; dayCount = 1; lastRestockAt = 9 * 60;
      const visitorToRemove = activeVisitor;
      relations = {}; decors = []; activeEvent = null; activeVisitor = null;
      modifiers = { marketBias: 1, cafeBias: 1, parkBias: 1, spendBoost: 1, outdoorAvoid: 0 };
      speed = 1; paused = false; tickCount = 0;
      H.onDecorsChanged(decors);
      if (visitorToRemove) H.onRemoveVisitor(visitorToRemove);
    },
    // 供 UI 注册：NPC 网格建好后由 world3d 回调，这里只做标记
    buildMeshes,
    get startPoints() { return START_POINTS; },
  };

  initNpcs();
  return sim;
}

export { POIS, POI_INITIAL_STOCK, PERSONALITIES, NAMES, JOBS, DECOR_TYPES, TRAIT_META, clampSpeed };
