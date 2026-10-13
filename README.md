# AI 小镇（Cloudflare Pages 部署版）

一个纯静态的前端页面：Three.js 低多边形 3D 小镇。NPC 会自己在镇上巡游、偶遇、闲聊、打工、消费，性格随行为慢慢变化；你是镇长，可以给居民定目标、装点小镇，刷新页面世界也不会丢。

## 功能

- **3D 小镇**：等轴斜俯视低多边形场景（Three.js WebGL），含 6 栋建筑、道路、树木、路灯
- **昼夜循环**：太阳方位/强度/颜色随时间变化，天空色渐变，夜间路灯自动点亮，全视口蒙层压暗
- **8 个 NPC**：四种性格基底，各有职业，自动在 POI 间巡游、到店停留、再出发
- **NPC 社交（A1）**：居民在路上碰面会自己聊起来——性格合得来就寒暄，聊不来就擦肩而过；有目标的居民会把打算讲给对方听
- **性格漂移（B1）**：每个居民有社交 / 节俭 / 好奇三轴倾向，随行为慢慢变化，跨天小幅回归基准。名册上能看见实时进度条
- **NPC 记忆（B2）**：居民记得你说过的话，也记得自己遇到过谁。问"还记得吗"它会复述
- **点击聊天**：点击 3D 场景中的 NPC（射线命中身体任意部位）或名册条目打开聊天，规则式 AI 回复
- **今日目标**：给单个 NPC 设定目标（攒钱 / 多交朋友 / 去某地…），关键词解析成行为偏好；"赚钱"会真的去打工
- **经济系统**：NPC 有金币（上限 999），在 POI 消费或打工赚金币，库存每 2 游戏小时补货
- **小镇事件（B3）**：随机触发集市大集 / 下雨 / 小镇节日 / 远方来客，真实改变全镇行为概率
- **镇长（A3）**：首次交互时留下昵称。镇长面板记录任期、聊天、定目标、见证时刻与装饰数
- **小镇装饰（A4）**：花小镇资金放置花坛 / 长椅 / 路灯 / 喷泉 / 雕像，居民路过时会点评
- **关系网络（B4）**：Canvas 环形图展示居民之间的友好/摩擦关系，线粗=聊得多
- **世界持久化（A2）**：自动存档到 localStorage，刷新/关页面后世界原样恢复
- **事件日志**：所有移动 / 消费 / 打工 / 偶遇 / 对话 / 补货都进底部字幕条与全量日志
- **小镇名人榜**：按天活跃分（消费 + 社交 + 聊天 + 到达加权）排序，前三名配色
- **控制**：暂停 / 1x / 2x / 4x 速度 / 重置，速度选择持久化到 localStorage

## 推送代码到 GitHub

```bash
bash push.sh
```

`push.sh` 会自动检查网络、密钥、认证，然后推送。

**本机环境有两个已处理好的坑**（换机器需重新配置）：

1. **`github.com:22` 在部分网络下被阻断** —— 已改为走 `ssh.github.com:443`。
2. **`$HOME` 与 `/etc/passwd` 记录的家目录不一致** —— ssh 只认后者，读不到 `~/.ssh/config`。
   因此用 `~/.ssh/git-ssh.sh` 包装脚本以 `-o` 显式传参绕过，仓库的 `core.sshCommand` 已指向它。

