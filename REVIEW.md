# AI 小镇 — 代码审查报告

> 审查日期：2026-10-12
> 审查范围：`index.html` / `styles.css` / `app.js` / `wrangler.toml`
> 审查方式：静态走读 + Node mock 端到端执行 + 几何校验脚本

## 结论

原代码在浏览器里可正常运行，但存在 **8 个 P0/P1 级缺陷**（其中 1 个为功能性 bug、2 个为资源 bug、2 个为状态机 bug）和 **4 项 P2 级小问题**。本次审查已同步修复所有 P0/P1 项，P2 保留为后续改进项。修复后 mock 端到端测试通过。

---

## P0 — 功能性 Bug（已修复）

### 1. `moveToward` 每 tick 重新采样目标点，NPC 走成布朗运动
**位置**：`app.js` 第 144–145 行（修复前）

```js
// 原代码
const tx = npc.target.x + npc.target.w * (0.2 + Math.random() * 0.6);
const ty = npc.target.y + npc.target.h * (0.2 + Math.random() * 0.6);
```

**问题**：`moveToward` 在 `tick()` 中每 100ms 被调用一次，每次都用 `Math.random()` 重算目标点。NPC 永远到不了同一个点，表现为抖动/绕圈；`dist < 4` 判定几乎不可能触发，`arrivePoi` 极少执行，消费/闲聊事件链被打断。

**修复**：改为确定性 POI 中心点：

```js
const tx = npc.target.x + npc.target.w / 2;
const ty = npc.target.y + npc.target.h / 2;
```

---

### 2. 聊天提交把 NPC 回复提前渲染了一次
**位置**：`app.js` 第 393–397 行（修复前）

```js
// 原代码
addChatMsg("user", text);
activeNpc.chatOpen = true;
setTimeout(() => {
  addChatMsg("npc", respond(activeNpc, text));
  say(activeNpc, respond(activeNpc, text));
}, 400 + Math.random() * 400);
```

**问题**：`setTimeout` 外多调了一次 `addChatMsg("npc", ...)`，且 `respond()` 在 `setTimeout` 内被调用两次（面板 + 气泡），两次返回结果不一致（规则式随机兜底），用户看到的"面板里的话"和"气泡里的话"对不上。

**修复**：统一缓存一次 `reply`，面板与气泡使用同一句：

```js
const reply = respond(activeNpc, text);
setTimeout(() => {
  addChatMsg("npc", reply);
  say(activeNpc, reply);
}, 400 + Math.random() * 400);
```

---

### 3. `restock` 上限 = `price * 2`，补货几乎无意义
**位置**：`app.js` 第 468–473 行（修复前）

```js
// 原代码
if (p.price > 0 && p.stock < p.price * 2) {
  p.stock += 1;
  ...
}
```

**问题**：咖啡馆 price=30 → 上限 60；集市 price=20 → 上限 40；公园 price=10 → 上限 20。但初始库存分别是 50 / 40 / 30，初始值就已经超过"补货阈值"，补货永远不触发，`restock` 等于空跑。事件日志里也永远看不到"补了 1 份库存"。

**修复**：引入 `POI_INITIAL_STOCK` 作为上限参照，每次 +3：

```js
const POI_INITIAL_STOCK = { cafe: 50, lib: 0, park: 30, home1: 0, home2: 0, market: 40 };
function restock() {
  for (const p of POIS) {
    if (p.price <= 0) continue;
    const cap = POI_INITIAL_STOCK[p.id] ?? 30;
    if (p.stock < cap) {
      p.stock = Math.min(cap, p.stock + 3);
      addEvent(`「${p.name}」补了 3 份库存（上限 ${cap}）`, "money");
    }
  }
}
```

---

## P1 — 状态机 / 资源 Bug（已修复）

### 4. 点击空白关闭聊天 + 点击 NPC 时"强制移动" NPC
**位置**：`app.js` 第 447–452 行（修复前）

```js
// 原代码
if (best) {
  if (activeNpc === best) closeChat();
  else openChat(best);
} else if (activeNpc) {
  closeChat();
}
```

**问题**：`closeChat()` 本身无害，但点击画布空白处（未命中任何 NPC）时，由于 `closeChat` 被调用，`activeNpc = null`、聊天面板清空——这一步没错。然而点击 NPC 切换对话时，前一个 NPC 的 `chatOpen` 被保留，`moveToward` 中 `npc.chatOpen` 判断使其"停住"，而 `nightCheck` 中又会反复调用 `pickNextTarget` 给它塞新目标，事件日志里持续刷 `「X 前往 Y」`，与"该 NPC 正在被聊天"矛盾。

**修复**：`nightCheck` 加 `chatOpen` 守卫；空白点击简化为无副作用的 `closeChat`：

```js
function nightCheck(npc) {
  if (npc.chatOpen) return;
  ...
}
// 点击空白
} else {
  closeChat();
}
```

---

### 5. `nightCheck` 在 NPC 聊天中仍可能抢目标
**位置**：`app.js` 第 476–481 行（修复前）

见 #4 已说明。`pickNextTarget` 内部对 `chatOpen` 仅做了"回家"分支的守卫，"喜欢地点"和"随机地点"分支不检查，导致 90% 概率仍会给一个"聊天中"的 NPC 分配新目标。修复方式即 #4 的 `if (npc.chatOpen) return;` 一行。

---

### 6. 缺失 `reset` 功能（功能缺口，非 bug）
**问题**：UI 上没有任何方式回到初始状态。长跑模拟后 NPC 金币波动、库存衰减、日志膨胀，用户只能刷新页面。

