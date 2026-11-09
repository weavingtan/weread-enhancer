# 设计文档：GitHub 伪装视图（摸鱼模式重构）

日期：2026-11-09
状态：已确认（用户批准）
版本目标：v0.34.0

## 一、背景与产品定位

插件原定位是「沉浸式阅读增强」（屏占比、自动阅读、滚动增强、沉浸模式等）。
用户逐轮收敛后明确：**这个插件就是为了上班摸鱼看书**——把微信读书阅读页伪装成
GitHub，让旁人以为在看代码仓库。原有的阅读增强功能全部与该目标无关，砍掉。

新定位一句话：**微信读书阅读页默认就是 GitHub 代码仓库页的样子；支持正文背景色切换。**

## 二、砍掉清单（全部删除相关代码）

- 沉浸模式（applyImmersive / ensureImmersiveTrigger / 边缘唤出 / 快捷键 I）
- 屏占比调节（applyScreenRatio / buildRatioCSS / primeScreenBasePx / updateScreenRatioUI）
- 自动阅读（startAutoRead / findScrollTarget / scrollTargetBy 全家 + 快捷键 Space）
- 滚动增强（自定义滚动条 wreCustomScrollbar / wre-show-scrollbar / updateCustomScrollbar）
- 悬浮工具栏浮动逻辑（applyToolbarFloating / ensureToolbarTrigger / pinTopBar / pinControls）
- 全屏（toggleFullscreen / handleFullscreenChange / 快捷键 F）
- 快捷键帮助弹窗（? 键 / wre-shortcuts-modal）
- 插件 UI 外观档（theme light/dark/auto、applyTheme、watchSystemTheme、data-wre-theme）
- 正文主题色的 Canvas 相关逻辑（forceCanvasRedraw、healReaderCanvases 像素自愈、
  colorObserver 内联文字色反击、双栏 buildBgCss 分支、clearPluginTextColors）
- 官方划线层重排（scheduleUnderlineLayerReflow 全家）
- 悬浮球 FAB（伪装成 GitHub 的页面上不该有可疑的悬浮球）
- _locales 里旧的名称/描述 → 改为中性新定位

## 三、保留清单

1. **GitHub 伪装视图**（新增，核心）
2. **正文背景色**（改造：16 档预设的色值与 ‹ › 循环 UI 保留，应用对象改为伪 Markdown
   正文区；浅色档 ≈ GitHub Light，深色档 ≈ GitHub Dark，深色在伪装语义下同样合理。
   记忆简化为单一 `bgIdx`，不再按系统深浅色分键——伪装视图有自己独立的配色体系，
   与微信读书 body class 无关。首个浅色档 = GitHub 白 `#ffffff`，首个深色档 = GitHub 暗 `#0d1117`）
3. **设置记忆**（chrome.storage 读写骨架 loadState/saveState 保留）
4. **G 键**：伪装 ↔ 微信读书原样 一键切换（持久化，与设置开关同状态）
5. **popup.html/js**：不动（仅版本号与好评链接，无伪装暴露面）

## 四、伪装视图设计

### 4.1 结构（不移动微信读书正文节点）

伪装骨架全部是插件注入的 `position: fixed` / 铺满层，微信读书原生 DOM 不搬动、
不重排，只靠 CSS 隐藏与重绘样式 —— 最大限度规避 SPA（React/Vue）reconcile
把搬走的节点重建到外壳外面的风险。

```
+--------------------------------------------------------------+
| wre-gh-topbar（GitHub 深色顶栏 h=48：logo、假搜索框、图标、齿轮=设置入口）|
+--------------------------------------------------------------+
| wre-gh-header（浅色条：面包屑 user/repo/src/章节名.md + Code/Issues 假页签）|
+------------------+-------------------------------------------+
| wre-gh-sidebar   |  wre-gh-file-head（章节名.md · N lines）   |
| 伪文件树         |  +-------------------------------------+ |
| （装饰性假文件   |  |  .readerChapterContent              | |  ← 微信读书真实正文
|  README/src 等， |  |  （套 GitHub Markdown 样式：白底、   | |    重绘为 Markdown 区
|  纯展示不跳转）  |  |  #1f2328 字色、边框、圆角、1012px 栏）| |
+------------------+-------------------------------------------+
```

- 微信读书原生 UI（顶栏、右侧控制条、底部进度、目录按钮等）在伪装态下
  `display: none !important`（独立 class `wre-disguise` 挂 `<html>` 上，一个开关全控）。
- 正文区：对 `.readerChapterContent`（滚动模式）应用 GitHub Markdown 排版。
- 背景色档位只作用于 Markdown 正文区（CSS 变量 `--wre-gh-content-bg` / 文字色按
  深浅档配套）。
- 面包屑 / file-head 的章节名取自 `.readerTopBar_title_chapter`，MutationObserver
  跟随章节切换刷新。
- 侧栏假文件树为静态装饰（README.md、src/、package.json 等），点击无动作。

### 4.2 开关与状态

```
WRE_DEFAULT_STATE = {
  disguise: true,   // 伪装总开关（默认开——打开阅读页即是伪装态）
  bgIdx: 0,         // 正文背景色档位（16 档循环）
}
```

- 设置面板：顶栏右侧**齿轮图标**（GitHub header 真实存在的元素，零暴露）→ 弹出
  迷你面板：伪装开关 + 背景色 ‹ › 循环。面板沿用现有 wre-modal 样式体系。
- G 键：随时切换伪装 ↔ 原样（输入框聚焦 / 组合键不触发，沿用现有键盘守卫逻辑）。
- 两处改同一状态，均持久化。

### 4.3 模式约束与降级

- **修订（2026-11-09，实测用户默认使用双栏翻页）**：两种模式都伪装。
  滚动模式正文重绘为 Markdown 卡片；双栏模式（Canvas 正文无法重排）把
  `.wr_horizontalReader` 整体摆进白底文件卡片，隐藏页码/翻页器，翻页用 ← → 键；
  容器尺寸变化后派发 resize 让微信读书按新尺寸重渲染 Canvas。
- 伪装开启但正文节点未就绪：轮询等待（复用现有 `.readerContent` 轮询模式），
  超时则保持原样不伪装（fail-safe，绝不出现半伪装破页面）。
- SPA 章节/DOM 重建：观察正文容器，重建后重应用 Markdown 样式与面包屑。
- 伪装关闭态 = 微信读书原生页面（不做任何增强），保证「真想看书」时干净。

### 4.4 不变量

- 不引入任何联网请求（GitHub 样式全部内嵌手写 CSS，logo 用内联 SVG 占位）。
- 不新增权限（仍只有 storage）。
- 选中/复制/官方划线等正文原生行为不受影响（未搬动节点）。

## 五、验收

1. 打开微信读书滚动模式阅读页 → 自动呈现 GitHub 仓库页样子；远观无微信读书痕迹。
2. G 键一键切回微信读书原样，再按切回；状态刷新后保持。
3. 齿轮 → 面板：伪装开关、背景色 ‹ › 循环均生效且记忆。
4. 深色背景档下正文区为 GitHub Dark 观感；退出伪装后微信读书原生外观无残留。
5. 双栏模式下不伪装，toast 提示。
6. 章节切换后面包屑 / file-head 跟随更新。
7. `pack.py` 打包正常，manifest 版本号更新。
