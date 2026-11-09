# GitHub 伪装视图（摸鱼模式重构）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把插件从「沉浸式阅读增强」重构为「微信读书阅读页伪装成 GitHub 仓库页」，仅保留伪装视图 + 正文背景色切换 + 设置记忆 + G 键快切。

**Architecture:** 单 content script 全量重写（`content.js` 2300 行 → ~900 行）。伪装骨架全部由插件注入 fixed 定位层（顶栏/头部条/侧栏/file-head），微信读书原生 DOM 不搬动，靠 `<html class="wre-disguise">` 一个开关统一隐藏与重绘样式，规避 SPA reconcile 风险。状态沿用 `wreState` chrome.storage 单键。

**Tech Stack:** Chrome MV3 content script、原生 DOM/CSS、chrome.storage.local。无构建步骤、无测试框架——验证方式为浏览器加载 + 手动冒烟清单（spec §五）。

**Spec:** `docs/superpowers/specs/2026-11-09-github-disguise-design.md`

---

### Task 1: content.js 重写为精简核心（状态/存储/日志/键盘守卫）

**Files:**
- Rewrite: `content.js`

- [ ] **Step 1: 写入新的 content.js 骨架**

保留并简化自旧版：`log`（含 DEBUG 开关方式不变）、`loadState`/`saveState`、`isReaderPage`、`detectScrollMode`（精简为 `.readerControls_item.isHorizontalReader` 取反）、`waitNextFrame`、键盘守卫（isTrusted/输入框/组合键/isComposing 判断）。新状态：

```js
const WRE_STORAGE_KEYS = { state: 'wreState' };
const WRE_DEFAULT_STATE = {
  disguise: true, // 伪装总开关
  bgIdx: 0,       // 正文背景色档位（GITHUB_BG_COLORS 索引）
};
```

- [ ] **Step 2: 浏览器加载验证**
  Chrome `chrome://extensions` 重新加载插件，打开微信读书阅读页，console 无报错、无 UI 注入（此步 UI 尚未重建）。

- [ ] **Step 3: Commit**
  `git add content.js && git commit -m "refactor: 重写 content.js 为摸鱼模式精简核心"`

### Task 2: 背景色 16 档（GitHub 语义化）+ 应用逻辑

**Files:**
- Modify: `content.js`（背景色段）
- Modify: `content.css`（清掉旧 token/沉浸/滚动条样式，保留面板用得到的少量类）

- [ ] **Step 1: 定义 GITHUB_BG_COLORS（16 档）**

```js
// 首档浅色 = GitHub Light 内容区，首档深色 = GitHub Dark 内容区（#0d1117）
// rgb: 正文区背景；text: 配套文字色；code: 伪装语义下的档位分组名
const GITHUB_BG_COLORS = [
  { name: 'GitHub 白',  rgb: '#ffffff', text: '#1f2328', type: 'light' },
  { name: 'Claude 暖白', rgb: '#FAF5EE', text: '#333333', type: 'light' },
  { name: 'Claude 米杏', rgb: '#F0E6D3', text: '#333333', type: 'light' },
  { name: 'Claude 浅棕', rgb: '#E8DCC8', text: '#333333', type: 'light' },
  { name: 'Kami 纸白',  rgb: '#f5f4ed', text: '#333333', type: 'light' },
  { name: '书页灰',     rgb: '#DFDDD6', text: '#333333', type: 'light' },
  { name: '蜜桃珊瑚',   rgb: '#F9E5DB', text: '#333333', type: 'light' },
  { name: '草香',      rgb: '#F5F8F3', text: '#333333', type: 'light' },
  { name: 'GitHub 暗',  rgb: '#0d1117', text: '#e6edf3', type: 'dark' },
  { name: '暗夜黑',     rgb: '#1a1a2e', text: '#d4d4d4', type: 'dark' },
  { name: '深墨蓝',     rgb: '#16213e', text: '#d4d4d4', type: 'dark' },
  { name: '青夜',      rgb: '#2A363F', text: '#d4d4d4', type: 'dark' },
  { name: '暗蓝灰',     rgb: '#1e2d3d', text: '#d4d4d4', type: 'dark' },
  { name: '墨黛蓝',     rgb: '#1a2a2e', text: '#d4d4d4', type: 'dark' },
  { name: '暗橄榄',     rgb: '#1e2319', text: '#d4d4d4', type: 'dark' },
  { name: '暮云灰',     rgb: '#252228', text: '#d4d4d4', type: 'dark' },
];
```

