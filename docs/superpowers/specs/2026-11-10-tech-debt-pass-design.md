# 设计文档：技术债清理（设置入口 / 日志闸门 / 布局观察器）

日期：2026-11-10
状态：已确认（用户批准「先清技术债 1+2+3」）
版本：v0.39.22 → v0.39.24（三个独立 commit）

## 一、背景

v0.39.x 一路在修「同步漏了一次 / resize 多派了一次 / 观察器死循环」，这些补丁的共同来源是：

1. **伪装态没有设置入口**。`content.css:623` 在 `wre-disguise` 下隐藏了悬浮球，顶栏
   `#wre-gh-avatar`（`catalog.js:450`，`title="Settings"`）却从未绑定点击 ——
   README 宣称的「伪装态内也可点顶栏假头像打开面板」是空的。
2. **info 日志无条件输出**。`log()` 直接 `console.log`，`chrome.js` 每次外观同步都会打一条
   `侧栏留白测量`。伪装主题下「F12 一开满屏 `[Wechat-Reader-Enhancer]`」本身就是暴露面，
   同时带来 `JSON.stringify` 与 I/O 开销。
3. **1 秒轮询强制布局**。`ghStartModeTick`（`lifecycle.js:27`）每秒调 `ghIsDoubleColumn()`
   （含 `getBoundingClientRect`）与 `ghSizeSignature()`（含 `querySelector`），
   只为发现「双栏/滚动切换」与「窗口尺寸变化」——这两件事本来都有事件。

本轮只清这三笔，不新增功能。

## 二、① 伪装态设置入口

### 做法

`#wre-gh-avatar` 点击 → 打开已有的 `#wre-read-settings-modal`（与 FAB 菜单「阅读设置」、
`?` 快捷键说明同一套 UI，不新建第二套设置界面）。

该面板当前缺少伪装态下最常改的两项，补到顶部：

- **伪装视图**：单按钮切换（`#wre-disguise-toggle`），文案
  「伪装已开启 · 点击退出」/「伪装已关闭 · 点击进入」。
- **伪装皮肤**：GitHub / Notion 分段按钮（`#wre-skin-toggle`，复用 `.wre-theme-toggle`
  + `.wre-btn-small` + `.wre-theme-active` 选中态样式，不新增 CSS 类）。

两项都走 `WRE_STATE` + `saveState()`，与 popup 双向同步。

### 为什么不学真 GitHub 做头像下拉菜单

真 GitHub 的头像菜单只能放英文装饰项：放中文（「沉浸模式」）一眼露馅，只放英文又无法表达
「切皮肤」。而「用户主动打开自己的设置面板」与现有 `?` 快捷键弹中文帮助是同一级暴露面，
不值得为它多造一层假菜单。

### 状态回写

`ghApplyStateFromStorage`（popup 改设置 → 阅读页实时生效）在 `skin` / `disguise` 分支里
同步刷新面板按钮态，避免「popup 切了皮肤、面板还高亮着旧的」。

## 三、② 日志闸门

`log()` 的 info 级默认静默，**warn / error 始终输出**（排查能力不丢）。约 60 处
`log('info', …)` 调用无需改动。

开启方式：URL 追加 `#wre-debug`（与已有的 `#wre-off` 逃生开关同一族，不占 UI）：

```js
const WRE_DEBUG = /(^|[#&])wre-debug\b/.test(location.hash);
function log(level, message, meta) {
  if (level === 'info' && !WRE_DEBUG) return;
  ...
}
```

提前 return 同时省掉 `JSON.stringify(meta)`。

## 四、③ ResizeObserver 替 1 秒轮询

### 做法

1. 新增 `ghEnsureLayoutObservers()`：一个 `ResizeObserver` 观察
   `documentElement` / `.wr_canvasContainer canvas` / `.readerChapterContent` / `.app_content`
   中当前存在的元素（用 Set 记录已观察对象，节点重建后补观察、旧节点出列）。
2. 回调 rAF 合并后调 `ghSyncChrome()` —— 它内部已有状态签名与尺寸签名去重，天然幂等。
3. 每次 `ghSyncChromeInner` 开头调一次 `ghEnsureLayoutObservers()`：节点被微信读书重建时，
   下一次任意同步就能补上观察。
4. 删除 `ghStartModeTick` / `ghStopModeTick` / `ghModeTick` / `ghLastDoubleFlag`。
5. `ResizeObserver` 不存在（旧内核 / jsdom）时直接跳过，退化为原有的事件路径
   （`resize` 监听 + MutationObserver 已在）。

### 兜底（防「尺寸没变但没有观察目标」）

`.readerContent` 的 MutationObserver 回调里补一次 `ghEnsureLayoutObservers()`（幂等）；
另保留一个 **2 秒低频挂载 tick**，只在「还没观察到 canvas」时运行、只做
`document.querySelector('.wr_canvasContainer canvas')` 判断（不量 rect、不读 Range），
观察到 canvas 后立即停表。这样「切双栏 → canvas 出现」即使没有触发任何尺寸变化，
最迟 2 秒内也能被发现，而不再有每秒一次的强制布局。

## 五、不变量

- 不新增权限、不引入联网、不搬动微信读书 DOM 节点。
- 不改变伪装视觉与阅读体验；面板新增两项沿用现有样式 token。
- 关闭伪装（G）时观察器与 tick 一并停掉，不留后台开销。

## 六、验收

1. 伪装态点右上角头像 → 设置面板弹出；点「伪装已开启」立刻退出伪装，点「GitHub / Notion」
   皮肤立刻整体重建（标题、图标、侧栏同步）。
2. popup 改皮肤/伪装开关后，阅读页面板按钮态同步。
3. 控制台默认只有 warn / error；`#wre-debug` 后恢复全部 info。
4. 拖窗口 / 切双栏 / 切滚动 / 换章：侧栏留白、分页条对齐、正文卡片表现与改造前一致。
5. `/tmp/domtest` 的 jsdom harness 按 manifest 顺序加载无报错（`ResizeObserver` 打桩）。

## 七、提交拆分

| # | 版本 | commit |
|---|------|--------|
| 1 | v0.39.22 | `fix: 伪装态顶栏头像打开设置面板；面板补伪装开关与皮肤切换` |
| 2 | v0.39.23 | `perf: info 日志默认静默（#wre-debug 开启）` |
| 3 | v0.39.24 | `perf: ResizeObserver 替掉 1s 布局轮询（保留 canvas 缺失时 2s 挂载兜底）` |

最后一并 `python3 pack.py`。
