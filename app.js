// AI 小镇 — 单页 Canvas 模拟
// 模块：城镇地图、NPC 巡游、聊天、昼夜循环、经济事件、行为日志

(() => {
  "use strict";

  // ---------- 基础常量 ----------
  const canvas = document.getElementById("town");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  // 世界时间：一天 = 2400 "分钟"，循环
  const DAY_LENGTH = 2400; // 游戏分钟/天
  const TICK_MS = 100;      // 每 tick 100ms
  const MINUTES_PER_TICK = 4; // 每 tick 推进 4 游戏分钟
  let gameTime = 9 * 60;    // 起始 09:00
  let dayCount = 1;
  let paused = false;
  let speed = clampSpeed(Number(localStorage.getItem("aitown_speed")) || 1);
  function clampSpeed(s) { return s === 2 || s === 4 ? s : 1; }
  let lastActive = null;    // 正在说话的 NPC（显示气泡）
  let activeNpc = null;     // 聊天面板选中的 NPC

  // ---------- 地点（POI） ----------
  // 每个地点是一个矩形区域 + 一个图标
  const POIS = [
    { id: "cafe", name: "咖啡馆", x: 70, y: 90, w: 150, h: 110, color: "#8b5a2b", icon: "☕", price: 30, stock: 50 },
    { id: "lib", name: "图书馆", x: 700, y: 80, w: 150, h: 110, color: "#3b5998", icon: "📚", price: 0, stock: 0 },
    { id: "park", name: "公园", x: 350, y: 380, w: 200, h: 130, color: "#4a7c3f", icon: "🌳", price: 10, stock: 30 },
    { id: "home1", name: "小住宅", x: 90, y: 400, w: 130, h: 90, color: "#c9a227", icon: "🏠", price: 0, stock: 0 },
    { id: "home2", name: "公寓", x: 640, y: 380, w: 150, h: 110, color: "#c9a227", icon: "🏢", price: 0, stock: 0 },
    { id: "market", name: "集市", x: 380, y: 70, w: 180, h: 120, color: "#7b3f99", icon: "🛒", price: 20, stock: 40 },
  ];

  function poiAt(x, y) {
    for (const p of POIS) {
      if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return p;
    }
    return null;
  }

  // ---------- NPC ----------
  const NAMES = ["小北", "阿澈", "柚子", "老周", "林可", "豆豆", "阿凯", "苏苏"];
  let startPointsRef = null; // makeNpcs 初始化后填充，供重置使用
  // 初始库存：仅 price>0 的 POI 会进入 restock 分支，
  // price=0 的 POI（lib/home1/home2）取值为 0 仅作兜底，restock 会跳过它们。
  const POI_INITIAL_STOCK = { cafe: 50, lib: 0, park: 30, home1: 0, home2: 0, market: 40 };
  const PERSONALITIES = [
    {
      key: "saver", label: "节俭型", color: "#4ade80",
      likes: ["公园"], dislikes: ["咖啡馆"],
      chat: [
        "又存了点钱，感觉生活很踏实。",
        "今天没去咖啡馆，省下的咖啡钱够买一周的面包了。",
        "公园的椅子很便宜，坐着看云也很舒服。",
      ],
    },
    {
      key: "social", label: "社交型", color: "#38bdf8",
      likes: ["咖啡馆", "集市"], dislikes: ["图书馆"],
      chat: [
        "刚才在咖啡馆认识了一个新邻居，聊得超开心！",
        "集市上那家水果铺今天人好多，下次一起去？",
        "我话多吗？我觉得小镇上大家都挺爱聊天的。",
      ],
    },
    {
      key: "nerd", label: "学术型", color: "#c084fc",
      likes: ["图书馆"], dislikes: ["集市"],
      chat: [
        "新读到一本书，讲小镇经济循环的，很有意思。",
        "今天花 30 金币买了杯咖啡，但我觉得图书馆更值。",
        "你信玄学吗？我最近在读一本关于概率的书。",
      ],
    },
    {
      key: "adventurer", label: "冒险型", color: "#fb923c",
      likes: ["集市", "公园"], dislikes: ["小住宅"],
      chat: [
        "今天去了集市最北边，看到了一家新开的面包房！",
        "冒险不是去哪，是愿意多走一步。",
        "今晚在公园散步的时候看到一只猫，超可爱。",
      ],
    },
  ];

  function makeNpcs() {
    const npcs = [];
    const startPoints = [
      { x: 150, y: 450 },
      { x: 700, y: 430 },
      { x: 450, y: 130 },
      { x: 430, y: 420 },
      { x: 470, y: 410 },
      { x: 140, y: 150 },
      { x: 690, y: 140 },
      { x: 420, y: 430 },
    ];
    startPointsRef = startPoints;
    NAMES.forEach((name, i) => {
      const p = PERSONALITIES[i % PERSONALITIES.length];
      npcs.push({
        id: i,
        name,
        personality: p,
        x: startPoints[i].x,
        y: startPoints[i].y,
        r: 10,
        target: null,
        speed: 0.8 + Math.random() * 0.6,
        gold: 50 + Math.floor(Math.random() * 80),
        home: POIS[i % 2 === 0 ? 3 : 4], // 住在家附近
        lastActionAt: gameTime,
        mood: "normal",
        emoji: ["🙂", "😄", "😎", "🤓"][i % 4],
        chatOpen: false,
        chatLines: p.chat,
      });
    });
    return npcs;
  }

  const npcs = makeNpcs();

  // ---------- 巡游（寻路简化版：直线 + 避障） ----------
  function pickNextTarget(npc) {
    // 偏好：60% 喜欢的地点，30% 随机地点，10% 回家
    const roll = Math.random();
    if (roll < 0.1 && !npc.chatOpen) {
      npc.target = npc.home;
      npc.lastActionAt = gameTime;
      addEvent(`${npc.name} 回家了`, "move");
      return;
    }
    if (roll < 0.7) {
      const likes = POIS.filter((p) => npc.personality.likes.includes(p.name));
      npc.target = likes.length ? likes[Math.floor(Math.random() * likes.length)] : null;
    }
    if (!npc.target) {
      const pool = POIS.filter((p) => p !== npc.home);
      npc.target = pool[Math.floor(Math.random() * pool.length)];
    }
    addEvent(`${npc.name} 前往「${npc.target.name}」`, "move");
  }

  function moveToward(npc, dt) {
    if (!npc.target || npc.chatOpen) return;
    // 目标点：POI 中心附近（确定性，避免每 tick 随机抖动）
    const tx = npc.target.x + npc.target.w / 2;
    const ty = npc.target.y + npc.target.h / 2;
    const dx = tx - npc.x;
    const dy = ty - npc.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) {
      arrivePoi(npc);
      return;
    }
    const step = npc.speed * 0.3 * dt;
    npc.x += (dx / dist) * step;
    npc.y += (dy / dist) * step;
    // 边界约束
    npc.x = Math.max(npc.r, Math.min(W - npc.r, npc.x));
    npc.y = Math.max(npc.r + 30, Math.min(H - npc.r, npc.y));
  }

  function arrivePoi(npc) {
    const poi = npc.target;
    npc.target = null;
    // 到达后可能消费
    if (poi.price > 0 && Math.random() < 0.7) {
      consume(npc, poi);
    } else {
      say(npc, randomFrom(npc.personality.chat));
    }
    // 不是每次到达都立刻选下一目标，减少事件噪音
    if (Math.random() < 0.4) pickNextTarget(npc);
  }

  function consume(npc, poi) {
    if (npc.gold < poi.price) {
      say(npc, "金币不够，这次不买了。");
      return;
    }
    npc.gold -= poi.price;
    poi.stock = Math.max(0, poi.stock - 1);
    addEvent(`${npc.name} 在${poi.name}花了 ${poi.price} 金币`, "money");
    say(npc, `在${poi.name}买了一份，感觉不错！`);
  }

  // ---------- 说话 / 气泡 ----------
  const speechEl = document.getElementById("speech");
  function say(npc, text) {
    lastActive = npc;
    speechEl.textContent = `${npc.name}：${text}`;
    speechEl.classList.remove("hidden");
    clearTimeout(say._t);
    say._t = setTimeout(() => {
      speechEl.classList.add("hidden");
      lastActive = null;
    }, 2800);
    addEvent(`${npc.name} 说：${text}`, "speak");
  }

  function randomFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // ---------- 事件日志 ----------
  const eventLog = document.getElementById("eventLog");
  function addEvent(text, kind = "") {
    const li = document.createElement("li");
    li.textContent = `[${clockText()}] ${text}`;
    if (kind) li.className = kind;
    eventLog.prepend(li);
    while (eventLog.children.length > 60) eventLog.removeChild(eventLog.lastChild);
  }

  // ---------- 时钟 / 昼夜 ----------
  const clockEl = document.getElementById("clock");
  const dayLabelEl = document.getElementById("daylabel");
  function clockText() {
    const totalMin = Math.floor(gameTime) % DAY_LENGTH;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  function daylight() {
    // 0-6:00 夜 → 6-8:00 晨 → 8-18:00 昼 → 18-21:00 暮 → 21-24:00 夜
    const t = (gameTime / 60) % 24;
    if (t < 6 || t >= 21) return 0.18;
    if (t < 8) return 0.55;
    if (t < 18) return 1.0;
    if (t < 21) return 0.4;
    return 0.18;
  }

  // ---------- 绘制 ----------
  function draw() {
    const light = daylight();
    // 背景天空渐变
    const g = ctx.createLinearGradient(0, 0, 0, H);
    if (light > 0.7) {
      g.addColorStop(0, "#7ec8ff");
      g.addColorStop(1, "#d8efff");
    } else if (light > 0.3) {
      g.addColorStop(0, "#2c3e6b");
      g.addColorStop(1, "#6b88b5");
    } else {
      g.addColorStop(0, "#0a1230");
      g.addColorStop(1, "#1e2a55");
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 草地
    ctx.fillStyle = light > 0.7 ? "#8bc34a" : light > 0.3 ? "#5a7c3f" : "#2a3a25";
    ctx.fillRect(0, 100, W, H - 100);

    // 道路（横向 + 纵向）
    ctx.fillStyle = light > 0.5 ? "#cfd8dc" : "#455a64";
    ctx.fillRect(0, 340, W, 30); // 横向
    ctx.fillRect(320, 0, 30, H); // 纵向
    ctx.fillRect(560, 0, 24, H); // 纵向

    // POI
    for (const p of POIS) {
      ctx.fillStyle = p.color;
      roundRect(p.x, p.y, p.w, p.h, 10);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 2;
      roundRect(p.x, p.y, p.w, p.h, 10);
      ctx.stroke();
      // 图标
      ctx.font = "28px serif";
      ctx.fillText(p.icon, p.x + 10, p.y + 34);
      // 名称
      ctx.font = "bold 14px sans-serif";
      ctx.fillStyle = "white";
      ctx.fillText(p.name, p.x + 46, p.y + 30);
      // 库存
      if (p.price > 0) {
        ctx.font = "12px sans-serif";
        ctx.fillStyle = "#fff7d6";
        ctx.fillText(`库存 ${p.stock} · ${p.price}金币`, p.x + 10, p.y + p.h - 10);
      }
    }

    // NPC
    for (const npc of npcs) {
      // 阴影
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.ellipse(npc.x, npc.y + npc.r, npc.r, npc.r * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      // 身体
      ctx.fillStyle = npc.personality.color;
      ctx.beginPath();
      ctx.arc(npc.x, npc.y, npc.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.stroke();
      // 表情
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(npc.emoji, npc.x, npc.y + 1);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      // 名字
      ctx.font = "11px sans-serif";
      ctx.fillStyle = "white";
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 3;
      ctx.strokeText(npc.name, npc.x - 16, npc.y - npc.r - 4);
      ctx.fillText(npc.name, npc.x - 16, npc.y - npc.r - 4);
      // 目标指示
      if (npc.target && !npc.chatOpen) {
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(npc.x, npc.y);
        ctx.lineTo(npc.target.x + npc.target.w / 2, npc.target.y + npc.target.h / 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 顶部状态（在画布上）
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(0, 0, W, 30);
    ctx.font = "13px sans-serif";
    ctx.fillStyle = "white";
    ctx.fillText(`🕒 ${clockText()}  ·  第 ${dayCount} 天`, 10, 20);
    ctx.fillText(`${paused ? "已暂停" : `速度 ${speed}x`}`, W - 90, 20);

    // 夜间蒙层
    if (light < 0.6) {
      ctx.fillStyle = `rgba(10, 18, 48, ${0.55 * (1 - light)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- 聊天 ----------
  const chatPanel = document.getElementById("chatPanel");
  const chatMeta = document.getElementById("chatMeta");
  const chatLog = document.getElementById("chatLog");
  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");

  function openChat(npc) {
    activeNpc = npc;
    npc.chatOpen = true;
    chatMeta.textContent = `${npc.emoji} ${npc.name} · ${npc.personality.label}`;
    chatForm.classList.remove("hidden");
    chatLog.innerHTML = "";
    addChatMsg("npc", `你好，我是${npc.name}。今天天气${lightOf()}，要不要聊两句？`);
    chatInput.focus();
  }

  function closeChat() {
    if (activeNpc) activeNpc.chatOpen = false;
    activeNpc = null;
    chatMeta.textContent = "点击地图上的居民开始对话";
    chatForm.classList.add("hidden");
    chatLog.innerHTML = "";
  }

  function lightOf() {
    const d = daylight();
    return d > 0.7 ? "很好" : d > 0.3 ? "有点凉" : "挺安静";
  }

  function addChatMsg(role, text) {
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    div.textContent = text;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !activeNpc) return;
    chatInput.value = "";
    addChatMsg("user", text);
    activeNpc.chatOpen = true;
    const reply = respond(activeNpc, text);
    setTimeout(() => {
      addChatMsg("npc", reply);
      say(activeNpc, reply);
    }, 400 + Math.random() * 400);
  });

  // 规则式回复：关键词 + 性格
  function respond(npc, text) {
    const t = text.toLowerCase();
    const p = npc.personality;
    // 关键词命中
    if (/(你好|hi|hello|嗨)/i.test(t)) {
      return `嗨，我是${npc.name}！${randomFrom(p.chat)}`;
    }
    if (/(钱|金币|gold)/i.test(t)) {
      if (p.key === "saver") return `我现在有 ${npc.gold} 金币，打算攒着。节俭让我安心。`;
      if (p.key === "social") return `我现在 ${npc.gold} 金币，够请你看杯咖啡了！`;
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
      return `集市的库存剩 ${POIS.find((p) => p.id === "market").stock} 份，要不要看看？`;
    }
    // 兜底：性格风格
    return randomFrom(p.chat);
  }

  // ---------- 交互 ----------
  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const sy = (e.clientY - rect.top) * (canvas.height / rect.height);
    // 找最近的 NPC（30 像素内）
    let best = null, bestD = 30;
    for (const n of npcs) {
      const d = Math.hypot(n.x - sx, n.y - sy);
      if (d < bestD) { bestD = d; best = n; }
    }
    if (best) {
      if (activeNpc === best) closeChat();
      else openChat(best);
    } else {
      // 点击空白处：关闭聊天
      closeChat();
    }
  });

  document.getElementById("pauseBtn").addEventListener("click", (e) => {
    paused = !paused;
    e.target.textContent = paused ? "继续" : "暂停";
  });

  document.getElementById("speedBtn").addEventListener("click", (e) => {
    speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
    e.target.textContent = `${speed}x`;
    try { localStorage.setItem("aitown_speed", String(speed)); } catch (_) {}
  });

  // 聊天面板关闭按钮
  const chatClose = document.getElementById("chatClose");
  if (chatClose) chatClose.addEventListener("click", closeChat);

  document.getElementById("resetBtn").addEventListener("click", () => {
    if (!confirm("重置小镇？当前所有 NPC 状态、金币、库存将还原到初始。")) return;
    // NPC 重置
    for (const n of npcs) {
      n.x = startPointsRef[n.id].x;
      n.y = startPointsRef[n.id].y;
      n.target = null;
      n.gold = 50 + Math.floor(Math.random() * 80);
      n.chatOpen = false;
      n.emoji = ["🙂", "😄", "😎", "🤓"][n.id % 4];
    }
    // POI 库存重置
    for (const p of POIS) {
      p.stock = POI_INITIAL_STOCK[p.id] ?? 0;
    }
    // 时间重置
    gameTime = 9 * 60;
    dayCount = 1;
    dayLabelEl.textContent = "第 1 天";
    clockEl.textContent = clockText();
    eventLog.innerHTML = "";
    // 速度也回到 1x
    speed = 1;
    document.getElementById("speedBtn").textContent = "1x";
    try { localStorage.removeItem("aitown_speed"); } catch (_) {}
    closeChat();
    addEvent("小镇已重置", "speak");
    draw();
  });

  // ---------- 经济/补货 ----------
  let restockTick = 0; // 每 N 次补货写 1 条日志，避免刷屏
  const RESTOCK_LOG_EVERY = 5;
  function restock() {
    restockTick++;
    const shouldLog = restockTick % RESTOCK_LOG_EVERY === 0;
    for (const p of POIS) {
      if (p.price <= 0) continue;
      const cap = POI_INITIAL_STOCK[p.id] ?? 30;
      if (p.stock < cap) {
        p.stock = Math.min(cap, p.stock + 3);
        if (shouldLog) addEvent(`「${p.name}」补货至 ${p.stock}（上限 ${cap}）`, "money");
      }
    }
  }

  // 夜间 NPC 回 home
  function nightCheck(npc) {
    if (npc.chatOpen) return; // 聊天中不抢目标
    const t = (gameTime / 60) % 24;
    if ((t >= 22 || t < 6) && !npc.target) {
      pickNextTarget(npc);
    }
  }

  // ---------- 主循环 ----------
  function tick() {
    if (!paused) {
      const dt = TICK_MS / 1000;
      gameTime += MINUTES_PER_TICK * speed;
      if (gameTime >= DAY_LENGTH) {
        gameTime -= DAY_LENGTH;
        dayCount++;
        dayLabelEl.textContent = `第 ${dayCount} 天`;
        // 新一天：给 NPC 发一点津贴
        for (const n of npcs) {
          n.gold += 20;
        }
        addEvent(`新的一天！所有居民获得 20 金币津贴`, "money");
        restock();
      }
      for (const n of npcs) {
        nightCheck(n);
        moveToward(n, dt * speed);
      }
      clockEl.textContent = clockText();
      draw();
    }
  }

  // ---------- 启动 ----------
  dayLabelEl.textContent = `第 ${dayCount} 天`;
  clockEl.textContent = clockText();
  document.getElementById("speedBtn").textContent = `${speed}x`; // 恢复持久化速度
  draw();
  setInterval(tick, TICK_MS);

  // 预热 10 次推进，让 NPC 走到目标附近
  for (let i = 0; i < 10; i++) {
    gameTime += MINUTES_PER_TICK;
    for (const n of npcs) {
      nightCheck(n);
      moveToward(n, 0.1);
    }
    if (gameTime >= DAY_LENGTH) gameTime -= DAY_LENGTH;
  }
  clockEl.textContent = clockText();
  addEvent("小镇开张了！点击居民可以聊天。", "speak");
})();