- [ ] **Step 2: applyBgColor()**

把 `--wre-gh-content-bg` / `--wre-gh-content-text` 两个 CSS 变量写到 `<html>`（`document.documentElement.style.setProperty`）。伪装样式（Task 4）全部通过这两个变量取色，因此应用/切档只需改变量，零重排逻辑。无「系统默认」档（首档即 GitHub 白/暗）。

- [ ] **Step 3: cycleBgTheme(delta) / setBgIdx(idx)**

对全 16 档循环（不分深浅组），写 `WRE_STATE.bgIdx` 持久化 + 更新变量 + 更新面板 UI。

- [ ] **Step 4: Commit**
  `git commit -m "feat: 背景色 16 档（GitHub 语义化）与变量化应用"`

### Task 3: 伪装骨架 DOM + CSS

**Files:**
- Modify: `content.js`（伪装段）
- Modify: `content.css`（伪装样式主体，~400 行）

- [ ] **Step 1: ensureDisguiseShell()**

注入 `wre-gh-shell`（`document.body.appendChild`，已存在则跳过）：

- `#wre-gh-topbar`：GitHub 深色顶栏（h=48, #24292f）——内联 SVG 八爪 logo 占位、假搜索框（"Type / to search"）、右侧图标组 + **齿轮按钮（真功能：打开设置面板）**。
- `#wre-gh-header`：浅色条（#f6f8fa, 底部 1px 边框）——面包屑 `repo书名 / src / public / 章节名.md`（章节名从 `.readerTopBar_title_chapter` 读取，取不到则显示 `README.md`）+ Code/Issues/Pull requests 假页签。
- `#wre-gh-sidebar`：左侧伪文件树（w=296px）——`.wre-gh-crumb` 仓库头（头像方块 + 书名 / Public）、搜索输入装饰、静态假文件列表（README.md、src/、docs/、package.json、LICENSE，带 SVG 文件/文件夹图标装饰，点击无动作）。
- `#wre-gh-file-head`：文件头条（章节名.md · N Lines · 装饰按钮 Raw/Copy），N = 正文字符数粗估。
- `#wre-gh-toast`：底部居中 toast（双栏提示等复用）。

- [ ] **Step 2: content.css 伪装样式**

全部选择器以 `html.wre-disguise` 为前缀（一个 class 控制总开关）：

- 隐藏微信读书原生 UI：`.readerTopBar, .readerControls, .readerBottomBar, .readerFooter, .wr_horizontalReader` 等 `display: none !important`。
- `body` 铺 GitHub 页底色 `#f6f8fa`；`.readerContent/.app_content` 重绘为 Markdown 区：`max-width: 1012px; margin: 24px auto; background: var(--wre-gh-content-bg); color: var(--wre-gh-content-text); border: 1px solid #d0d7de; border-radius: 6px; padding: 32px 40px;`（GitHub 字体栈 `-apple-system, "Segoe UI", ...`）。
- 正文段落排版对齐 GitHub Markdown：`line-height: 1.6; font-size: 16px; p { margin: 0 0 16px; } h1/h2 { border-bottom: 1px solid #d8dee4; padding-bottom: .3em; } a { color: #0969da; }`。
- 顶栏 `position: fixed; top:0; left:0; right:0; z-index: 2147483000`，body 加 `padding-top` 补偿；侧栏 `position: fixed; top: 48px; bottom: 0; width: 296px; overflow-y: auto; background: #ffffff; border-right: 1px solid #d0d7de`；内容区 `margin-left: 296px`（通过 `.readerContent` 外层容器或 body padding 实现，以实测布局为准调整选择器）。
- 深色档联动：`--wre-gh-content-bg` 为深色时侧栏/头部条仍保持 GitHub Light 皮肤（正文区色块独立，就像 GitHub 里嵌了一个深色编辑器预览，不露馅）。

- [ ] **Step 3: applyDisguise() / removeDisguise()**

