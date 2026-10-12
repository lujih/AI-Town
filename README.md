# AI 小镇（Cloudflare Pages 部署版）

一个纯静态的前端页面：Canvas 上的 AI 小镇，包含巡游 NPC、聊天、昼夜循环、经济事件、行为日志。

## 功能

- **城镇地图**：咖啡馆、图书馆、公园、集市、两处住宅，共 6 个 POI
- **8 个 NPC**：四种性格（节俭 / 社交 / 学术 / 冒险），自动在 POI 间巡游
- **点击聊天**：点击 NPC 打开聊天面板，规则式 AI 回复
- **昼夜循环**：8:00 天亮、21:00 天黑，背景渐变 + 夜间蒙层
- **经济系统**：NPC 有金币，在 POI 消费，库存耗尽后补给
- **事件日志**：所有移动 / 消费 / 对话 / 补给都会出现在右侧面板
- **控制**：暂停 / 1x / 2x / 4x 速度

## 本地运行

```bash
# 方案 1：任意静态服务器
npx serve .
# 或
python -m http.server 8080
```

打开浏览器访问对应 URL 即可。

## 部署到 Cloudflare Pages

### 方式 A：Git 仓库（推荐）

1. 把整个目录推到 GitHub / GitLab 仓库
2. Cloudflare Dashboard → Pages → Create a project → 选择 Git provider 并连接仓库
3. Build settings：
   - Build command: `echo 'no build'`（或留空）
   - Build output directory: `.`
   - Framework preset: `Static`
4. 每次 push 自动构建部署

### 方式 B：Wrangler CLI

```bash
npm install -g wrangler
wrangler login
wrangler pages deploy . --project-name=ai-town
```

> 说明：Cloudflare Pages 的构建配置**不走** `wrangler.toml`（那个文件只用于 Workers）。Pages 的构建参数通过 Dashboard 或 CLI 传。本项目的 `wrangler.toml` 仅声明 project name 与 compatibility_date，供本地调试使用。

### 方式 C：直接上传

Cloudflare Dashboard → Pages → Create project → Upload an existing project，选择本目录即可。

## 文件结构

```
.
├── index.html    # 页面骨架
├── styles.css    # 布局 + 配色
├── app.js        # 游戏主逻辑
├── wrangler.toml # 本地调试用（Pages 实际构建参数走 CLI/Dashboard）
└── REVIEW.md     # 代码审查报告
```

## 控制

顶栏按钮：**重置**（回到初始状态）/ **暂停**（模拟时钟）/ **1x → 2x → 4x**（速度循环）。