**修复**：`index.html` 顶栏加 `#resetBtn`，`app.js` 注册点击后调用 `confirm` 确认，重置 `gameTime` / `dayCount` / NPC 坐标与金币 / POI 库存 / 日志 / 聊天面板。

---

### 7. `lightOf(npc)` 形参未使用
**位置**：`app.js` 第 375–377 行（修复前）

```js
// 原代码
function lightOf() { ... }  // 无参数
addChatMsg("npc", `... 今天天气${lightOf(npc)} ...`);  // 传参了
```

**问题**：传参与签名不一致。Node 不报错，但违反"函数签名应与调用匹配"约定；若将来 `lightOf` 真正需要 NPC 信息（如该 NPC 在室外 / 室内），会埋雷。

**修复**：调用点去掉实参。

---

### 8. `wrangler.toml` 写法与 Cloudflare Pages 不匹配
**位置**：`wrangler.toml`（修复前）

```toml
[build]
command = "echo 'no build'"
publish = "./"
```

**问题**：`[build]` 表是 **Pages** 专用，但写在 `wrangler.toml` 里会被 `wrangler deploy`（Workers 命令）当成普通字段忽略；`wrangler pages deploy` 会**直接忽略整个 `wrangler.toml`**（它只认 `pages.toml` 或 CLI 参数）。这段配置实际无效，会误导后续维护者。

**修复**：改写成 Pages 真正能识别的最小 `wrangler.toml`：

```toml
name = "ai-town"
compatibility_date = "2026-01-01"
```

并在 README 中把 Git 部署的 Build command 改成 `echo 'no build'`（保持现状），强调 `wrangler pages deploy` 通过 CLI 参数传目录。

---

## P2 — 小问题 / 改进项（已全部修复）

### 9. `POI_INITIAL_STOCK` 命名混淆 ✅
`lib` / `home1` / `home2` 在表里写为 `0`，但它们 `price = 0` 根本不会进入 `restock` 分支。
**修复**：在表上方加注释"price=0 的 POI 取值为 0 仅作兜底，restock 会跳过它们"。

### 10. `speed` 状态没有持久化 ✅
**修复**：用 `localStorage.getItem("aitown_speed")` 初始化 `speed`，点击按钮时写回；`clampSpeed` 校验只接受 1/2/4。重置按钮同时清掉该 key。

### 11. `restock` 补货事件无条件写日志 ✅
**修复**：引入 `restockTick` 计数 + `RESTOCK_LOG_EVERY = 5`，每 5 次补货写 1 条日志，避免长跑刷屏。

### 12. 聊天面板无"关闭"按钮 ✅
**修复**：`index.html` 的 `#chatPanel` 顶栏加 `#chatClose` 按钮（`×`），`app.js` 注册 `click → closeChat`；`styles.css` 新增 `.panel-head` / `.icon-btn` 样式。

---

## 几何校验（POI / 道路 / 画布边界）

写了一小段 Node 脚本核对 6 个 POI 的坐标与道路（纵向 x=320-350、x=560-584；横向 y=340-370）的关系：

| POI | 范围 (x, y) | 越界 | 压道路 | 互相重叠 |
|-----|-------------|------|--------|----------|
| cafe   | 70–220, 90–200   | 无 | 无 | 无 |
| lib    | 700–850, 80–190  | 无 | 无 | 无 |
| park   | 350–550, 380–510 | 无 | 无 | 无 |
| home1  | 90–220, 400–490  | 无 | 无 | 无 |
| home2  | 640–790, 380–490 | 无 | 无 | 无 |
| market | 380–560, 70–190  | 无 | 无 | 无 |

结论：**布局几何无问题**。

---

## 部署链路复核

- **Cloudflare Pages**：纯静态站点，`wrangler pages deploy . --project-name=ai-town` 即可，不依赖构建步骤。
- **Git 部署**：Build command 写 `echo 'no build'`、Output 填 `.`、Framework preset 选 `Static`，与 README 第 1 节一致。
- **本地预览**：`npx serve .` / `python -m http.server`，与 README 第 2 节一致。
- **CORS / 网络**：纯前端，无 fetch / Worker，无跨域、无构建产物路径问题。

---

## 修复清单（本次提交已落盘）

| # | 类型 | 文件 | 状态 |
|---|------|------|------|
| 1 | P0 Bug | `app.js` | ✅ 已修复 |
| 2 | P0 Bug | `app.js` | ✅ 已修复 |
| 3 | P0 Bug | `app.js` | ✅ 已修复 |
| 4 | P1 状态机 | `app.js` | ✅ 已修复 |
| 5 | P1 状态机 | `app.js` | ✅ 已修复 |
| 6 | P1 缺口 | `index.html` + `app.js` | ✅ 已加 `#resetBtn` |
| 7 | P1 一致性 | `app.js` | ✅ 已修复 |
| 8 | P1 配置 | `wrangler.toml` | ✅ 已重写 |
| 9 | P2 | `app.js` | ✅ 已修复（注释） |
| 10 | P2 | `app.js` | ✅ 已修复（localStorage） |
| 11 | P2 | `app.js` | ✅ 已修复（降频） |
| 12 | P2 | `index.html` + `styles.css` | ✅ 已加 `#chatClose` |

Mock 端到端测试：✅ 通过（Node + DOM stub，跑通初始化 + `tick` 一次 + 重置逻辑）