```js
function applyDisguise() {
  if (isDoubleColumnMode()) { showGhToast('伪装视图仅支持滚动模式'); return; }
  document.documentElement.classList.add('wre-disguise');
  ensureDisguiseShell();
  updateGhBreadcrumb();     // 书名/章节名
  applyBgColor();           // 变量已就绪
  startDisguiseWatching();  // Task 4
}
function removeDisguise() {
  document.documentElement.classList.remove('wre-disguise');
  // 骨架 DOM 保留在 body 里（display:none 由 class 前缀控制），切换零成本
}
function toggleDisguise() {
  WRE_STATE.disguise = !WRE_STATE.disguise;
  saveState();
  WRE_STATE.disguise ? applyDisguise() : removeDisguise();
}
```

- [ ] **Step 4: Commit**
  `git commit -m "feat: GitHub 伪装骨架（顶栏/面包屑/侧栏/file-head）与 markdown 重绘"`

### Task 4: 生命周期（轮询就绪 / SPA 重建跟随 / 章节切换）

**Files:**
- Modify: `content.js`

- [ ] **Step 1: 就绪轮询 initDisguise()**

复用旧版 `.readerContent` 轮询模式（500ms × 120 次）：正文节点出现后才 `applyDisguise()`；双栏模式直接不注入。伪装关闭则只挂键盘监听。

- [ ] **Step 2: startDisguiseWatching()**

单个 `MutationObserver` 观察 `.readerContent`（childList+subtree, 400ms 防抖）：
- 章节标题/正文变化 → `updateGhBreadcrumb()` + `updateGhFileHead()`（行数刷新）；
- 伪装态下微信读书重建正文节点 → 重应用 markdown 区选择器样式（样式在 CSS 层，理论上不需要重跑；面包屑必须刷新）。

- [ ] **Step 3: 键盘 G**

`handleAllKeyboard` 只剩 G（守卫沿用旧版）：`toggleDisguise()`。

- [ ] **Step 4: init() 收口**

```js
async function init() {
  await loadState();
  applyBgColor();
  if (!isReaderPage()) return;          // 非阅读页（书城等）不注入任何东西
  createUI();                            // 迷你设置面板（隐藏，齿轮唤出）
  document.addEventListener('keydown', handleAllKeyboard);
  initDisguise();                        // 轮询就绪后按 WRE_STATE.disguise 应用
}
```

- [ ] **Step 5: Commit**
  `git commit -m "feat: 伪装生命周期（就绪轮询/SPA 跟随/G 键快切）"`

### Task 5: 迷你设置面板 + manifest/locales

**Files:**
- Modify: `content.js`（createUI 缩为齿轮面板：伪装开关 + 背景色 ‹ › + 恢复默认）
- Modify: `content.css`（面板样式沿用旧 wre-modal 体系，删无关类）
- Modify: `manifest.json`（version → 0.34.0）
- Modify: `_locales/zh_CN/messages.json`、`_locales/en/messages.json`（名称改中性「GitHub Reader」，描述改伪装阅读定位）

- [ ] **Step 1: createUI() 重写** —— 面板常驻 DOM（齿轮点击 `wre-visible` 弹出），含：伪装开关按钮（开/关文案随状态）、背景色行（‹ 色块 名称 ›，复用旧 updateBgThemeUI 逻辑改新数据源）、恢复默认（disguise=true, bgIdx=0）。
- [ ] **Step 2: manifest + locales 更新**，popup.js 不动。
- [ ] **Step 3: Commit**
  `git commit -m "feat: 迷你设置面板与品牌信息更新 (v0.34.0)"`

### Task 6: 全量冒烟 + 打包

**Files:**
- 无新文件；`python3 pack.py` 出包验证。

- [ ] **Step 1: 手动冒烟（spec §五 7 条逐一过）** —— 加载重载插件 → 滚动模式自动伪装 → G 切回/切回 → 齿轮面板开 关/背景色/恢复默认 → 深色档观感 → 双栏 toast → 章节切换面包屑跟随 → 刷新后状态保持。
- [ ] **Step 2: pack.py 打包通过**。
- [ ] **Step 3: Commit（如有修补）+ 汇报。**