首次在新机器配置：

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub      # 复制到 https://github.com/settings/keys
git remote set-url origin git@github.com:lujih/AI-Town.git
git config core.sshCommand "$HOME/.ssh/git-ssh.sh"
```

## 本地运行

```bash
# 方案 1：任意静态服务器
npx serve .
# 或
python -m http.server 8080
```

打开浏览器访问对应 URL 即可。

> 注意：`app.js` 通过 importmap 从 CDN 加载 Three.js（`three@0.160.0`），
> 因此**需要网络连接**才能看到 3D 场景。HUD / 抽屉 / 字幕条等 DOM 部分不受影响。

## 部署到 Cloudflare Pages

### 方式 A：Git 仓库（推荐）

1. 把整个目录推到 GitHub / GitLab 仓库
2. Cloudflare Dashboard → Workers & Pages → Create application → **Pages** → Import an existing Git repository
3. Set up builds and deployments：

   | 配置项 | 值 |
   |--------|-----|
   | Production branch | `main` |
   | Framework preset | 不选（留空） |
   | Build command | `exit 0`（或留空） |
   | Build output directory | 留空（默认仓库根目录） |

   > 说明：Cloudflare Pages 的 "Framework presets" 是一份**具体框架列表**（React/Vite、Next.js、Nuxt、Astro、Vue、Hugo…，见 [Build configuration 文档](https://developers.cloudflare.com/pages/configuration/build-configuration/#framework-presets)），里面**没有 "Static" 这一项**——纯静态站直接留空即可。官方建议：不选预设时 Build command 填 `exit 0`，这样后续还能用 Pages Functions；Build output directory 对单仓库填根目录（留空默认）。详见 [Static HTML 指南](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)。

4. 每次 push 自动构建部署

### 方式 B：Wrangler CLI

```bash
npm install -g wrangler
wrangler login
wrangler pages deploy . --project-name=ai-town
```

> 说明：Cloudflare Pages 的构建配置**不走** `wrangler.toml`（那个文件只用于 Workers）。Pages 的构建参数通过 Dashboard 或 CLI 传。本项目的 `wrangler.toml` 仅声明 project name 与 compatibility_date，供本地调试使用，**不参与 Pages 部署**。

### 方式 C：直接上传

Cloudflare Dashboard → Pages → Create project → Upload an existing project，选择本目录即可。

## 文件结构

```
.
├── index.html            # 页面骨架（HUD / 字幕条 / 抽屉 / 关系图）
├── styles.css            # 布局 + 配色（暮色小镇调色板）
├── app.js                # 入口：装配三层 + 主循环（113 行）
├── simulation.js         # 模拟层：世界状态 + 全部规则，不依赖 three/DOM（727 行）
├── world3d.js            # 渲染层：Three.js 场景/相机/光照/网格/拾取（508 行）
├── ui.js                 # UI 层：HUD/字幕条/抽屉/气泡/关系图（492 行）
├── wrangler.toml         # 本地调试用（Pages 实际构建参数走 CLI/Dashboard）
├── DESIGN.md             # 视觉设计与玩法设计文档（含四轮演进）
├── REVIEW.md             # 早期代码审查报告（2D 阶段）
├── AUDIT-2026-10-14.md   # 全面审查 + 修复记录（3D 阶段）
├── BENCHMARK-2026-10-14.md  # 同类产品对标与改进建议
├── DESIGN-UI-2026-10-14.md  # 前端设计审查与优化（字阶/结构语言/动效/多端）
└── .git/                 # Git 仓库
```

## 控制

左上 HUD：**⏸ / ▶**（暂停 / 继续）、**1x → 2x → 4x**（速度循环）、**↺**（重置）。

右下角「居民」把手滑出抽屉，含五个 Tab：

| Tab | 内容 |
|-----|------|
| **居民** | 名册：性格色、职业、金币、三轴性格进度条；点击定位并开聊 |
| **聊天** | 对话 + 今日目标输入 |
| **经济** | 全镇金币 / 小镇资金 / 各 POI 库存单价 + 小镇名人榜 |
| **关系** | 居民关系网络图（友好/摩擦，线粗=交互次数） |
| **镇长** | 任期统计 + 装饰放置（选装饰 → 点地面空地） |

底部字幕条显示最近 3 条事件，点 **⌄** 展开全量日志。顶部横幅播报进行中的小镇事件。

**键盘**：Esc 关闭抽屉（焦点自动归还）/ Esc 取消放置 / 名册内 ↑↓ 移动、Enter 开聊。

## 界面说明

- **多端**：桌面右侧抽屉、平板与手机竖屏底部抽屉、手机横屏回右侧（避免遮挡时钟）。触摸设备交互目标 ≥44px，NPC 拾取范围放宽。
- **动效**：只在首次进入播一次"拂晓"揭幕（刷新不重播）。其余动效只响应用户动作。系统开启"减少动态效果"时全部关闭。
- **可访问性**：全站对比度 ≥AA，焦点可见，`prefers-reduced-motion` 全域生效，气泡不打扰读屏器（另设只播报重大事件的朗读区）。

## 已知限制

- 3D 场景依赖 CDN 加载 Three.js，离线时只有 DOM 界面可见
- NPC 行为与聊天回复均为规则式（无 LLM），这是"无后端、可静态部署"的定位选择
- 存档存在 localStorage，换浏览器/清缓存会丢；localStorage 容量约 5MB，当前存档约 6KB，无压力
- 未做窄屏竖屏之外的深度移动端适配（相机已自适应，但抽屉交互仍以桌面为先）
