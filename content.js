const WRE_PREFIX = '[Wechat-Reader-Enhancer]';
const WRE_STORAGE_KEYS = {
  state: 'wreState',
};
const WRE_DEFAULT_STATE = {
  screenRatio: 80,
  screenBasePx: null,
  screenBaseMode: 'container-v1',
  autoRead: {
    enabled: false,
    speed: 50,
    direction: 'down',
  },
  // 沉浸模式：隐藏顶部工具栏 / 右侧控制条 / 底部进度条（边缘唤出）
  immersiveMode: false,
  // GitHub 伪装开关（叠加在沉浸式之上，G 键切换）
  disguise: true,
  // 伪装皮肤：github（代码仓库） / notion（团队文档）
  skin: 'github',
  // 正文主题色：按系统深浅色分键记忆（weread-plus 移植；0=浅色清单首个「系统默认」，8=深色清单首个「系统默认」）
  bgLightIdx: 0,
  bgDarkIdx: 8,
  // 插件自身界面外观档位（light 浅色 / dark 深色 / auto 跟随系统）
  theme: 'auto',
};

let WRE_STATE = { ...WRE_DEFAULT_STATE };
let wreStyleTag = null;
let wreRoot = null;
let lastReflowAt = 0;
let lastPreviewLogAt = 0;
let wreUnderlineReflowObserver = null;
let wreUnderlineReflowTimer = null;
let wreUnderlineReflowFired = false;

// 自动阅读状态
let autoReadTimer = null;
let autoReadIsInterval = false; // true=setInterval, false=rAF

// 全屏状态追踪
let wreFullscreenPreviousRatio = null; // 进入全屏前的屏占比，退出时恢复

function clampNumber(value, min, max) {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function scheduleWereadLayoutReflow(reason) {
  const now = Date.now();
  if (now - lastReflowAt < 120) {
    return;
  }
  lastReflowAt = now;
  window.setTimeout(() => {
    triggerWereadLayoutReflow(reason);
  }, 0);
}

function triggerWereadLayoutReflow(reason) {
  try {
    void document.body?.offsetHeight;
    // 只派发 resize：orientationchange 会让微信读书当成「设备旋转」走一遍完整重排，
    // 视觉上就是页面内容整块闪一下（用户感知为「又刷新了一次」）。
    window.dispatchEvent(new Event('resize'));
    log('info', '已触发页面重排', { reason });
  } catch (error) {
    log('warn', '触发页面重排失败', { reason, error: String(error) });
  }
}

// 官方划线层（.wr_underline_wrapper）在正文之后才渲染，且只在 resize 时按当前宽度重算坐标。
// 插件改过正文宽度后，如果划线层先于/晚于这次重排渲染，就会出现「打开书籍划线错位、刷新才正常」。
// 这里等划线层真正出现后再补一次重排，让官方按插件宽度重新计算划线坐标。
function scheduleUnderlineLayerReflow(reason) {
  if (wreUnderlineReflowObserver) {
    wreUnderlineReflowObserver.disconnect();
    wreUnderlineReflowObserver = null;
  }
  if (wreUnderlineReflowTimer) {
    clearTimeout(wreUnderlineReflowTimer);
    wreUnderlineReflowTimer = null;
  }
  wreUnderlineReflowFired = false;

  const fire = (tag) => {
    if (wreUnderlineReflowFired || !getPrimaryContentElement()) {
      return;
    }
    wreUnderlineReflowFired = true;
    if (wreUnderlineReflowObserver) {
      wreUnderlineReflowObserver.disconnect();
      wreUnderlineReflowObserver = null;
    }
    if (wreUnderlineReflowTimer) {
      clearTimeout(wreUnderlineReflowTimer);
      wreUnderlineReflowTimer = null;
    }
    scheduleWereadLayoutReflow(`${reason}:${tag}`);
    // 官方划线层可能分多帧铺开，再补一次即可（原来还补到 2500ms，一天三次 resize 会连闪三下）
    window.setTimeout(() => scheduleWereadLayoutReflow(`${reason}:${tag}-late1`), 700);
  };

  if (document.querySelector('.wr_underline_wrapper')) {
    fire('already');
    return;
  }

  wreUnderlineReflowObserver = new MutationObserver(() => {
    if (document.querySelector('.wr_underline_wrapper')) {
      fire('underline-ready');
    }
  });
  wreUnderlineReflowObserver.observe(document.body, { childList: true, subtree: true });

  // 兜底：划线少 / 加载慢时也补一次重排
  wreUnderlineReflowTimer = window.setTimeout(() => fire('fallback'), 8000);
}


function log(level, message, meta) {
  const printable = meta ? `${WRE_PREFIX} ${message} ${JSON.stringify(meta)}` : `${WRE_PREFIX} ${message}`;
  if (level === 'error') {
    console.error(printable);
  } else if (level === 'warn') {
    console.warn(printable);
  } else {
    console.log(printable);
  }
}

async function loadState() {
  try {
    const result = await chrome.storage.local.get([WRE_STORAGE_KEYS.state]);
    log('info', '初始化读取存储状态', {
      hasState: Boolean(result[WRE_STORAGE_KEYS.state]),
      storedScreenRatio: result[WRE_STORAGE_KEYS.state]?.screenRatio || null,
    });
    if (result[WRE_STORAGE_KEYS.state]) {
      WRE_STATE = { ...WRE_DEFAULT_STATE, ...result[WRE_STORAGE_KEYS.state] };
    }
    if (WRE_STATE.screenBaseMode !== WRE_DEFAULT_STATE.screenBaseMode) {
      WRE_STATE.screenBaseMode = WRE_DEFAULT_STATE.screenBaseMode;
      WRE_STATE.screenBasePx = null;
      await chrome.storage.local.set({ [WRE_STORAGE_KEYS.state]: WRE_STATE });
    }
  } catch (error) {
    console.warn(`${WRE_PREFIX} 加载状态失败`, error);
  }
}

async function saveState() {
  try {
    await chrome.storage.local.set({ [WRE_STORAGE_KEYS.state]: WRE_STATE });
    log('info', '已保存插件状态', { screenRatio: WRE_STATE.screenRatio });
  } catch (error) {
    log('error', '保存插件状态失败', { error: String(error) });
  }
}

function getPrimaryContentElement() {
  return document.querySelector('.readerChapterContent');
}

function getReaderContainerElement() {
  return document.querySelector('.readerChapterContent_container');
}

function waitNextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function measureDefaultBaseWidthPx() {
  // 基准取 .readerChapterContent_container 自身的宽度：它不受屏占比 CSS 影响（CSS 只作用于
  // .readerChapterContent / .app_content）。不再临时清空 styleTag，避免启动瞬间正文宽度反复
  // 变化，导致官方按错误宽度排版、划线层坐标随之错位。
  const container = getReaderContainerElement();
  if (!container) {
    return null;
  }
  const width = container.getBoundingClientRect().width;
  if (!Number.isFinite(width) || width <= 0) {
    return null;
  }
  return Number(width.toFixed(2));
}

async function primeScreenBasePx(force) {
  if (!force && Number.isFinite(WRE_STATE.screenBasePx) && WRE_STATE.screenBasePx > 0) {
    return;
  }
  const width = await measureDefaultBaseWidthPx();
  if (!width) {
    // 滚动模式没有 .readerChapterContent_container（宽度走百分比），不需要像素基准，静默跳过
    if (detectScrollMode() || !document.querySelector('.readerChapterContent')) {
      log('info', '滚动模式无需 screenBasePx 基准，跳过');
    } else {
      log('warn', '未能初始化 screenBasePx（未找到阅读内容元素）');
    }
    return;
  }
  WRE_STATE.screenBasePx = width;
  WRE_STATE.screenBaseMode = WRE_DEFAULT_STATE.screenBaseMode;
  await saveState();
  log('info', '已初始化 screenBasePx', { screenBasePx: WRE_STATE.screenBasePx });
}

async function resetScreenBasePx() {
  const width = await measureDefaultBaseWidthPx();
  if (!width) {
    log('warn', '重置 screenBasePx 失败（未找到阅读内容元素）');
    return;
  }
  WRE_STATE.screenBasePx = width;
  WRE_STATE.screenBaseMode = WRE_DEFAULT_STATE.screenBaseMode;
  await saveState();
  log('info', '已重置 screenBasePx', { screenBasePx: WRE_STATE.screenBasePx });
  const applied = applyScreenRatio(WRE_STATE.screenRatio);
  scheduleWereadLayoutReflow('reset-base');
  log('info', '已重置基准并重新应用屏占比', applied);
}

function ensureStyleTag() {
  if (wreStyleTag && document.contains(wreStyleTag)) {
    return;
  }

  const existing = Array.from(document.querySelectorAll('#we-read-enhancer-style'));
  if (existing.length > 0) {
    wreStyleTag = existing[existing.length - 1];
    existing.slice(0, -1).forEach((el) => el.remove());
    return;
  }

  wreStyleTag = document.createElement('style');
  wreStyleTag.id = 'we-read-enhancer-style';
  document.head.appendChild(wreStyleTag);
}

const toolbarFloatCSS = `
body.wre-toolbar-floating .readerTopBar,
body.wre-toolbar-floating [class*="readerTopBar"] {
  opacity: 0 !important;
  pointer-events: none !important;
  transition: opacity 0.3s ease !important;
}
body.wre-toolbar-floating.wre-show-topbar .readerTopBar,
body.wre-toolbar-floating.wre-show-topbar [class*="readerTopBar"] {
  opacity: 1 !important;
  pointer-events: auto !important;
}
body.wre-toolbar-floating .readerControls,
body.wre-toolbar-floating [class*="readerControls"] {
  left: auto !important;
  right: 20px !important;
  margin-left: 0 !important;
  opacity: 0 !important;
  pointer-events: none !important;
  transition: opacity 0.3s ease !important;
}
body.wre-toolbar-floating.wre-show-controls .readerControls,
body.wre-toolbar-floating.wre-show-controls [class*="readerControls"] {
  opacity: 1 !important;
  pointer-events: auto !important;
}`;

// 沉浸模式 CSS（放在 toolbarFloatCSS 之后，同优先级下按源顺序覆盖其隐藏规则）
const immersiveCSS = `
html.wre-immersive .readerTopBar,
html.wre-immersive [class*="readerTopBar"],
html.wre-immersive .readerControls,
html.wre-immersive [class*="readerControls"] {
  opacity: 0 !important;
  pointer-events: none !important;
  transition: opacity 0.3s ease !important;
}
html.wre-immersive .readerFooter,
html.wre-immersive [class*="readerFooter"],
html.wre-immersive [class*="readerBottom"] {
  opacity: 0 !important;
  pointer-events: none !important;
  transition: opacity 0.3s ease !important;
}
html.wre-immersive.wre-immersive-show-top .readerTopBar,
html.wre-immersive.wre-immersive-show-top [class*="readerTopBar"] {
  opacity: 1 !important;
  pointer-events: auto !important;
}
html.wre-immersive.wre-immersive-show-controls .readerControls,
html.wre-immersive.wre-immersive-show-controls [class*="readerControls"] {
  opacity: 1 !important;
  pointer-events: auto !important;
}
html.wre-immersive.wre-immersive-show-bottom .readerFooter,
html.wre-immersive.wre-immersive-show-bottom [class*="readerFooter"],
html.wre-immersive.wre-immersive-show-bottom [class*="readerBottom"] {
  opacity: 1 !important;
  pointer-events: auto !important;
}`;

// 判定阅读方式：翻页模式有 .readerChapterContent_container 作为宽度基准；
// 滚动模式没有该容器，正文由固定宽居中的 .app_content 承载。
function detectScrollMode() {
  return !document.querySelector('.readerChapterContent_container')
    && !!document.querySelector('.app_content');
}

// 判定是否在阅读页（路径形如 /web/reader/...）
function isReaderPage() {
  return window.location.pathname.indexOf('/web/reader') === 0;
}

// 生成屏占比宽度 CSS（按阅读方式分流），供 updateStyleTag 使用
function buildRatioCSS(ratio) {
  const numericRatio = clampNumber(Number(ratio), 50, 100);

  if (detectScrollMode()) {
    // 滚动模式：作用于原生正文容器 .app_content，用相对视口的百分比 max-width 居中，
    // 不沿用翻页模式的固定 px 基准（否则会超出原生容器宽度导致溢出 + 不居中 + 水平滚动条）。
    return `
      .app_content {
        width: ${numericRatio}% !important;
        max-width: ${numericRatio}% !important;
        margin-left: auto !important;
        margin-right: auto !important;
        box-sizing: border-box !important;
      }
      .readerChapterContent {
        width: 100% !important;
        max-width: 100% !important;
        margin-left: auto !important;
        margin-right: auto !important;
        box-sizing: border-box !important;
      }
    `;
  }

  // 翻页模式：沿用固定 px 基准（.readerChapterContent_container 宽度 × 比例）
  const basePx = Number.isFinite(WRE_STATE.screenBasePx) && WRE_STATE.screenBasePx > 0 ? WRE_STATE.screenBasePx : null;
  const targetPx = basePx ? Math.round((basePx * numericRatio) / 100) : null;
  if (targetPx) {
    return `
      .readerChapterContent {
        width: ${targetPx}px !important;
        max-width: ${targetPx}px !important;
        margin-left: auto !important;
        margin-right: auto !important;
        box-sizing: border-box !important;
      }
    `;
  }
  return `
    .readerChapterContent {
      max-width: ${numericRatio}% !important;
      margin-left: auto !important;
      margin-right: auto !important;
      box-sizing: border-box !important;
    }
  `;
}

function updateStyleTag(ratio) {
  ensureStyleTag();
  const numericRatio = clampNumber(Number(ratio), 50, 100);
  const scrollMode = detectScrollMode();
  const basePx = Number.isFinite(WRE_STATE.screenBasePx) && WRE_STATE.screenBasePx > 0 ? WRE_STATE.screenBasePx : null;
  const targetPx = (!scrollMode && basePx) ? Math.round((basePx * numericRatio) / 100) : null;

  wreStyleTag.textContent = `
    ${buildRatioCSS(numericRatio)}
    ${toolbarFloatCSS}
    ${immersiveCSS}
  `;

  // 仅滚动模式启用视口滚动条美化的作用域标记（翻页模式/书架页不受影响）
  document.documentElement.classList.toggle('wre-scrollmode', scrollMode);
  if (scrollMode) {
    ensureCustomScrollbar();
    updateCustomScrollbar();
  } else {
    document.documentElement.classList.remove('wre-show-scrollbar');
    if (wreCustomScrollbar) { wreCustomScrollbar.style.display = 'none'; }
  }

  // 强制重排后动态检测工具栏位置
  document.body.offsetHeight;
  let enableToolbarFloat = false;
  const controls = document.querySelector('.readerControls');
  const topBar = document.querySelector('.readerTopBar');
  if (controls && topBar) {
    const cr = controls.getBoundingClientRect();
    const tr = topBar.getBoundingClientRect();
    if (scrollMode) {
      // 滚动模式：工具栏不会被推出视口，改用「正文盖住工具栏区域」判定。
      // 用稳定参照避免浮动移动 controls 后判定值来回变化导致的抖动。
      const content = document.querySelector('.app_content') || document.querySelector('.readerChapterContent');
      const contentRect = content ? content.getBoundingClientRect() : null;
      enableToolbarFloat = !!contentRect && contentRect.width > tr.width + 4;
    } else {
      // 翻页模式：① 比例 >85%（86% 及以上触发，85% 刚好放下工具栏）；② 元素实际溢出视口（兜底）
      enableToolbarFloat = numericRatio > 85 || tr.left < -1 || tr.right > window.innerWidth + 1 || cr.right > window.innerWidth;
    }
    log('info', '工具栏位置检测', {
      mode: scrollMode ? 'scroll' : 'page',
      controls: { left: Math.round(cr.left), right: Math.round(cr.right) },
      topBar: { left: Math.round(tr.left), right: Math.round(tr.right) },
      viewportW: window.innerWidth, enableFloat: enableToolbarFloat
    });
  } else if (controls) {
    const cr = controls.getBoundingClientRect();
    enableToolbarFloat = cr.right > window.innerWidth + 1;
  } else if (topBar) {
    const tr = topBar.getBoundingClientRect();
    enableToolbarFloat = tr.left < 0 || tr.right > window.innerWidth;
  }

  if (enableToolbarFloat) {
    document.body.classList.add('wre-toolbar-floating');
    applyToolbarFloating();
  } else {
    document.body.classList.remove('wre-toolbar-floating');
    document.body.classList.remove('wre-show-topbar');
    document.body.classList.remove('wre-show-controls');
    removeToolbarFloating();
  }

  return {
    ratio: numericRatio,
    screenBasePx: basePx,
    targetMaxWidthPx: targetPx,
    toolbarFloatEnabled: enableToolbarFloat,
  };
}

function applyScreenRatio(ratio) {
  return updateStyleTag(ratio);
}

let wreToolbarMoveHandler = null; // 鼠标位置监听（替代透明感应层，避免遮挡点击）
let wreToolbarHideTimer = null;
let wreToolbarRightTimer = null;

// 顶部 / 右侧 / 底部感应阈值（px）
const WRE_TOPBAR_ZONE_PX = 100;
const WRE_CONTROLS_ZONE_PX = 120;
const WRE_BOTTOM_ZONE_PX = 80;

// 自绘悬浮滚动条（滚动模式，隐藏原生滚动条后替代）
let wreCustomScrollbar = null;
let wreCustomScrollbarThumb = null;
let wreScrollbarDragging = false;

function pinTopBar() {
  const topBar = document.querySelector('.readerTopBar');
  if (!topBar) return false;
  // 顶栏浮现时层级高于正文，保证按钮可点击（感应已改为鼠标位置判断，无覆盖层）
  topBar.style.setProperty('z-index', '999998', 'important');
  // 浮现时水平居中于视口，视觉更协调（原生仅相对内容区居中，浮在满宽正文上会略偏）
  const width = topBar.offsetWidth;
  if (width > 0) {
    const left = Math.max(0, Math.round((window.innerWidth - width) / 2));
    topBar.style.setProperty('left', left + 'px', 'important');
    topBar.style.setProperty('right', 'auto', 'important');
    topBar.style.setProperty('transform', 'none', 'important');
  }
  return true;
}

function pinControls() {
  const controls = document.querySelector('.readerControls');
  if (!controls) return false;
  // inline style 最高优先级，确保覆盖微信读书原生样式
  controls.style.setProperty('left', 'auto', 'important');
  controls.style.setProperty('right', '20px', 'important');
  controls.style.setProperty('margin-left', '0', 'important');
  controls.style.setProperty('z-index', '999999', 'important');
  return true;
}

// 官方「目录 / 搜索」抽屉打开时会盖住屏幕顶部；此时必须让出顶栏，
// 否则浮动顶栏（z-index 高于官方抽屉）会压住抽屉顶部的搜索框，导致点不到。
function isOfficialPanelAtTop() {
  // 插件自己的界面（悬浮球 / 弹窗）不算，统一以 wre- 前缀判据
  const isOwnUI = (el) => {
    let node = el;
    while (node && node !== document.body) {
      if (node.id === 'we-read-enhancer-root') return true;
      const cls = typeof node.className === 'string' ? node.className : '';
      if (/(^|\s)wre-/.test(cls)) return true;
      node = node.parentElement;
    }
    return false;
  };
  // ① 顶部区域里有官方可见输入框（目录 / 搜索抽屉的搜索框）
  const inputs = document.querySelectorAll('input, textarea');
  for (const input of inputs) {
    if (isOwnUI(input)) continue; // 跳过插件自己的输入框
    const rect = input.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 16) continue;
    if (rect.bottom <= 0 || rect.top > WRE_TOPBAR_ZONE_PX) continue;
    const style = window.getComputedStyle(input);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.1) continue;
    return true;
  }
  // ② 目录面板本身占住了顶部（无输入框时的兜底）
  const panels = document.querySelectorAll('.readerCatalog, [class*="readerCatalog"]');
  for (const panel of panels) {
    if (panel.tagName === 'LI' || panel.tagName === 'UL') continue;
    const rect = panel.getBoundingClientRect();
    if (rect.width < 200 || rect.height < 200) continue;
    if (rect.right <= 0 || rect.left >= window.innerWidth) continue; // 已收起（滑出视口）
    if (rect.bottom <= 0 || rect.top > WRE_TOPBAR_ZONE_PX) continue;
    const style = window.getComputedStyle(panel);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.1) continue;
    return true;
  }
  return false;
}

function applyToolbarFloating() {
  pinTopBar();
  pinControls();
  ensureToolbarTrigger();
}

function removeToolbarFloating() {
  if (wreToolbarHideTimer) { clearTimeout(wreToolbarHideTimer); wreToolbarHideTimer = null; }
  if (wreToolbarRightTimer) { clearTimeout(wreToolbarRightTimer); wreToolbarRightTimer = null; }

  const topBar = document.querySelector('.readerTopBar');
  const controls = document.querySelector('.readerControls');

  if (topBar) {
    topBar.style.cssText = '';
  }
  if (controls) {
    controls.style.cssText = '';
  }

  if (wreToolbarMoveHandler) {
    document.removeEventListener('mousemove', wreToolbarMoveHandler, true);
    wreToolbarMoveHandler = null;
  }

  document.body.classList.remove('wre-show-topbar');
  document.body.classList.remove('wre-show-controls');
}

function ensureToolbarTrigger() {
  if (wreToolbarMoveHandler) return;

  const showTop = () => {
    if (isOfficialPanelAtTop()) return; // 官方目录 / 搜索抽屉打开时让位
    if (wreToolbarHideTimer) { clearTimeout(wreToolbarHideTimer); wreToolbarHideTimer = null; }
    pinTopBar();
    document.body.classList.add('wre-show-topbar');
  };
  const hideTop = () => {
    if (wreToolbarHideTimer) return; // 已在淡出倒计时中，不重复计时
    wreToolbarHideTimer = setTimeout(() => {
      document.body.classList.remove('wre-show-topbar');
      wreToolbarHideTimer = null;
    }, 400);
  };

  const showRight = () => {
    if (wreToolbarRightTimer) { clearTimeout(wreToolbarRightTimer); wreToolbarRightTimer = null; }
    pinControls();
    document.body.classList.add('wre-show-controls');
  };
  const hideRight = () => {
    if (wreToolbarRightTimer) return;
    wreToolbarRightTimer = setTimeout(() => {
      document.body.classList.remove('wre-show-controls');
      wreToolbarRightTimer = null;
    }, 400);
  };

  // 用鼠标位置判断代替透明感应层：感应层即使完全透明也会吃掉点击，压住官方「下一页」点击区
  wreToolbarMoveHandler = (event) => {
    if (event.clientY <= WRE_TOPBAR_ZONE_PX) {
      if (isOfficialPanelAtTop()) {
        // 抽屉打开：立刻收起顶栏（顶栏 pointer-events 随类名移除即刻失效，不再吃点击）
        if (wreToolbarHideTimer) { clearTimeout(wreToolbarHideTimer); wreToolbarHideTimer = null; }
        document.body.classList.remove('wre-show-topbar');
      } else {
        showTop();
      }
    } else {
      hideTop();
    }
    if (window.innerWidth - event.clientX <= WRE_CONTROLS_ZONE_PX) showRight(); else hideRight();
  };
  document.addEventListener('mousemove', wreToolbarMoveHandler, true);
}

/* ========== 沉浸模式 ========== */

let wreImmersiveHideTimer = null;
let wreImmersiveMoveHandler = null;

/** 按当前开关状态把 immersive 类写到 <html>，并同步设置面板 / 菜单的 UI */
function applyImmersive() {
  const on = !!WRE_STATE.immersiveMode;
  document.documentElement.classList.toggle('wre-immersive', on);
  // 沉浸态下悬浮球一并隐藏（菜单展开时除外），左上角原位置悬停即唤出
  if (wreRoot) {
    const menuVisible = wreRoot.querySelector('#wre-main-menu')?.classList.contains('wre-visible');
    if (on && !menuVisible) {
      wreRoot.classList.add('wre-immersive-fab');
    } else if (!on) {
      wreRoot.classList.remove('wre-immersive-fab');
    }
  }
  if (!on) {
    if (wreImmersiveHideTimer) { clearTimeout(wreImmersiveHideTimer); wreImmersiveHideTimer = null; }
    document.documentElement.classList.remove('wre-immersive-show-top');
    document.documentElement.classList.remove('wre-immersive-show-controls');
    document.documentElement.classList.remove('wre-immersive-show-bottom');
  } else {
    // 沉浸态下顶栏/控制条的钉住样式沿用浮动逻辑（z-index 与居中）
    pinTopBar();
    pinControls();
    ensureImmersiveTrigger();
    ensureToolbarTrigger();
  }
  updateImmersiveUI();
}

/** 沉浸态边缘唤出：顶部 → 顶栏，右侧 → 控制条，底部 → 底部进度条；离开后延迟淡出 */
function ensureImmersiveTrigger() {
  if (wreImmersiveMoveHandler) return;

  const show = (cls) => {
    if (wreImmersiveHideTimer) { clearTimeout(wreImmersiveHideTimer); wreImmersiveHideTimer = null; }
    document.documentElement.classList.add(cls);
  };
  const scheduleHide = () => {
    if (wreImmersiveHideTimer) return;
    wreImmersiveHideTimer = setTimeout(() => {
      document.documentElement.classList.remove('wre-immersive-show-top');
      document.documentElement.classList.remove('wre-immersive-show-controls');
      document.documentElement.classList.remove('wre-immersive-show-bottom');
      wreImmersiveHideTimer = null;
    }, 400);
  };

  wreImmersiveMoveHandler = (event) => {
    if (!WRE_STATE.immersiveMode) return;
    const inTop = event.clientY <= WRE_TOPBAR_ZONE_PX && !isOfficialPanelAtTop();
    const inRight = window.innerWidth - event.clientX <= WRE_CONTROLS_ZONE_PX;
    const inBottom = window.innerHeight - event.clientY <= WRE_BOTTOM_ZONE_PX;
    if (inTop) {
      pinTopBar();
      show('wre-immersive-show-top');
    }
    if (inRight) {
      pinControls();
      show('wre-immersive-show-controls');
    }
    if (inBottom) {
      show('wre-immersive-show-bottom');
    }
    if (!inTop && !inRight && !inBottom) {
      scheduleHide();
    }
  };
  document.addEventListener('mousemove', wreImmersiveMoveHandler, true);
}

function toggleImmersive() {
  WRE_STATE.immersiveMode = !WRE_STATE.immersiveMode;
  applyImmersive();
  saveState();
  log('info', '沉浸模式已切换', { immersiveMode: WRE_STATE.immersiveMode });
}

function updateImmersiveUI() {
  if (!wreRoot) return;
  const btn = wreRoot.querySelector('#wre-immersive-toggle');
  if (btn) {
    btn.textContent = WRE_STATE.immersiveMode ? '退出沉浸模式' : '进入沉浸模式';
    btn.classList.toggle('wre-immersive-active', !!WRE_STATE.immersiveMode);
  }
}

// 获取视口滚动元素
function getViewportScroller() {
  return document.scrollingElement || document.documentElement;
}

// 更新自绘滚动条 thumb 的高度与位置（按当前滚动状态）
function updateCustomScrollbar() {
  if (!wreCustomScrollbar || !wreCustomScrollbarThumb) return;
  if (!document.documentElement.classList.contains('wre-scrollmode')) return;
  const se = getViewportScroller();
  const sh = se.scrollHeight;
  const ch = se.clientHeight;
  if (sh <= ch + 4) {
    wreCustomScrollbar.style.display = 'none';
    return;
  }
  wreCustomScrollbar.style.display = 'block';
  const trackH = wreCustomScrollbar.clientHeight || window.innerHeight;
  const thumbH = Math.max(40, Math.round((trackH * ch) / sh));
  const maxScroll = sh - ch;
  const maxThumbTop = trackH - thumbH;
  const thumbTop = maxScroll > 0 ? Math.round(maxThumbTop * (se.scrollTop / maxScroll)) : 0;
  wreCustomScrollbarThumb.style.height = `${thumbH}px`;
  wreCustomScrollbarThumb.style.top = `${thumbTop}px`;
}

// 创建自绘悬浮滚动条（幂等）
function ensureCustomScrollbar() {
  if (wreCustomScrollbar && document.body.contains(wreCustomScrollbar)) return;
  const bar = document.createElement('div');
  bar.id = 'wre-custom-scrollbar';
  const thumb = document.createElement('div');
  thumb.id = 'wre-custom-scrollbar-thumb';
  bar.appendChild(thumb);
  document.body.appendChild(bar);
  wreCustomScrollbar = bar;
  wreCustomScrollbarThumb = thumb;

  // 拖动 thumb 跳转
  let dragStartY = 0;
  let dragStartScroll = 0;
  thumb.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    wreScrollbarDragging = true;
    dragStartY = e.clientY;
    dragStartScroll = getViewportScroller().scrollTop;
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', (e) => {
    if (!wreScrollbarDragging) return;
    const se = getViewportScroller();
    const sh = se.scrollHeight;
    const ch = se.clientHeight;
    const trackH = bar.clientHeight || window.innerHeight;
    const thumbH = thumb.offsetHeight;
    const maxThumbTop = trackH - thumbH;
    const maxScroll = sh - ch;
    if (maxThumbTop <= 0) return;
    const deltaY = e.clientY - dragStartY;
    se.scrollTop = dragStartScroll + (deltaY / maxThumbTop) * maxScroll;
  });
  document.addEventListener('mouseup', () => {
    if (wreScrollbarDragging) {
      wreScrollbarDragging = false;
      document.body.style.userSelect = '';
    }
  });

  // 点击 track 空白处跳转到对应位置
  bar.addEventListener('mousedown', (e) => {
    if (e.target !== bar) return;
    const se = getViewportScroller();
    const rect = bar.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    se.scrollTop = ratio * (se.scrollHeight - se.clientHeight);
    updateCustomScrollbar();
  });

  log('info', '已创建自绘悬浮滚动条');
}

function openModal(selector) {
  const modal = wreRoot?.querySelector(selector);
  if (modal) {
    modal.classList.add('wre-visible');
  }
}

function closeModal(selector) {
  const modal = wreRoot?.querySelector(selector);
  if (modal) {
    modal.classList.remove('wre-visible');
  }
}

function createUI() {
  const existingRoot = document.getElementById('we-read-enhancer-root');
  if (existingRoot) {
    existingRoot.remove();
  }

  const root = document.createElement('div');
  root.id = 'we-read-enhancer-root';

  root.innerHTML = `
    <div class="wre-fab" id="wre-fab"><svg class="wre-fab-logo" viewBox="0 0 448 448" aria-hidden="true"><circle cx="224" cy="224" r="224" fill="#3B82F6"/><path d="M126 148 L174 300 L224 184 L274 300 L322 148" fill="none" stroke="#FFFFFF" stroke-width="38" stroke-linecap="round" stroke-linejoin="round"/></svg></div>

    <div class="wre-panel-container" id="wre-main-menu">
      <div class="wre-menu-group">阅读</div>
      <div class="wre-menu-item" data-action="immersive"><span class="wre-menu-icon">🔮</span>沉浸模式</div>
      <div class="wre-menu-item" data-action="read-settings"><span class="wre-menu-icon">📖</span>阅读设置</div>

      <div class="wre-menu-group">关于</div>
      <div class="wre-menu-item" data-action="shortcuts"><span class="wre-menu-icon">⌨️</span>快捷键说明</div>
      <div class="wre-menu-item" data-action="restore-default"><span class="wre-menu-icon">🔄</span>恢复默认设置</div>
    </div>

    <div class="wre-modal-overlay" id="wre-read-settings-modal">
      <div class="wre-modal">
        <div class="wre-modal-header">
          <span class="wre-modal-title">📖 阅读设置</span>
          <button class="wre-modal-close" data-close="#wre-read-settings-modal">&times;</button>
        </div>
        <div class="wre-modal-body">
          <div class="wre-setting-item">
            <label class="wre-setting-label">🔮 沉浸模式</label>
            <div class="wre-setting-control">
              <button class="wre-btn" id="wre-immersive-toggle">进入沉浸模式</button>
            </div>
            <div class="wre-setting-tip">隐藏顶部工具栏、右侧控制条与底部进度条，只留正文；鼠标移到顶部 / 右侧 / 底部边缘可临时唤出，快捷键 I。</div>
          </div>

          <div class="wre-setting-item">
            <label class="wre-setting-label">屏占比调节</label>
            <div class="wre-setting-control">
              <input type="range" class="wre-slider" id="wre-screen-ratio" min="50" max="100" value="${WRE_STATE.screenRatio}">
              <span class="wre-slider-value" id="wre-screen-ratio-value">${WRE_STATE.screenRatio}%</span>
            </div>
            <div class="wre-setting-tip">比例含义：相对于阅读区域容器宽度（100% = 当前屏幕可用宽度）。</div>
            <div class="wre-quick-actions" id="wre-screen-ratio-quick">
              <button class="wre-btn wre-btn-small" data-ratio="100">100%</button>
              <button class="wre-btn wre-btn-small" data-ratio="90">90%</button>
              <button class="wre-btn wre-btn-small" data-ratio="80">80%</button>
              <button class="wre-btn wre-btn-small" data-ratio="70">70%</button>
            </div>
          </div>

          <div class="wre-setting-item">
            <label class="wre-setting-label">📜 自动阅读</label>
            <div class="wre-autoread-controls">
              <button class="wre-btn wre-autoread-btn" id="wre-autoread-toggle">
                <span id="wre-autoread-toggle-text">▶ 开始自动阅读</span>
              </button>
              <div class="wre-direction-toggle">
                <button class="wre-btn wre-btn-small wre-dir-btn" data-dir="down" id="wre-dir-down">↓ 向下</button>
                <button class="wre-btn wre-btn-small wre-dir-btn" data-dir="up" id="wre-dir-up">↑ 向上</button>
              </div>
            </div>
            <div class="wre-setting-control" style="margin-top: 12px;">
              <span style="font-size: 12px; color: var(--wre-text); min-width: 36px;">速度</span>
              <input type="range" class="wre-slider" id="wre-autoread-speed" min="10" max="100" value="${WRE_STATE.autoRead.speed}">
              <span class="wre-slider-value" id="wre-autoread-speed-value">${WRE_STATE.autoRead.speed}</span>
            </div>
            <div class="wre-setting-tip">快捷键：空格 开始/暂停 | 按 ? 查看全部快捷键</div>
          </div>

          <div class="wre-setting-item">
            <label class="wre-setting-label">🌈 正文主题</label>
            <div class="wre-setting-control">
              <button class="wre-btn wre-btn-small" id="wre-bg-prev">‹</button>
              <span class="wre-bg-swatch" id="wre-bg-swatch"></span>
              <span class="wre-slider-value" id="wre-bg-name">系统默认</span>
              <button class="wre-btn wre-btn-small" id="wre-bg-next">›</button>
            </div>
            <div class="wre-setting-tip">16 种预设背景色（浅色 / 深色各 8 种），随系统深浅色分档记忆；「系统默认」跟随微信读书原生外观。</div>
          </div>

          <div class="wre-setting-item">
            <label class="wre-setting-label">🎨 外观</label>
            <div class="wre-theme-toggle" id="wre-theme-toggle">
              <button class="wre-btn wre-btn-small wre-theme-btn${WRE_STATE.theme === 'light' ? ' wre-theme-active' : ''}" data-theme="light">浅色</button>
              <button class="wre-btn wre-btn-small wre-theme-btn${WRE_STATE.theme === 'dark' ? ' wre-theme-active' : ''}" data-theme="dark">深色</button>
              <button class="wre-btn wre-btn-small wre-theme-btn${WRE_STATE.theme !== 'light' && WRE_STATE.theme !== 'dark' ? ' wre-theme-active' : ''}" data-theme="auto">跟随系统</button>
            </div>
            <div class="wre-setting-tip">仅调整插件自身界面（菜单 / 弹窗）的明暗，不影响阅读页正文与官方样式。</div>
          </div>

        </div>
      </div>
    </div>

    <div class="wre-modal-overlay" id="wre-shortcuts-modal">
      <div class="wre-modal">
        <div class="wre-modal-header">
          <span class="wre-modal-title">⌨️ 快捷键说明</span>
          <button class="wre-modal-close" data-close="#wre-shortcuts-modal">&times;</button>
        </div>
        <div class="wre-modal-body">
          <table class="wre-shortcuts-table">
            <thead>
              <tr><th>快捷键</th><th>功能</th><th>状态</th></tr>
            </thead>
            <tbody>
              <tr class="wre-shortcuts-group"><td colspan="3">插件快捷键</td></tr>
              <tr>
                <td><span class="wre-shortcut-key">I</span></td>
                <td>进入 / 退出沉浸模式（隐藏顶部 / 右侧 / 底部，边缘唤出）</td>
                <td>启用</td>
              </tr>
              <tr>
                <td><span class="wre-shortcut-key">Space</span></td>
                <td>开始 / 暂停自动阅读（按设定节奏自动往下翻页）</td>
                <td id="wre-shortcut-autoread-status">启用</td>
              </tr>
              <tr>
                <td><span class="wre-shortcut-key">F</span></td>
                <td>进入 / 退出全屏（全屏时屏比自动设为 100%）</td>
                <td>启用</td>
              </tr>
              <tr>
                <td><span class="wre-shortcut-key">?</span></td>
                <td>显示 / 隐藏此帮助面板</td>
                <td>启用</td>
              </tr>
              <tr class="wre-shortcuts-group"><td colspan="3">微信读书原生（插件不拦截）</td></tr>
              <tr>
                <td><span class="wre-shortcut-key">←</span><span class="wre-shortcut-sep">/</span><span class="wre-shortcut-key">→</span></td>
                <td>上一页 / 下一页</td>
                <td>官方原生</td>
              </tr>
              <tr>
                <td><span class="wre-shortcut-key">Esc</span></td>
                <td>退出全屏（屏占比自动恢复）</td>
                <td>官方原生</td>
              </tr>
            </tbody>
          </table>
          <div class="wre-shortcuts-footer">提示：快捷键仅在微信读书网页内生效，输入框中不触发；Ctrl / Alt / Cmd 组合键同样不触发</div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(root);
  wreRoot = root;
  bindEvents(root);
  updateImmersiveUI();
  updateBgThemeUI();
  log('info', '插件 UI 已加载', {
    screenRatio: WRE_STATE.screenRatio,
    screenBasePx: WRE_STATE.screenBasePx,
    href: window.location.href,
  });
}

/* ========== 自动阅读 ========== */

function findScrollTarget() {
  const docEl = document.documentElement;

  // 探测 window：滚 1px 看位置是否变化
  const prevWinBehavior = docEl.style.scrollBehavior;
  docEl.style.scrollBehavior = 'auto';
  const winBefore = window.scrollY;
  window.scrollBy(0, 1);
  if (window.scrollY !== winBefore) {
    window.scrollBy(0, -1);
    docEl.style.scrollBehavior = prevWinBehavior;
    return 'window';
  }
  docEl.style.scrollBehavior = prevWinBehavior;

  // 探测常见阅读容器
  const containers = document.querySelectorAll(
    '.app_content, .readerChapterContent_container, .readerContent, [class*="reader-scroll"]'
  );
  for (const el of containers) {
    const prevBehavior = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';
    const before = el.scrollTop;
    el.scrollTop += 1;
    if (el.scrollTop !== before) {
      el.scrollTop -= 1;
      el.style.scrollBehavior = prevBehavior;
      return el;
    }
    el.style.scrollBehavior = prevBehavior;
  }

  // 无可滚动容器 → Canvas 模式
  return 'canvas';
}

function scrollTargetBy(target, dy) {
  if (target === 'window') {
    const docEl = document.documentElement;
    const prevBehavior = docEl.style.scrollBehavior;
    docEl.style.scrollBehavior = 'auto';
    const before = window.scrollY;
    window.scrollBy(0, dy);
    docEl.style.scrollBehavior = prevBehavior;
    return { top: window.scrollY, stuck: window.scrollY === before };
  }
  if (target === 'canvas') {
    const key = dy > 0 ? 'ArrowDown' : 'ArrowUp';
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key, code: key,
      keyCode: dy > 0 ? 40 : 38,
      which: dy > 0 ? 40 : 38,
      bubbles: true, cancelable: true,
    }));
    return { top: 0, stuck: false };
  }
  if (target instanceof Element) {
    const prevBehavior = target.style.scrollBehavior;
    target.style.scrollBehavior = 'auto';
    const before = target.scrollTop;
    target.scrollTop += dy;
    target.style.scrollBehavior = prevBehavior;
    return { top: target.scrollTop, stuck: target.scrollTop === before };
  }
  // fallback
  const before = window.scrollY;
  window.scrollBy(0, dy);
  return { top: window.scrollY, stuck: window.scrollY === before };
}

function startAutoRead() {
  if (autoReadTimer) return;

  const scrollTarget = findScrollTarget();
  const speedPxPerSec = WRE_STATE.autoRead.speed;
  const direction = WRE_STATE.autoRead.direction === 'up' ? -1 : 1;

  // Canvas 模式：用定时器限频派发键盘事件（速度 10→3s/次，100→0.3s/次）
  if (scrollTarget === 'canvas') {
    const intervalMs = Math.max(200, Math.round(3000 - (speedPxPerSec - 10) * (2800 / 90)));
    const key = direction === 1 ? 'ArrowDown' : 'ArrowUp';
    const keyCode = direction === 1 ? 40 : 38;

    function tick() {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key, code: key, keyCode, which: keyCode,
        bubbles: true, cancelable: true,
      }));
    }

    tick(); // 立即执行一次
    autoReadTimer = window.setInterval(tick, intervalMs);
    autoReadIsInterval = true;
    WRE_STATE.autoRead.enabled = true;
    updateAutoReadUI();
    log('info', '自动阅读已启动 (Canvas 模式)', {
      speed: speedPxPerSec, direction: WRE_STATE.autoRead.direction, intervalMs,
    });
    return;
  }

  // 滚动模式：rAF + 像素累积
  let lastTime = performance.now();
  let accumulatedPx = 0;
  let stuckCount = 0;

  function step(now) {
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    accumulatedPx += speedPxPerSec * dt;

    const pixels = Math.floor(accumulatedPx);
    if (pixels > 0) {
      accumulatedPx -= pixels;
      const result = scrollTargetBy(scrollTarget, pixels * direction);

      if (result.stuck) {
        stuckCount++;
        if (stuckCount >= 3) {
          stopAutoRead();
          updateAutoReadUI();
          return;
        }
      } else {
        stuckCount = 0;
      }
    }

    autoReadTimer = requestAnimationFrame(step);
  }

  autoReadTimer = requestAnimationFrame(step);
  WRE_STATE.autoRead.enabled = true;
  updateAutoReadUI();
  log('info', '自动阅读已启动 (滚动模式)', {
    speed: speedPxPerSec,
    direction: WRE_STATE.autoRead.direction,
    scrollTarget: scrollTarget === 'window' ? 'window' : (scrollTarget.className || scrollTarget.tagName),
  });
}

function clearAutoReadTimer() {
  if (autoReadTimer == null) return;
  if (autoReadIsInterval) {
    clearInterval(autoReadTimer);
  } else {
    cancelAnimationFrame(autoReadTimer);
  }
  autoReadTimer = null;
  autoReadIsInterval = false;
}

function stopAutoRead() {
  clearAutoReadTimer();
  WRE_STATE.autoRead.enabled = false;
  updateAutoReadUI();
  log('info', '自动阅读已停止');
}

function toggleAutoRead() {
  if (autoReadTimer) {
    stopAutoRead();
  } else {
    startAutoRead();
  }
  saveState();
}

function setAutoReadSpeed(speed) {
  WRE_STATE.autoRead.speed = speed;
  updateAutoReadUI();
  // 滚动中需要重启以应用新速度/间隔
  if (autoReadTimer) {
    clearAutoReadTimer();
    startAutoRead();
  }
  log('info', '自动阅读速度已调整', { speed });
}

function setAutoReadDirection(dir) {
  WRE_STATE.autoRead.direction = dir;
  if (autoReadTimer) {
    clearAutoReadTimer();
    startAutoRead();
  }
  updateAutoReadUI();
  log('info', '自动阅读方向已切换', { direction: dir });
}

function updateAutoReadUI() {
  if (!wreRoot) return;

  try {
    const toggleText = wreRoot.querySelector('#wre-autoread-toggle-text');
    const toggleBtn = wreRoot.querySelector('#wre-autoread-toggle');
    const speedSlider = wreRoot.querySelector('#wre-autoread-speed');
    const speedValue = wreRoot.querySelector('#wre-autoread-speed-value');
    const dirDown = wreRoot.querySelector('#wre-dir-down');
    const dirUp = wreRoot.querySelector('#wre-dir-up');

    if (toggleText) {
      toggleText.textContent = WRE_STATE.autoRead.enabled ? '⏸ 暂停自动阅读' : '▶ 开始自动阅读';
    }
    if (toggleBtn) {
      toggleBtn.classList.toggle('wre-autoread-active', WRE_STATE.autoRead.enabled);
    }
    if (speedSlider) {
      speedSlider.value = String(WRE_STATE.autoRead.speed);
    }
    if (speedValue) {
      speedValue.textContent = String(WRE_STATE.autoRead.speed);
    }
    if (dirDown) {
      dirDown.classList.toggle('wre-dir-active', WRE_STATE.autoRead.direction === 'down');
    }
    if (dirUp) {
      dirUp.classList.toggle('wre-dir-active', WRE_STATE.autoRead.direction === 'up');
    }
  } catch (err) {
    log('error', 'updateAutoReadUI 失败', { error: String(err) });
  }
}

/* ========== 外观主题档 ========== */

const WRE_THEME_ATTR = 'data-wre-theme'; // 生效主题挂在 <html> 上，content.css 据此切换 Token
let wreThemeMedia = null;                // 系统深浅色媒体查询（「跟随系统」时监听其变化）

/** 把偏好解析成实际档位：light / dark 直接用；auto（含缺省）按系统深浅色判定 */
function resolveEffectiveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch (err) {
    return 'light';
  }
}

/** 应用当前主题：把生效档位写到 <html data-wre-theme>，驱动 content.css 的 Token 覆盖 */
function applyTheme() {
  const effective = resolveEffectiveTheme(WRE_STATE.theme);
  document.documentElement.setAttribute(WRE_THEME_ATTR, effective);
  return effective;
}

/** 「跟随系统」时监听系统深浅色变化，实时刷新 */
function watchSystemTheme() {
  if (wreThemeMedia) return;
  try {
    wreThemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (WRE_STATE.theme !== 'light' && WRE_STATE.theme !== 'dark') applyTheme();
    };
    if (typeof wreThemeMedia.addEventListener === 'function') {
      wreThemeMedia.addEventListener('change', onChange);
    } else if (typeof wreThemeMedia.addListener === 'function') {
      wreThemeMedia.addListener(onChange);
    }
  } catch (err) {
    log('warn', '监听系统主题失败', { error: String(err) });
  }
}

/** 同步外观设置面板的选中态 */
function updateThemeUI() {
  if (!wreRoot) return;
  const toggle = wreRoot.querySelector('#wre-theme-toggle');
  if (!toggle) return;
  toggle.querySelectorAll('.wre-theme-btn').forEach((btn) => {
    btn.classList.toggle('wre-theme-active', btn.getAttribute('data-theme') === WRE_STATE.theme);
  });
}

/* ========== 正文主题色（16 档预设 · 移植自 weread-plus） ========== */

// 滚动模式正文文字色（深色主题配浅字、浅色主题配深字）
const WRE_DARK_TEXT = '#d4d4d4';
const WRE_LIGHT_TEXT = '#333333';

// rgb 为 null 表示「系统默认」：撤除插件配色，微信读书原生外观接管。
// 每个模式（light/dark）清单的首个主题即该模式的默认状态
const WRE_BG_COLORS = [
  { name: '系统默认', rgb: null, type: 'light' },
  { name: 'Claude 暖白', rgb: '#FAF5EE', type: 'light' },
  { name: 'Claude 米杏', rgb: '#F0E6D3', type: 'light' },
  { name: 'Claude 浅棕', rgb: '#E8DCC8', type: 'light' },
  { name: 'Kami 纸白', rgb: '#f5f4ed', type: 'light' },
  { name: '书页灰', rgb: '#DFDDD6', type: 'light' },
  { name: '蜜桃珊瑚', rgb: '#F9E5DB', type: 'light' },
  { name: '草香', rgb: '#F5F8F3', type: 'light' },
  { name: '系统默认', rgb: null, type: 'dark' },
  { name: '暗夜黑', rgb: '#1a1a2e', type: 'dark' },
  { name: '深墨蓝', rgb: '#16213e', type: 'dark' },
  { name: '青夜', rgb: '#2A363F', type: 'dark' },
  { name: '暗蓝灰', rgb: '#1e2d3d', type: 'dark' },
  { name: '墨黛蓝', rgb: '#1a2a2e', type: 'dark' },
  { name: '暗橄榄', rgb: '#1e2319', type: 'dark' },
  { name: '暮云灰', rgb: '#252228', type: 'dark' },
];

// 运行时激活的主题索引（不持久化，由 bgLightIdx / bgDarkIdx 按当前模式派生）
let wreBgIdx = 0;
let wreBgStyleEl = null;
let wreBgStyleCache = '';
let wreBgColorObserver = null;
let wreBgColorObserverTarget = null;
let wreBgApplyingColor = false;

// 系统深浅色切换的自愈代际 + 异常去重（旧一代的自愈轮次作废）
let wreSystemThemeGen = 0;
let wreHealIssueKeys = null;
let wreBgModeDedup = null; // 双信号去重：prefers-color-scheme 事件与 body class 变化

// 微信读书通过 body 的 wr_whiteTheme class 标识浅色模式，没有则为深色
function isWereadDarkMode() {
  return !document.body.classList.contains('wr_whiteTheme');
}

// 双栏模式（翻页）：按钮 class 为 isHorizontalReader；文字由 Canvas 渲染，CSS color 无法影响
function isDoubleColumnMode() {
  return !!document.querySelector('.readerControls_item.isHorizontalReader');
}

function isValidBgIdx(idx, type) {
  return Number.isInteger(idx) && idx >= 0 && idx < WRE_BG_COLORS.length
    && WRE_BG_COLORS[idx].type === type;
}

// 当前系统模式下可选的主题清单（forceDark：系统切换事件携带的新模式，见 handleBgModeChange）
function getBgAvailableColors(forceDark) {
  const isDark = forceDark !== undefined ? forceDark : isWereadDarkMode();
  return WRE_BG_COLORS.filter((c) => (isDark && c.type === 'dark') || (!isDark && c.type === 'light'));
}

// 当前主题在可用清单中的索引（按对象身份匹配：「系统默认」浅/深各一个，按名称会恒命中浅色那个）
function getCurrentBgColorIndex() {
  const available = getBgAvailableColors();
  const current = WRE_BG_COLORS[wreBgIdx];
  const idx = available.indexOf(current);
  return idx >= 0 ? idx : 0;
}

// 切换主题：写运行时索引并持久化到主题所属模式的键（归属由主题 type 决定而非 body class——
// 系统切换过渡期 body class 是旧值，读它会写错键）
function setActiveBgIdx(idx) {
  const theme = WRE_BG_COLORS[idx];
  if (!theme) return;
  if (theme.type === 'dark') {
    WRE_STATE.bgDarkIdx = idx;
  } else {
    WRE_STATE.bgLightIdx = idx;
  }
  wreBgIdx = idx;
  saveState();
  applyBgColor();
  updateBgThemeUI();
  log('info', '正文主题已切换', { name: theme.name, type: theme.type });
}

// 在当前模式的可用主题间循环切换（面板 ‹ › 箭头）
function cycleBgTheme(delta) {
  const available = getBgAvailableColors();
  const nextIdx = (getCurrentBgColorIndex() + delta + available.length) % available.length;
  setActiveBgIdx(WRE_BG_COLORS.indexOf(available[nextIdx]));
}

// 系统深浅色切换后恢复目标模式记住的主题（首次进入该模式时为其默认）
function applySystemBgMode(isDark) {
  wreBgIdx = isDark ? WRE_STATE.bgDarkIdx : WRE_STATE.bgLightIdx;
  applyBgColor();
  updateBgThemeUI();
}

// 主题颜色 CSS。双栏模式文字由 Canvas 渲染，仅设背景与 UI 颜色
function buildBgCss(theme, isDualColumn) {
  const color = theme.rgb;
  const isDark = theme.type === 'dark';
  const textColor = isDark ? WRE_DARK_TEXT : WRE_LIGHT_TEXT;
  const subTextColor = isDark ? '#a0a0a0' : '#555555';

  const base = `
html, body, #app, .app, #routerView, .routerView { background-color: ${color} !important; }
.wr_horizontalReader, .wr_horizontalReader_app_content { background-color: ${color} !important; }
.readerContent, .app_content, .wr_various_font_provider_wrapper,
.readerChapterContent, .readerChapterContent_container, .renderTargetContainer, .renderTargetContent { background-color: ${color} !important; }
.page, .page_left, .page_right, .page_show, .page_space_top, .page_space_bottom { background-color: ${color} !important; }
.readerTopBar, .readerTopBar_inner, .readerTopBar_left, .readerTopBar_right,
.readerBottomBar, .readerBottomBar_content, .readerFooter, .readerFooter_button,
.readerControls, .readerControls_item { background-color: ${color} !important; }
.readerChapterContent, .wr_page_reader, .readerContent, .app_content,
.wr_various_font_provider_wrapper { background-image: none !important; }
.readerTopBar_title_chapter, .readerTopBar_title_link, .readerTopBar_link, .readerTopBar a { color: ${textColor} !important; }
.readerTopBar_title, .readerBottomBar span, .readerFooter_button span { color: ${subTextColor} !important; }
.renderTargetPageInfo_header, .renderTarget_pager, .renderTargetPageInfo_header * { color: ${textColor} !important; }
`;

  if (isDualColumn) return base;

  // 滚动模式额外文字颜色
  const scrollOnly = `
html, body, #app, .app, #routerView, .routerView { color: ${textColor} !important; }
.wr_horizontalReader, .wr_horizontalReader_app_content { color: ${textColor} !important; }
.wr_horizontalReader, .wr_horizontalReader * { color: ${textColor} !important; }
.readerChapterContent, .readerChapterContent .renderTargetContent, .readerChapterContent p, .readerChapterContent span, .readerChapterContent div { color: ${textColor} !important; }
.readerChapterContent, .readerChapterContent_container, .renderTargetContainer, .renderTargetContent { color: ${textColor} !important; }
.readerCatalog, .readerCatalog *, .readerNotePanel { background-color: ${color} !important; color: ${textColor} !important; }
.preRenderContainer, .preRenderContainer * { color: ${textColor} !important; }
.renderTargetContainer, .renderTargetContainer * { color: ${textColor} !important; }
.readerChapterContent_container, .readerChapterContent_container * { color: ${textColor} !important; }
`;
  return base + scrollOnly;
}

function setBgStyle(css) {
  if (css === wreBgStyleCache && wreBgStyleEl && wreBgStyleEl.parentNode) return;
  wreBgStyleCache = css;
  if (!wreBgStyleEl || !wreBgStyleEl.parentNode) {
    // SPA 导航/微信读书重建可能替换 <head>：元素丢失时重建
    wreBgStyleEl = document.getElementById('wre-bg-theme-style');
    if (!wreBgStyleEl) {
      wreBgStyleEl = document.createElement('style');
      wreBgStyleEl.id = 'wre-bg-theme-style';
      document.head.appendChild(wreBgStyleEl);
    }
  }
  wreBgStyleEl.textContent = css;
}

// 撤除插件写入的内联文字色：仅匹配插件自身的两套颜色，微信读书原生内联样式不受影响
function clearPluginTextColors() {
  document.querySelectorAll('[style*="color"]').forEach((el) => {
    if (!el.style.color) return;
    const style = el.getAttribute('style') || '';
    if (style.indexOf('212, 212, 212') !== -1 || style.indexOf('212,212,212') !== -1
      || style.indexOf('51, 51, 51') !== -1 || style.indexOf('51,51,51') !== -1) {
      el.style.removeProperty('color');
    }
  });
}

// 持续监听内联样式变化，强制覆盖微信读书设置的文字颜色（滚动模式）
function startBgColorObserver() {
  // 优先观察滚动模式正文容器：双栏切滚动后 .wr_horizontalReader 可能残留（隐藏），
  // 观察它收不到正文内联样式变化
  const target = document.querySelector('.readerChapterContent')
    || document.querySelector('.wr_horizontalReader')
    || document.querySelector('.readerContent');
  if (!target) return;
  // SPA 导航替换节点后旧 observer 失效：target 变化或已脱离 DOM 时重新挂载
  if (wreBgColorObserver) {
    if (wreBgColorObserverTarget === target && target.isConnected) return;
    wreBgColorObserver.disconnect();
    wreBgColorObserver = null;
  }
  wreBgColorObserverTarget = target;
  wreBgColorObserver = new MutationObserver(() => {
    // 防递归：回调自身写颜色会再次触发 mutation，延迟清标志
    if (wreBgApplyingColor) return;
    wreBgApplyingColor = true;
    const theme = WRE_BG_COLORS[wreBgIdx];
    const isDark = theme.type === 'dark';
    const textColor = isDark ? WRE_DARK_TEXT : WRE_LIGHT_TEXT;
    // 只处理内联声明了 color 的元素，避免误伤 background-color 等
    document.querySelectorAll('[style*="color"]').forEach((el) => {
      if (!el.style.color) return;
      const computed = window.getComputedStyle(el).color;
      const expected = isDark ? 'rgb(212, 212, 212)' : 'rgb(51, 51, 51)';
      if (computed !== expected) {
        el.style.setProperty('color', textColor, 'important');
      }
    });
    setTimeout(() => { wreBgApplyingColor = false; }, 0);
  });
  wreBgColorObserver.observe(target, { attributes: true, subtree: true, attributeFilter: ['style'] });
}

function stopBgColorObserver() {
  if (wreBgColorObserver) {
    wreBgColorObserver.disconnect();
    wreBgColorObserver = null;
  }
}

// 强制 Canvas 重渲染（仅双栏模式）：微信读书双栏切主题时会创建新 Canvas 却用旧主题色渲染，
// 需 display 切换强制重绘。滚动模式禁用——微信读书会自己重渲染，打断反而破坏它
function forceCanvasRedraw() {
  setTimeout(() => {
    if (!isDoubleColumnMode()) return;
    window.requestAnimationFrame(() => {
      document.querySelectorAll('.wr_canvasContainer canvas').forEach((c) => {
        c.style.display = 'none';
        void c.offsetHeight; // force reflow
        c.style.display = '';
      });
    });
  }, 1000);
}

function applyBgColor() {
  const theme = WRE_BG_COLORS[wreBgIdx];

  // 系统默认：撤除插件配色，微信读书原生外观接管。停掉文字色 observer，只清插件自己写入的内联文字色
  if (!theme.rgb) {
    stopBgColorObserver();
    setBgStyle('');
    clearPluginTextColors();
    if (isDoubleColumnMode()) forceCanvasRedraw();
    return;
  }

  const isDark = theme.type === 'dark';
  const textColor = isDark ? WRE_DARK_TEXT : WRE_LIGHT_TEXT;
  const isDualColumn = isDoubleColumnMode();

  if (isDualColumn) {
    // 双栏模式文字由 Canvas 渲染，CSS color 无法影响，只设背景色和 UI 元素颜色
    stopBgColorObserver();
    setBgStyle(buildBgCss(theme, true));
    document.querySelectorAll('[style*="color"]').forEach((el) => {
      el.style.removeProperty('color');
    });
    forceCanvasRedraw();
    return;
  }

  // === 滚动模式 ===
  setBgStyle(buildBgCss(theme, false));

  // 用内联样式强制覆盖文字颜色，先清除旧的内联颜色再设置新的
  const TEXT_SELECTORS = [
    '.readerChapterContent', '.readerChapterContent *',
    '.renderTargetContent', '.renderTargetContent *',
    '.renderTargetContainer', '.renderTargetContainer *',
    '.preRenderContainer', '.preRenderContainer *',
    '.readerChapterContent_container', '.readerChapterContent_container *',
    '.page', '.page *',
    '.wr_flyleaf_page', '.wr_flyleaf_page *',
    '.reader_flyleaf_container', '.reader_flyleaf_container *',
    '.wr_horizontalReader', '.wr_horizontalReader *',
  ];
  TEXT_SELECTORS.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      el.style.removeProperty('color');
      el.style.setProperty('color', textColor, 'important');
    });
  });

  startBgColorObserver();
  // 注意：滚动模式不强制 Canvas 重绘——微信读书切主题后自己会重渲染 canvas，
  // display 切换会打断它的重渲染（实测导致文字残留旧主题色）
}

/* ---- Canvas 像素自愈 ---- */
// 微信读书滚动模式正文由 canvas 渲染。系统深浅色切换时它在翻转 body class 之前
// 就按旧文字色画好了 canvas，之后不再重绘，也不响应 resize/display 切换——
// CSS 无法修正已画好的位图，只能读取像素分析后直接改写

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

// 收集正文 canvas。优先精确选择器；微信读书改版可能更换类名导致选择器静默失效，
// 匹配不到时退化为 reader 容器内的全部 canvas（按尺寸过滤图标类小 canvas）
function collectReaderCanvases() {
  let canvases = document.querySelectorAll(
    '.readerChapterContent canvas, .renderTargetContent canvas, .wr_canvasContainer canvas'
  );
  if (canvases.length === 0) {
    canvases = Array.prototype.filter.call(
      document.querySelectorAll('.readerContent canvas, .app_content canvas'),
      (c) => c.width >= 200 || c.height >= 200
    );
  }
  return canvases;
}

// 采样分析 canvas：区分「纯文字层」（大量透明像素）与「整页绘制层」（不透明）。
// 像素读取经自建 willReadFrequently 离屏画布中转，分析用缩小副本避免性能警告。
// 返回 null 表示像素不可读（跨域污染 / 零尺寸）
function analyzeCanvas(c) {
  const scale = Math.min(1, 256 / Math.max(c.width, c.height));
  const w = Math.max(1, Math.round(c.width * scale));
  const h = Math.max(1, Math.round(c.height * scale));
  const buf = document.createElement('canvas');
  buf.width = w;
  buf.height = h;
  let bctx = null;
  try {
    bctx = buf.getContext('2d', { willReadFrequently: true });
    if (bctx) bctx.drawImage(c, 0, 0, w, h);
  } catch (e) {
    return null;
  }
  if (!bctx) return null;
  let img;
  try {
    img = bctx.getImageData(0, 0, w, h);
  } catch (e) {
    return null;
  }
  const d = img.data;
  let transparent = 0;
  let total = 0;
  let fgN = 0;
  let fgR = 0;
  let fgG = 0;
  let fgB = 0;
  for (let i = 0; i < d.length; i += 4) {
    total++;
    if (d[i + 3] < 32) {
      transparent++;
      continue; // eslint-disable-line no-continue
    }
    fgN++;
    fgR += d[i];
    fgG += d[i + 1];
    fgB += d[i + 2];
  }
  if (total === 0) return null;
  return {
    transparentRatio: transparent / total,
    fgColor: fgN ? [Math.round(fgR / fgN), Math.round(fgG / fgN), Math.round(fgB / fgN)] : null,
  };
}

// 纯文字层重染（全尺寸读改写一次完成）：只改与旧文字色相近的像素，保留 alpha。
// 返回 false 表示无法读取或无法写回（WebGL/离屏渲染 canvas 拿不到 2D 上下文）
function recolorTextCanvas(c, oldRgb, textRgb) {
  const buf = document.createElement('canvas');
  buf.width = c.width;
  buf.height = c.height;
  let bctx = null;
  try {
    bctx = buf.getContext('2d', { willReadFrequently: true });
    if (bctx) bctx.drawImage(c, 0, 0);
  } catch (e) {
    return false;
  }
  if (!bctx) return false;
  let img;
  try {
    img = bctx.getImageData(0, 0, c.width, c.height);
  } catch (e) {
    return false;
  }
  let writeCtx = null;
  try {
    writeCtx = c.getContext('2d');
  } catch (e) {
    writeCtx = null;
  }
  if (!writeCtx) return false;
  const d = img.data;
  const [or, og, ob] = oldRgb;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue; // eslint-disable-line no-continue
    const dr = d[i] - or;
    const dg = d[i + 1] - og;
    const db = d[i + 2] - ob;
    if (dr * dr + dg * dg + db * db > 120 * 120) continue; // eslint-disable-line no-continue
    d[i] = textRgb[0];
    d[i + 1] = textRgb[1];
    d[i + 2] = textRgb[2];
  }
  writeCtx.putImageData(img, 0, 0);
  return true;
}

function healIssueLog(c, tag, msg) {
  const key = `${tag}:${c.width}x${c.height}`;
  if (wreHealIssueKeys && wreHealIssueKeys.has(key)) return;
  if (!wreHealIssueKeys) wreHealIssueKeys = new Set();
  wreHealIssueKeys.add(key);
  log('info', 'canvas 自愈', { size: `${c.width}x${c.height}`, msg });
}

function healReaderCanvases() {
  const theme = WRE_BG_COLORS[wreBgIdx];
  const isDark = theme.type === 'dark';
  const textRgb = hexToRgb(isDark ? WRE_DARK_TEXT : WRE_LIGHT_TEXT);
  const textLum = 0.299 * textRgb[0] + 0.587 * textRgb[1] + 0.114 * textRgb[2];

  collectReaderCanvases().forEach((c) => {
    if (!c.width || !c.height) return;
    const info = analyzeCanvas(c);
    if (!info) {
      healIssueLog(c, 'unreadable', '像素不可读（canvas 被跨域资源污染），跳过');
      return;
    }
    const fg = info.fgColor;
    if (!fg) return;
    const fgLum = 0.299 * fg[0] + 0.587 * fg[1] + 0.114 * fg[2];
    if (theme.rgb) {
      // 插件主题：期望文字色即插件常量，接近即正确（自愈循环重复调用，正确的保持静默）
      if (Math.abs(fgLum - textLum) < 40) return;
    } else {
      // 系统默认：原生文字色未必等于插件常量，只按方向判断残留
      const looksHealthy = isDark ? fgLum >= 120 : fgLum < 120;
      if (looksHealthy) return;
    }
    if (info.transparentRatio <= 0.5) {
      // 整页绘制层可能含插图，重染风险高，只记录不改写
      healIssueLog(c, 'opaque', `整页绘制层颜色异常 rgb(${fg.join(',')})，暂未处理`);
      return;
    }
    if (recolorTextCanvas(c, fg, textRgb)) {
      log('info', 'canvas 自愈：已重染', {
        size: `${c.width}x${c.height}`,
        from: `rgb(${fg.join(',')})`,
        to: `rgb(${textRgb.join(',')})`,
      });
    } else {
      healIssueLog(c, 'nowrite', '像素可读但无法写回（WebGL/离屏渲染 canvas），跳过');
    }
  });
}

// 系统深浅色切换处理（先于新主题样式应用）：作废旧自愈轮次 + 启动像素自愈循环
function onBgSystemThemeChange() {
  wreSystemThemeGen++;
  const gen = wreSystemThemeGen;
  wreHealIssueKeys = new Set(); // 异常日志重新计数
  // 像素自愈：切换瞬间立即改写 canvas 旧像素，随后重复几次，对抗微信读书迟到的重绘
  [0, 300, 800, 1500, 2500, 3500].forEach((delay) => {
    setTimeout(() => {
      if (gen !== wreSystemThemeGen) return;
      if (isDoubleColumnMode()) return; // 双栏模式由 forceCanvasRedraw 覆盖
      healReaderCanvases();
    }, delay);
  });
}

/* ---- 系统深浅色与 DOM 重建监听 ---- */

// 带延时重试的刷新：对抗微信读书自身样式更新（延迟多次覆盖）
function bgRefreshWithRetry(fn, delays) {
  fn();
  delays.forEach((d) => setTimeout(fn, d));
}

// 系统深浅色切换：恢复该模式记住的主题，重试覆盖。isDark 由事件给出，
// 不能读 body class——matchMedia 事件先于微信读书更新 body.wr_whiteTheme
function handleBgModeChange(isDark) {
  // 系统切换的 canvas 保护窗口 + 滚动模式兜底重绘（需先于新主题样式应用）
  onBgSystemThemeChange();
  // 恢复目标模式上次使用的主题
  applySystemBgMode(isDark);
  bgRefreshWithRetry(applyBgColor, [300, 800, 1500]);
}

function onBgSystemModeChange(isDark) {
  if (wreBgModeDedup !== null && isDark === wreBgModeDedup) return;
  wreBgModeDedup = isDark;
  log('info', '系统深浅色切换', { isDark });
  handleBgModeChange(isDark);
}

// 双信号监听：prefers-color-scheme 事件 + 微信读书自身的深浅色切换按钮（body class 翻转）
function startBgModeWatching() {
  wreBgModeDedup = isWereadDarkMode();

  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      onBgSystemModeChange(e.matches);
    });
  } catch (err) {
    log('warn', '监听系统深浅色失败', { error: String(err) });
  }

  const modeObserver = new MutationObserver(() => {
    onBgSystemModeChange(isWereadDarkMode());
  });
  modeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  modeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

// 内容区 DOM 监听：微信读书重建正文节点后重应用内联文字色（CSS 层规则持久生效不必重试）
let wreBgDomObserver = null;
let wreBgDomTimer = null;

function startBgDomWatching() {
  const attach = () => {
    const target = document.querySelector('.readerContent');
    if (!target) return false;
    applyBgColor();
    if (!wreBgDomObserver || wreBgDomObserver.__target !== target) {
      if (wreBgDomObserver) wreBgDomObserver.disconnect();
      wreBgDomObserver = new MutationObserver(() => {
        if (wreBgDomTimer) clearTimeout(wreBgDomTimer);
        wreBgDomTimer = setTimeout(() => {
          applyBgColor();
        }, 400);
      });
      wreBgDomObserver.__target = target;
      wreBgDomObserver.observe(target, { childList: true, subtree: true });
    }
    return true;
  };

  if (attach()) return;
  // .readerContent 尚未创建：轮询等待
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    if (attach() || tries > 120) clearInterval(timer);
  }, 500);
}

// 启动时初始化主题：校正存储主题与系统模式的失配，激活索引 = 当前模式记忆值
function initBgTheme() {
  const isDark = isWereadDarkMode();
  const key = isDark ? 'bgDarkIdx' : 'bgLightIdx';
  if (!isValidBgIdx(WRE_STATE[key], isDark ? 'dark' : 'light')) {
    WRE_STATE[key] = WRE_DEFAULT_STATE[key];
  }
  wreBgIdx = WRE_STATE[key];
  applyBgColor();
  startBgModeWatching();
  startBgDomWatching();
  log('info', '正文主题已初始化', { name: WRE_BG_COLORS[wreBgIdx].name, isDark });
}

/** 同步设置面板的主题行 UI（名称 + 色块） */
function updateBgThemeUI() {
  if (!wreRoot) return;
  const name = wreRoot.querySelector('#wre-bg-name');
  const swatch = wreRoot.querySelector('#wre-bg-swatch');
  const theme = WRE_BG_COLORS[wreBgIdx];
  if (name && theme) {
    name.textContent = theme.name;
  }
  if (swatch && theme) {
    swatch.style.background = theme.rgb || 'linear-gradient(135deg, #ddd 45%, #333 55%)';
    swatch.style.display = 'inline-block';
  }
}

/* ========== 快捷键系统 ========== */

function toggleShortcutsHelp() {
  const modal = wreRoot?.querySelector('#wre-shortcuts-modal');
  if (!modal) return;
  const isVisible = modal.classList.contains('wre-visible');
  if (isVisible) {
    modal.classList.remove('wre-visible');
  } else {
    modal.classList.add('wre-visible');
  }
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    // 进入全屏：保存当前状态，屏比设为 100%
    wreFullscreenPreviousRatio = WRE_STATE.screenRatio;
    WRE_STATE.screenRatio = 100;
    applyScreenRatio(100);
    scheduleWereadLayoutReflow('fullscreen-enter');
    updateScreenRatioUI();
    document.documentElement.requestFullscreen().catch((err) => {
      log('warn', '进入全屏失败', { error: String(err) });
    });
    saveState();
    log('info', '进入全屏模式', { previousRatio: wreFullscreenPreviousRatio });
  } else {
    // 退出全屏
    document.exitFullscreen().then(() => {
      // 恢复在 fullscreenchange 事件中处理
    }).catch((err) => {
      log('warn', '退出全屏失败', { error: String(err) });
    });
  }
}

function handleFullscreenChange() {
  if (!document.fullscreenElement && wreFullscreenPreviousRatio !== null) {
    // 恢复屏占比
    const restoreRatio = wreFullscreenPreviousRatio;
    wreFullscreenPreviousRatio = null;
    WRE_STATE.screenRatio = restoreRatio;
    applyScreenRatio(restoreRatio);
    scheduleWereadLayoutReflow('fullscreen-exit');
    updateScreenRatioUI();
    saveState();
    log('info', '退出全屏模式，已恢复屏占比', { restoredRatio: restoreRatio });
  }
}

function updateScreenRatioUI() {
  if (!wreRoot) return;
  const slider = wreRoot.querySelector('#wre-screen-ratio');
  const value = wreRoot.querySelector('#wre-screen-ratio-value');
  if (slider) slider.value = String(WRE_STATE.screenRatio);
  if (value) value.textContent = `${WRE_STATE.screenRatio}%`;
}

function handleAllKeyboard(event) {
  // 只响应真实键盘事件，忽略程序派发的事件
  if (!event.isTrusted) return;

  // 不在输入框内响应快捷键
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || document.activeElement?.isContentEditable) {
    return;
  }

  // 组合键不触发：Ctrl / Alt / Meta 按下时跳过，避免与浏览器原生快捷键冲突
  if (event.ctrlKey || event.altKey || event.metaKey) return;

  // 输入法组词中不响应，避免打断拼音输入
  if (event.isComposing) return;

  // 问号键：兼容中文输入法全角「？」与不同键盘布局，用物理键 Slash + Shift 兜底识别
  if (event.key === '?' || event.key === '？' || (event.code === 'Slash' && event.shiftKey)) {
    event.preventDefault();
    toggleShortcutsHelp();
    return;
  }

  switch (event.key) {
    case ' ':
      event.preventDefault();
      toggleAutoRead();
      break;
    case 'i':
    case 'I':
      event.preventDefault();
      toggleImmersive();
      break;
    case 'g':
    case 'G':
      event.preventDefault();
      ghToggle();
      break;
    case 'f':
    case 'F':
      event.preventDefault();
      toggleFullscreen();
      break;
  }
}

/* ========== UI 事件绑定 ========== */

function bindEvents(root) {
  const fab = root.querySelector('#wre-fab');
  const menu = root.querySelector('#wre-main-menu');
  const screenRatioSlider = root.querySelector('#wre-screen-ratio');
  const screenRatioValue = root.querySelector('#wre-screen-ratio-value');
  const screenRatioQuick = root.querySelector('#wre-screen-ratio-quick');

  // 悬浮球空闲收起：进入阅读页先完整显示 5 秒，之后淡成半透明小圆点；
  // 鼠标靠近左上角感应区（半径 90px）即恢复完整，移开 0.9 秒后再收起。
  const FAB_REST_DELAY_MS = 5000;   // 进入阅读页后完整显示的时长
  const FAB_REST_IDLE_MS = 900;     // 鼠标离开感应区后多久收起
  const FAB_HOVER_RADIUS_PX = 90;   // 以悬浮球中心为圆心的感应半径
  let fabRestTimer = null;

  const clearFabRestTimer = () => {
    if (fabRestTimer) { clearTimeout(fabRestTimer); fabRestTimer = null; }
  };
  const wakeFab = () => {
    clearFabRestTimer();
    root.classList.remove('wre-fab-resting');
    root.classList.remove('wre-immersive-fab');
  };
  const restFab = () => {
    clearFabRestTimer();
    // 菜单展开时不收起
    if (menu.classList.contains('wre-visible')) return;
    // 沉浸模式：完全隐藏（左上角原位置悬停可唤出），比普通空闲收起更彻底
    if (WRE_STATE.immersiveMode) {
      root.classList.add('wre-immersive-fab');
      return;
    }
    root.classList.add('wre-fab-resting');
  };
  const scheduleRestFab = (delay) => {
    clearFabRestTimer();
    fabRestTimer = setTimeout(restFab, delay);
  };
  const isNearFab = (event) => {
    const rect = fab.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return Math.hypot(event.clientX - cx, event.clientY - cy) <= FAB_HOVER_RADIUS_PX;
  };

  // 悬浮球：鼠标悬停即展开菜单（无需点击），移开后延迟收起
  let menuCloseTimer = null;
  const openMenu = () => {
    if (menuCloseTimer) { clearTimeout(menuCloseTimer); menuCloseTimer = null; }
    menu.classList.add('wre-visible');
    wakeFab();
  };
  const scheduleCloseMenu = () => {
    if (menuCloseTimer) clearTimeout(menuCloseTimer);
    menuCloseTimer = setTimeout(() => {
      menu.classList.remove('wre-visible');
      menuCloseTimer = null;
      // 菜单收起后按空闲节奏重新收起悬浮球
      scheduleRestFab(FAB_REST_IDLE_MS);
    }, 250);
  };
  fab.addEventListener('mouseenter', openMenu);
  fab.addEventListener('mouseleave', scheduleCloseMenu);
  menu.addEventListener('mouseenter', openMenu);
  menu.addEventListener('mouseleave', scheduleCloseMenu);

  if (isReaderPage()) {
    scheduleRestFab(FAB_REST_DELAY_MS);
    document.addEventListener('mousemove', (event) => {
      if (isNearFab(event)) {
        wakeFab();
      } else if (!root.classList.contains('wre-fab-resting') && !fabRestTimer) {
        scheduleRestFab(FAB_REST_IDLE_MS);
      }
    }, true);
  }

  fab.addEventListener('click', (event) => {
    event.stopPropagation();
    // 悬停已展开菜单，点击时保持展开（不再切换，避免"点一下反而收起"）
    openMenu();
  });

  document.addEventListener('click', () => {
    menu.classList.remove('wre-visible');
  });

  menu.addEventListener('click', (event) => {
    event.stopPropagation();
    const item = event.target.closest('.wre-menu-item');
    if (!item) {
      return;
    }
    handleMenuClick(item.getAttribute('data-action'));
    menu.classList.remove('wre-visible');
  });

  root.querySelectorAll('.wre-modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        overlay.classList.remove('wre-visible');
      }
    });
  });

  root.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => {
      closeModal(button.getAttribute('data-close'));
    });
  });

  screenRatioSlider.addEventListener('input', (event) => {
    const value = Number.parseInt(event.target.value, 10);
    screenRatioValue.textContent = `${value}%`;
    WRE_STATE.screenRatio = value;
    const applied = applyScreenRatio(value);
    scheduleWereadLayoutReflow('slider-input');
    const now = Date.now();
    if (now - lastPreviewLogAt > 250) {
      lastPreviewLogAt = now;
      log('info', '预览屏占比', applied);
    }
  });

  screenRatioSlider.addEventListener('change', async (event) => {
    const value = Number.parseInt(event.target.value, 10);
    WRE_STATE.screenRatio = value;
    const applied = applyScreenRatio(value);
    scheduleWereadLayoutReflow('slider-change');
    await saveState();
    log('info', '用户完成屏占比调整', applied);
  });

  if (screenRatioQuick) {
    screenRatioQuick.addEventListener('click', async (event) => {
      const btn = event.target.closest('button[data-ratio]');
      if (!btn) {
        return;
      }
      const value = Number.parseInt(btn.getAttribute('data-ratio'), 10);
      if (Number.isNaN(value)) {
        return;
      }
      screenRatioSlider.value = String(value);
      screenRatioValue.textContent = `${value}%`;
      WRE_STATE.screenRatio = value;
      const applied = applyScreenRatio(value);
      scheduleWereadLayoutReflow('quick-ratio');
      await saveState();
      log('info', '快捷设置屏占比', applied);
    });
  }

  // 沉浸模式开关（设置面板按钮）
  const immersiveToggle = root.querySelector('#wre-immersive-toggle');
  if (immersiveToggle) {
    immersiveToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleImmersive();
    });
  }

  // 自动阅读：开始/暂停
  const autoReadToggle = root.querySelector('#wre-autoread-toggle');
  if (autoReadToggle) {
    autoReadToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      try {
        toggleAutoRead();
      } catch (err) {
        log('error', '自动阅读切换失败', { error: String(err) });
      }
    });
  }

  // 自动阅读：速度滑块
  const autoReadSpeed = root.querySelector('#wre-autoread-speed');
  if (autoReadSpeed) {
    let autoReadSpeedChangeTimer = null;
    autoReadSpeed.addEventListener('input', () => {
      const speed = Number.parseInt(autoReadSpeed.value, 10);
      const speedValue = root.querySelector('#wre-autoread-speed-value');
      if (speedValue) speedValue.textContent = String(speed);
      if (autoReadSpeedChangeTimer) clearTimeout(autoReadSpeedChangeTimer);
      autoReadSpeedChangeTimer = setTimeout(async () => {
        setAutoReadSpeed(speed);
        await saveState();
      }, 300);
    });
    autoReadSpeed.addEventListener('change', async () => {
      const speed = Number.parseInt(autoReadSpeed.value, 10);
      setAutoReadSpeed(speed);
      await saveState();
    });
  }

  // 自动阅读：方向切换
  const dirButtons = root.querySelectorAll('.wre-dir-btn');
  dirButtons.forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const dir = btn.getAttribute('data-dir');
      if (dir !== WRE_STATE.autoRead.direction) {
        setAutoReadDirection(dir);
        await saveState();
      }
    });
  });

  // 正文主题：‹ › 循环切换当前模式下的预设
  const bgPrev = root.querySelector('#wre-bg-prev');
  const bgNext = root.querySelector('#wre-bg-next');
  if (bgPrev) {
    bgPrev.addEventListener('click', (event) => {
      event.stopPropagation();
      cycleBgTheme(-1);
    });
  }
  if (bgNext) {
    bgNext.addEventListener('click', (event) => {
      event.stopPropagation();
      cycleBgTheme(1);
    });
  }

  // 外观主题档切换（浅色 / 深色 / 跟随系统）
  const themeToggle = root.querySelector('#wre-theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', async (event) => {
      const btn = event.target.closest('.wre-theme-btn');
      if (!btn) return;
      event.stopPropagation();
      const theme = btn.getAttribute('data-theme');
      if (!theme || theme === WRE_STATE.theme) return;
      WRE_STATE.theme = theme;
      applyTheme();
      updateThemeUI();
      await saveState();
      log('info', '外观主题档已切换', { theme, effective: resolveEffectiveTheme(theme) });
    });
    updateThemeUI();
  }
}

function handleMenuClick(action) {
  log('info', '用户触发菜单操作', { action });

  switch (action) {
    case 'immersive':
      toggleImmersive();
      break;
    case 'read-settings':
      openModal('#wre-read-settings-modal');
      break;
    case 'restore-default':
      stopAutoRead();
      WRE_STATE = { ...WRE_DEFAULT_STATE };
      const applied = applyScreenRatio(WRE_STATE.screenRatio);
      scheduleWereadLayoutReflow('restore-default');
      applyImmersive();
      // 正文主题恢复默认档（按当前模式）
      wreBgIdx = isWereadDarkMode() ? WRE_STATE.bgDarkIdx : WRE_STATE.bgLightIdx;
      applyBgColor();
      saveState();
      if (wreRoot) {
        const slider = wreRoot.querySelector('#wre-screen-ratio');
        const value = wreRoot.querySelector('#wre-screen-ratio-value');
        if (slider) {
          slider.value = String(WRE_STATE.screenRatio);
        }
        if (value) {
          value.textContent = `${WRE_STATE.screenRatio}%`;
        }
        updateAutoReadUI();
        applyTheme();
        updateThemeUI();
        updateBgThemeUI();
      }
      log('warn', '已恢复默认设置', applied);
      break;
    case 'shortcuts':
      openModal('#wre-shortcuts-modal');
      break;
    default:
      log('warn', '该菜单功能尚未实现', { action });
      break;
  }
}

async function applySavedScreenRatioOnInit() {
  const ratio = WRE_STATE.screenRatio;
  const maxAttempts = 50; // 400ms × 50 = 20s（rAF 在后台标签页会停，改用定时轮询）
  for (let i = 0; i < maxAttempts; i += 1) {
    const container = getReaderContainerElement();
    const content = getPrimaryContentElement();
    const containerWidth = container?.getBoundingClientRect?.().width;
    const contentWidth = content?.getBoundingClientRect?.().width;
    const containerReady = Number.isFinite(containerWidth) && containerWidth > 0;
    const contentReady = Number.isFinite(contentWidth) && contentWidth > 0;

    // 翻页模式：基准容器 .readerChapterContent_container 是正文祖先，正文就绪即视为就绪；
    // 滚动模式：没有该基准容器，只要正文 .readerChapterContent + .app_content 就绪即可，
    // 不能再强等 container（否则滚动模式永远等不到，刷新后屏占比丢失）。
    const ready = containerReady
      ? contentReady
      : (detectScrollMode() && contentReady);

    if (ready) {
      const applied = applyScreenRatio(ratio);
      // 重排统一由 scheduleUnderlineLayerReflow 负责（它本来就要等划线层渲染完再算一次坐标），
      // 这里不再单独派发 resize —— 刷新时多次 resize 会让正文整块闪，像「又刷新了一次」。
      scheduleUnderlineLayerReflow('init-apply');
      log('info', '已在刷新后自动应用已保存的屏占比', applied);
      // 兜底：稍后再应用一次，防止早期模式判定/渲染时机偏差（如 app_content 晚于正文出现）
      setTimeout(() => {
        applyScreenRatio(WRE_STATE.screenRatio);
        log('info', '屏占比二次兜底应用', { ratio: WRE_STATE.screenRatio, scrollMode: detectScrollMode() });
      }, 800);
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  // 兜底：即使没判定「就绪」也强制应用一次（CSS 幂等；微信读书加载慢时也能补上）
  const applied = applyScreenRatio(ratio);
  scheduleUnderlineLayerReflow('init-apply-fallback');
  setTimeout(() => {
    applyScreenRatio(WRE_STATE.screenRatio);
  }, 1200);
  log('warn', '刷新后未判定就绪，已兜底应用屏占比', { ratio, applied });
  return false;
}

async function init() {
  const t0 = performance.now();
  await loadState();
  // 先把外观主题写到 <html>，并监听系统深浅色（选「跟随系统」时实时刷新）
  applyTheme();
  watchSystemTheme();
  // 正文主题色：按当前系统模式激活记忆档位，并监听模式切换与 DOM 重建
  initBgTheme();
  const t1 = performance.now();
  log('info', '初始化准备应用屏占比', {
    screenRatio: WRE_STATE.screenRatio,
    bodyClassBefore: document.body?.className || '',
  });
  createUI();
  initGhDisguise();
  const t2 = performance.now();

  // 恢复沉浸模式状态（记忆在本机）
  applyImmersive();

  ensureStyleTag();
  wreStyleTag.textContent = '';
  const t3 = performance.now();
  await primeScreenBasePx(true);
  const t4 = performance.now();
  await applySavedScreenRatioOnInit();
  const t5 = performance.now();
  log('info', '[perf] init 各阶段耗时', {
    loadState: Math.round(t1 - t0),
    createUI: Math.round(t2 - t1),
    storageGet: Math.round(t3 - t2),
    primeScreen: Math.round(t4 - t3),
    applyRatio: Math.round(t5 - t4),
    total: Math.round(t5 - t0),
  });

  // 监听 <head> 中 <style> 标签注入，确保我们的样式始终在最后（优先级最高）
  let headMoveTimer = null;
  const headObserver = new MutationObserver((mutations) => {
    // 只关心新增的 <style> 标签
    const hasNewStyle = mutations.some((m) =>
      Array.from(m.addedNodes).some((n) => n.nodeName === 'STYLE' && n.id !== 'we-read-enhancer-style')
    );
    if (!hasNewStyle) return;

    if (headMoveTimer) clearTimeout(headMoveTimer);
    headMoveTimer = setTimeout(() => {
      const ourStyle = document.getElementById('we-read-enhancer-style');
      if (ourStyle && ourStyle !== document.head.lastElementChild) {
        document.head.appendChild(ourStyle);
        log('info', '已将插件样式移至 <head> 末尾');
      }
      headMoveTimer = null;
    }, 30);
  });
  headObserver.observe(document.head, { childList: true });

  // 注册键盘快捷键
  document.addEventListener('keydown', handleAllKeyboard);

  // 滚动模式：鼠标靠近视口最右侧时淡入自绘滚动条，移开延迟淡出（拖动时不隐藏）
  let wreScrollbarHideTimer = null;
  const wreHideScrollbar = () => {
    if (wreScrollbarDragging) return;
    if (wreScrollbarHideTimer) { clearTimeout(wreScrollbarHideTimer); wreScrollbarHideTimer = null; }
    document.documentElement.classList.remove('wre-show-scrollbar');
  };
  document.addEventListener('mousemove', (e) => {
    if (!document.documentElement.classList.contains('wre-scrollmode')) return;
    const nearRight = e.clientX >= window.innerWidth - 24;
    if (nearRight) {
      if (wreScrollbarHideTimer) { clearTimeout(wreScrollbarHideTimer); wreScrollbarHideTimer = null; }
      document.documentElement.classList.add('wre-show-scrollbar');
      updateCustomScrollbar();
    } else if (!wreScrollbarDragging
        && document.documentElement.classList.contains('wre-show-scrollbar')
        && !wreScrollbarHideTimer) {
      wreScrollbarHideTimer = setTimeout(() => {
        document.documentElement.classList.remove('wre-show-scrollbar');
        wreScrollbarHideTimer = null;
      }, 400);
    }
  }, { passive: true });
  // 鼠标离开页面（移出窗口）时立即隐藏，避免最后一次 mousemove 停在右侧导致滚动条残留
  document.addEventListener('mouseleave', wreHideScrollbar);
  // 滚动 / 尺寸变化时更新自绘滚动条的位置与高度
  window.addEventListener('scroll', updateCustomScrollbar, { passive: true });
  window.addEventListener('resize', updateCustomScrollbar);

  // 监听全屏变化（Esc 键或浏览器按钮退出全屏时恢复屏占比）
  document.addEventListener('fullscreenchange', handleFullscreenChange);
}

if (document.body) {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init);
}

/* ========== GitHub 伪装层 ==========
 * 叠加在沉浸式内核之上：只把微信读书原生栏位「变透明」并用 GitHub 外观覆盖，
 * 不动正文布局（不改宽度/边距/高度），因此滚动、翻章、划线等原生行为全部保持。
 */

const WRE_GH_OWNER = 'dev-lab';
const WRE_GH_REPO = 'notes';
const WRE_GH_FILE = 'README.md';
const WRE_GH_PAGE_TITLE = `${WRE_GH_FILE} at main · ${WRE_GH_OWNER}/${WRE_GH_REPO}`;
const WRE_GH_FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#1f2328" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>'
);

/* 第二套皮肤：Notion 文档页（白底、左侧页面树、面包屑）
 * 语境是「在看公司文档」，比代码仓库更贴近长文阅读，且不需要文件树语义。 */
const WRE_NB_TEAM = 'Acme 团队';
const WRE_NB_SPACE = '产品空间';
const WRE_NB_PAGE = '需求评审记录';
const WRE_NB_PAGE_TITLE = `${WRE_NB_PAGE} · ${WRE_NB_TEAM}`;
const WRE_NB_FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#1f2328"/><text x="8" y="11.6" font-family="Helvetica,Arial,sans-serif" font-size="10.5" font-weight="700" fill="#ffffff" text-anchor="middle">N</text></svg>'
);

function wreCurrentSkin() {
  return WRE_STATE.skin === 'notion' ? 'notion' : 'github';
}

// 内联 SVG 图标（GitHub Octicons）
const WRE_SVG = {
  logo: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="26" height="26" aria-hidden="true"><path fill="#fff" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>',
  search: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z"/></svg>',
  bell: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 16a2 2 0 0 0 1.985-1.75c.017-.137-.097-.25-.235-.25h-3.5c-.138 0-.252.113-.235.25A2 2 0 0 0 8 16ZM3 5a5 5 0 0 1 10 0v2.947c0 .05.015.098.042.139l1.703 2.555A1.519 1.519 0 0 1 13.482 13H2.518a1.516 1.516 0 0 1-1.263-2.36l1.703-2.554A.255.255 0 0 0 3 7.947Z"/></svg>',
  plus: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"/></svg>',
  repo: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z"/></svg>',
  code: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="m11.28 3.22 4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L13.94 8l-3.72-3.72a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215Zm-6.56 0a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L2.06 8l3.72 3.72a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L.47 8.53a.75.75 0 0 1 0-1.06Z"/></svg>',
  issue: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><path fill="currentColor" d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"/></svg>',
  pr: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/></svg>',
  actions: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M0 1.75C0 .784.784 0 1.75 0h3.5C6.216 0 7 .784 7 1.75v3.5A1.75 1.75 0 0 1 5.25 7H4v4a1 1 0 0 0 1 1h4v-1.25C9 9.784 9.784 9 10.75 9h3.5c.966 0 1.75.784 1.75 1.75v3.5A1.75 1.75 0 0 1 14.25 16h-3.5A1.75 1.75 0 0 1 9 14.25v-.75H5A2.5 2.5 0 0 1 2.5 11V7H1.75A1.75 1.75 0 0 1 0 5.25Zm1.75-.25a.25.25 0 0 0-.25.25v3.5c0 .138.112.25.25.25h3.5a.25.25 0 0 0 .25-.25v-3.5a.25.25 0 0 0-.25-.25Zm9 9a.25.25 0 0 0-.25.25v3.5c0 .138.112.25.25.25h3.5a.25.25 0 0 0 .25-.25v-3.5a.25.25 0 0 0-.25-.25Z"/></svg>',
  dir: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="#54aeff" d="M1.75 1h5c.55 0 1.07.26 1.4.7l.9 1.2c.04.06.11.1.19.1h4.01c.97 0 1.75.78 1.75 1.75v8.5c0 .97-.78 1.75-1.75 1.75H1.75C.78 15 0 14.22 0 13.25V2.75C0 1.78.78 1 1.75 1Z"/></svg>',
  file: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z"/></svg>',
  book: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M0 1.75A.75.75 0 0 1 .75 1h4.253c1.227 0 2.317.59 3 1.501A3.743 3.743 0 0 1 11.006 1h4.245a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-4.507a2.25 2.25 0 0 0-1.591.659l-.622.621a.75.75 0 0 1-1.06 0l-.622-.621A2.25 2.25 0 0 0 5.258 13H.75a.75.75 0 0 1-.75-.75Zm7.251 10.324.004-5.073-.002-2.253A2.25 2.25 0 0 0 5.003 2.5H1.5v9h3.757a3.75 3.75 0 0 1 1.994.574ZM8.755 4.75l-.004 7.322a3.752 3.752 0 0 1 1.992-.572H14.5v-9h-3.495a2.25 2.25 0 0 0-2.25 2.25Z"/></svg>',
  branch: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.492 2.492 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/></svg>',
};

// 只有「正文真的是 Canvas 位图」才算双栏。单栏翻页模式里
// .readerControls_item.isHorizontalReader 这个按钮同样存在，拿它当判据会把单栏翻页
// 误判成双栏 —— 副作用是卡片外框失效、侧栏被当成 canvas 覆盖逻辑而不显示。
function ghIsDoubleColumn() {
  const canvas = document.querySelector('.wr_canvasContainer canvas');
  if (!canvas) return false;
  const rect = canvas.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// 侧栏兜底：拿不到书籍目录时用静态假文件树，保证 GitHub 仓库观感
function ghFallbackTreeHtml() {
  return [
    { type: 'dir', name: 'src' },
    { type: 'dir', name: 'docs' },
    { type: 'dir', name: 'public' },
    { type: 'file', name: WRE_GH_FILE, active: true },
    { type: 'file', name: 'package.json' },
    { type: 'file', name: 'LICENSE' },
    { type: 'file', name: '.gitignore' },
  ].map((item) => `
    <div class="wre-gh-tree-item${item.active ? ' wre-gh-tree-active' : ''}">
      ${item.type === 'dir' ? WRE_SVG.dir : WRE_SVG.file}
      <span>${item.name}</span>
    </div>`).join('');
}

/* ---- 侧栏 = 书籍目录：把章节渲染成文件列表，点一下真的跳章 ---- */

const GH_CATALOG_SCOPES = [
  '.readerCatalog',
  '[class*="readerCatalog"]',
  '[class*="catalogPanel"]',
  '[class*="catalog"]',
];

// 从微信读书目录 DOM 里取章节项；取不到返回空数组，调用方回退静态假树。
// 章节名固定是 .readerCatalog_list_item_title_text（a.html 实测每章一个），
// 直接按它取最稳：笼统按 li/[class*=item] 取会把行内 meta（「当前读到 40%」「书签」）也算成章节。
function ghCollectCatalogItems() {
  for (const sel of GH_CATALOG_SCOPES) {
    const root = document.querySelector(sel);
    if (!root) continue;
    const titled = Array.from(root.querySelectorAll('[class*="list_item_title_text"]'))
      .filter((el) => (el.textContent || '').trim().length > 0);
    if (titled.length >= 3) return titled;
    const raw = Array.from(root.querySelectorAll('li, [class*="item"], [class*="Item"]'));
    if (raw.length < 3) continue;
    const items = raw.filter((el) => {
      if (el.querySelector('li, [class*="item"], [class*="Item"]')) return false; // 只看叶子项
      const text = (el.textContent || '').trim();
      return text.length > 0 && text.length <= 80;
    });
    if (items.length >= 3) return items;
  }
  return [];
}

// 当前章高亮：标记通常落在最外层行（readerCatalog_list_item）上，节点自己身上不一定有
function ghCatalogActiveIndex(items) {
  return items.findIndex((el) => {
    const row = el.closest?.('.readerCatalog_list_item') || el;
    return /active|current|selected/i.test(`${el.className || ''} ${row.className || ''}`);
  });
}

// 章节名 → 文件名：`01 开篇.md`，过长截断，避免侧栏换行
function ghChapterFileName(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return WRE_GH_FILE;
  const base = clean.length > 26 ? `${clean.slice(0, 26)}…` : clean;
  return /\.\w{1,5}$/.test(base) ? base : `${base}.md`;
}

let ghCatalogSignature = '';
let ghLastCatalogScan = 0;
let ghCatalogRefs = [];

// 目录面板关着时，整棵 .readerCatalog 是 display:none（实测 0x0），里面的行也跟着 0 尺寸。
// 点击处理器往往只在「行是可见元素」时才算数，所以派发事件前临时让面板按正常尺寸上屏，
// 派发完立刻还原 —— 既不改伪装样式，也不会真的把原生目录留在画面上。
const GH_CATALOG_REVEAL_PROPS = [
  'display', 'visibility', 'opacity', 'pointer-events',
  'position', 'left', 'top', 'width', 'max-height', 'overflow', 'z-index',
];

function ghRevealCatalogRoot() {
  const root = document.querySelector('.readerCatalog') || document.querySelector('[class*="catalog"]');
  if (!root) return null;
  const rect = root.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) return null; // 本来就开着
  const saved = GH_CATALOG_REVEAL_PROPS.map((prop) => [
    prop, root.style.getPropertyValue(prop), root.style.getPropertyPriority(prop),
  ]);
  const set = (prop, value) => root.style.setProperty(prop, value, 'important');
  set('display', 'block');
  set('visibility', 'visible');
  set('opacity', '1');
  set('pointer-events', 'auto');
  set('position', 'fixed');
  set('left', '0');
  set('top', '0');
  set('width', '320px');
  set('max-height', '80vh');
  set('overflow', 'auto');
  set('z-index', '2147483647');
  return () => {
    saved.forEach(([prop, value, priority]) => {
      if (value) root.style.setProperty(prop, value, priority);
      else root.style.removeProperty(prop);
    });
  };
}

// 模拟一次真实点击：微信读书的控件不吃裸 .click()，把指针事件按真实顺序补一遍，
// 顺带 hover/focus（有些控件要先 hover 才挂处理器）。伪装态下这些控件是
// pointer-events:none，合成事件不受影响，所以照样能触发。
function ghDispatchClick(node) {
  if (!node) return;
  ['mouseover', 'mouseenter', 'mousemove'].forEach((type) => {
    node.dispatchEvent(new MouseEvent(type, { bubbles: type !== 'mouseenter', cancelable: true }));
  });
  try {
    node.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerType: 'mouse', isPrimary: true,
    }));
  } catch (e) { /* 不支持 PointerEvent 就只发鼠标事件 */ }
  try { node.focus?.({ preventScroll: true }); } catch (e) { /* 不可聚焦就跳过 */ }
  node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  try { node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true })); } catch (e) { /* 同上 */ }
  node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  // 只派发一次 click：再补 node.click() 会让同一个处理器跑两遍（章节会被跳两次）
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

// 目录项点击。真实结构（a.html 实测）：
//   li.readerCatalog_list_item > .readerCatalog_list_item_inner > .readerCatalog_list_item_info
//     > .readerCatalog_list_item_title > .readerCatalog_list_item_title_text
// 事件会冒泡，所以点最内层的章节名一次就够 —— 逐层补点会让跳章触发好几遍。
// 万一某层处理器拦了冒泡，上层重试会改点整行（见 ghJumpToCatalogEntry）。
function ghActivateCatalogItem(el, { reveal = true } = {}) {
  if (!el) return;
  // 点目录按钮本身不要展开面板：那会把「打开面板」这件正事搅乱
  const restore = reveal ? ghRevealCatalogRoot() : null;
  try {
    ghDispatchClick(el);
  } finally {
    restore?.();
  }
}

const ghSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 「当前在第几章」的信号：顶栏只有书名（readerTopBar_title_link，换章也不变），
// 拿它当判据会永远判成「没换」—— 所以指纹取正文开头，没有正文才退回目录高亮项/顶栏章名。
function ghChapterTitleText() {
  const scope = document.querySelector('.readerChapterContent') || document.querySelector('.app_content');
  const text = String(scope?.innerText || '').replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 60);
  const items = ghCollectCatalogItems();
  const idx = ghCatalogActiveIndex(items);
  if (idx >= 0) return (items[idx].textContent || '').trim();
  const bar = document.querySelector('.readerTopBar_title_chapter');
  return (bar?.textContent || '').trim();
}

function ghCatalogRoot() {
  return document.querySelector('.readerCatalog') || document.querySelector('[class*="catalog"]');
}

function ghCatalogRootSize() {
  const root = ghCatalogRoot();
  if (!root) return '(无面板)';
  const rect = root.getBoundingClientRect();
  return `${Math.round(rect.width)}x${Math.round(rect.height)}`;
}

function ghCatalogPanelOpen() {
  const rect = ghCatalogRoot()?.getBoundingClientRect();
  return !!rect && rect.width > 0 && rect.height > 0;
}

// 目录入口就在右侧竖排底栏的第一个按钮上：button.readerControls_item.catalog
// （伪装态下底栏是 pointer-events:none，所以照样得走全套指针事件）
function ghCatalogTrigger() {
  return document.querySelector('.readerControls_item.catalog')
    || Array.from(document.querySelectorAll('.readerControls_item'))
      .find((el) => /catalog|目录/i.test(String(el.className || '')))
    || null;
}

async function ghOpenCatalogPanel() {
  if (ghCatalogPanelOpen()) return true;
  const trigger = ghCatalogTrigger();
  if (!trigger) return false;
  ghActivateCatalogItem(trigger, { reveal: false });
  for (let waited = 0; waited < 800; waited += 100) {
    await ghSleep(100);
    if (ghCatalogPanelOpen()) return true;
  }
  return false;
}

// 点完章节把面板收回去，别让原生目录留在伪装界面上
function ghCloseCatalogPanel() {
  if (!ghCatalogPanelOpen()) return;
  const trigger = ghCatalogTrigger();
  if (trigger) ghActivateCatalogItem(trigger, { reveal: false });
}

// 微信读书用 li.readerCatalog_list_item_selected 标当前章：比「正文变了没」更准更便宜
// （正文可能预渲染了下一章，开头文字不一定会跟着跳）。
// 注意行的 textContent 还带着 meta（「当前读到 40%」「书签」），只能取标题节点。
function ghCatalogSelectedLabel() {
  const row = document.querySelector('.readerCatalog_list_item_selected');
  if (!row) return '';
  const title = row.querySelector('[class*="list_item_title_text"]') || row;
  return (title.textContent || '').trim();
}

async function ghWaitChapterChange(before, label, timeout) {
  for (let waited = 0; waited < timeout; waited += 100) {
    await ghSleep(100);
    if (label && ghCatalogSelectedLabel() === label) return true;
    const now = ghChapterTitleText();
    if (now && now !== before) return true;
  }
  return false;
}

// 跳章：行是 0 尺寸时点不动，所以先点底栏的目录按钮把面板真正打开，
// 再按「点章节名 → 按章节名重取节点 → 点最外层行」逐级重试，
// 每次都用正文指纹确认是否真的换了章。返回 { ok, report } 便于把卡点告诉用户。
async function ghJumpToCatalogEntry(node, label) {
  const report = [];
  const before = ghChapterTitleText();
  const attempt = async (target, tag) => {
    if (!target) return false;
    ghActivateCatalogItem(target);
    const ok = await ghWaitChapterChange(before, label, 700);
    report.push(`${tag}${ok ? '成功' : '无效'}`);
    return ok;
  };

  const opened = await ghOpenCatalogPanel();
  if (!opened) report.push('目录按钮没打开面板');

  // 面板一打开微信读书可能整块重渲染，侧栏缓存的节点会失效 → 优先用重新取到的节点
  const items = ghCollectCatalogItems();
  const fresh = items.find((el) => (el.textContent || '').trim() === label);
  const rowOf = (el) => el?.closest?.('.readerCatalog_list_item') || null;
  const ok = (fresh && await attempt(fresh, '点章节名'))
    || (node && node !== fresh && await attempt(node, '点侧栏节点'))
    || (rowOf(fresh || node) && await attempt(rowOf(fresh || node), '点整行'));

  if (opened) ghCloseCatalogPanel();
  if (ok) return { ok: true, report };
  report.push(`面板${ghCatalogRootSize()}·${items.length}项`);
  return { ok: false, report };
}

function ghRenderCatalogTree(force) {
  if (wreCurrentSkin() !== 'github') return;
  // 目录可能有几百章，正文滚动时观察器会频繁触发同步：1.5s 内不重复全量扫描
  const now = Date.now();
  if (!force && now - ghLastCatalogScan < 1500) return;
  ghLastCatalogScan = now;

  const tree = document.querySelector('.wre-gh-tree');
  if (!tree) return;

  const items = ghCollectCatalogItems();
  const activeIdx = ghCatalogActiveIndex(items);
  // 章节列表或当前章节变了才重建，避免每次同步都重写 DOM
  const signature = `${items.map((el) => (el.textContent || '').trim()).join('|')}#${activeIdx}`;
  // 微信读书重渲染过目录（节点被换掉）时，缓存的引用全部失效 → 强制重铺一遍
  const refsStale = ghCatalogRefs.length > 0 && ghCatalogRefs.some((el) => !el.isConnected);
  if (!refsStale && signature === ghCatalogSignature) return;
  ghCatalogSignature = signature;

  if (items.length === 0) {
    tree.innerHTML = ghFallbackTreeHtml();
    return;
  }

  tree.innerHTML = items.map((el, i) => {
    const chapter = (el.textContent || '').trim().replace(/"/g, '&quot;');
    return `
    <div class="wre-gh-tree-item${i === activeIdx ? ' wre-gh-tree-active' : ''}"
      data-catalog="${i}" data-chapter="${chapter}">
      ${WRE_SVG.file}
      <span>${ghChapterFileName(el.textContent)}</span>
    </div>`;
  }).join('');

  // 渲染时把原始节点存下来：页面重渲染后索引会错位，引用也可能失效，
  // 所以点击时还要按 data-chapter 的章节名兜底匹配。
  // 点击事件走 document 上的委托（见 ghBindCatalogDelegation），不在这里逐个绑：
  // 侧栏 DOM 可能被重建，逐个绑的监听会一起消失，表现就是「点了毫无反应」。
  ghCatalogRefs = items.slice();
}

let ghCatalogDelegationBound = false;

async function ghHandleCatalogClick(node) {
  const idx = Number(node.dataset.catalog);
  const chapter = node.dataset.chapter || '';
  const target = ghFindCatalogItem(idx, chapter);
  if (!target) {
    ghToast(`目录里找不到「${chapter.slice(0, 12)}」`);
    return;
  }
  log('info', '侧栏目录跳章', { idx, chapter });
  const result = await ghJumpToCatalogEntry(target, chapter);
  if (result.ok) return;
  ghToast(`跳章失败：${result.report.join(' · ')}（诊断已复制）`);
  ghCopyDiagnostics(target);
}

// 把一个容器里的「看得见的叶子节点」列出来：类名 / 文字 / aria / 位置尺寸。
// 目录入口不是 .readerControls_item（实测底栏 4 项只有书评/横排/字号/夜间），
// 所以诊断要连容器里所有可见叶子一起 dump，才知道入口挂在哪。
function ghDumpVisibleLeaves(scope, limit) {
  if (!scope) return '(none)';
  const rows = [];
  for (const el of Array.from(scope.querySelectorAll('*'))) {
    if (el.tagName.toLowerCase() === 'svg' || el.closest('svg')) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (Array.from(el.children).some((child) => child.tagName.toLowerCase() !== 'svg')) continue; // 只看叶子
    const label = el.getAttribute('aria-label') || el.getAttribute('title') || el.dataset?.id || '';
    // 修饰类（showBookReviews / fontSizeButton / dark / 目录）挂在按钮上而不是图标上，
    // 所以叶子节点旁边要带上父层类名，否则只看到一排一模一样的 span.icon
    const parent = el.parentElement;
    const parentCls = parent && parent !== scope ? `${parent.tagName.toLowerCase()}.${String(parent.className || '').trim()}` : '';
    rows.push(`${el.tagName.toLowerCase()}.${String(el.className || '').trim()}｜${(el.textContent || '').trim().slice(0, 8)}｜${label}｜${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}｜⇧${parentCls}`);
    if (rows.length >= limit) break;
  }
  return rows.join('\n') || '(empty)';
}

// 把目录项 / 目录按钮的真实结构复制到剪贴板，便于定位微信读书到底怎么绑定跳转
function ghCopyDiagnostics(target) {
  const controls = document.querySelector('.readerControls') || document.querySelector('[class*="readerControls"]');
  const topbar = document.querySelector('.readerTopBar') || document.querySelector('[class*="readerTopBar"]');
  const catalogRoot = document.querySelector('.readerCatalog') || document.querySelector('[class*="catalog"]');
  const catalogRect = catalogRoot?.getBoundingClientRect();
  const text = [
    `URL: ${location.href}`,
    `item: ${target?.outerHTML?.slice(0, 600) || '(null)'}`,
    `parent: ${target?.parentElement?.outerHTML?.slice(0, 300) || '(null)'}`,
    `catalogRoot: ${catalogRoot?.className || '(none)'}｜${catalogRect ? `${Math.round(catalogRect.width)}x${Math.round(catalogRect.height)}` : '-'}`,
    `controls:\n${ghDumpVisibleLeaves(controls, 24)}`,
    `topbar:\n${ghDumpVisibleLeaves(topbar, 24)}`,
  ].join('\n\n');
  log('info', '目录诊断', { text });
  try {
    navigator.clipboard?.writeText(text).catch(() => { /* 剪贴板不可用就只留 console */ });
  } catch (e) { /* 忽略 */ }
}

// 用捕获阶段委托：即使侧栏 DOM 被整体重建，监听依然有效；
// 点在侧栏矩形内却没命中我们的节点时，把落点元素告诉你（定位「被谁盖住」）。
function ghBindCatalogDelegation() {
  if (ghCatalogDelegationBound) return;
  ghCatalogDelegationBound = true;
  document.addEventListener('click', (event) => {
    if (!document.documentElement.classList.contains('wre-disguise')) return;
    const node = event.target?.closest?.('.wre-gh-tree-item[data-chapter]');
    if (node) {
      event.preventDefault();
      ghHandleCatalogClick(node);
      return;
    }
    const sidebar = document.querySelector('.wre-gh-sidebar');
    if (!sidebar || !sidebar.offsetParent) return;
    const rect = sidebar.getBoundingClientRect();
    const { clientX: x, clientY: y } = event;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;
    const hit = document.elementFromPoint(x, y);
    if (!hit || sidebar.contains(hit)) return;
    ghToast(`点击被 ${hit.tagName.toLowerCase()}.${String(hit.className || '').split(' ')[0]} 挡住`);
  }, true);
}

// 找目录项：优先用「还连着 DOM 且章节名对得上」的引用，其次按章节名重新查
function ghFindCatalogItem(idx, chapter) {
  const ref = ghCatalogRefs[idx];
  if (ref && ref.isConnected && (!chapter || (ref.textContent || '').trim() === chapter)) return ref;
  const items = ghCollectCatalogItems();
  if (chapter) {
    const hit = items.find((el) => (el.textContent || '').trim() === chapter);
    if (hit) return hit;
  }
  return items[idx] || null;
}

function ghShellHtmlGithub() {
  return `
    <div class="wre-gh-topbar">
      <div class="wre-gh-topbar-inner">
        ${WRE_SVG.logo}
        <span class="wre-gh-topbar-sep"></span>
        <div class="wre-gh-search">${WRE_SVG.search}<span>Type <kbd>/</kbd> to search</span></div>
        <nav class="wre-gh-topnav"><span>Pull requests</span><span>Issues</span><span>Marketplace</span><span>Explore</span></nav>
        <div class="wre-gh-topbar-right">
          ${WRE_SVG.bell}
          ${WRE_SVG.plus}
          <span class="wre-gh-avatar" id="wre-gh-avatar" title="Settings"></span>
        </div>
      </div>
    </div>

    <div class="wre-gh-repobar">
      <div class="wre-gh-repobar-inner">
        <div class="wre-gh-crumb">
          ${WRE_SVG.repo}
          <span class="wre-gh-crumb-owner">${WRE_GH_OWNER}</span>
          <span class="wre-gh-crumb-slash">/</span>
          <span class="wre-gh-crumb-repo">${WRE_GH_REPO}</span>
          <span class="wre-gh-badge">Public</span>
        </div>
        <nav class="wre-gh-tabs">
          <span class="wre-gh-tab wre-gh-tab-active">${WRE_SVG.code}Code</span>
          <span class="wre-gh-tab">${WRE_SVG.issue}Issues</span>
          <span class="wre-gh-tab">${WRE_SVG.pr}Pull requests</span>
          <span class="wre-gh-tab">${WRE_SVG.actions}Actions</span>
        </nav>
        <span class="wre-gh-file-chip">${WRE_GH_FILE}</span>
      </div>
    </div>

    <aside class="wre-gh-sidebar">
      <div class="wre-gh-side-repo">
        <span class="wre-gh-side-avatar"></span>
        <div class="wre-gh-side-repo-text">
          <b>${WRE_GH_REPO}</b>
          <i>Public</i>
        </div>
      </div>
      <div class="wre-gh-side-branch">${WRE_SVG.branch}<span>main</span></div>
      <div class="wre-gh-side-search">${WRE_SVG.search}<span>Go to file</span><kbd>t</kbd></div>
      <div class="wre-gh-tree">
        ${ghFallbackTreeHtml()}
      </div>
    </aside>

    <div class="wre-gh-pager">
      <button class="wre-gh-pager-btn" data-dir="-1">‹ Previous</button>
      <button class="wre-gh-pager-btn" data-dir="1">Next ›</button>
    </div>

    <div id="wre-gh-toast"></div>
  `;
}

function ghShellHtmlNotion() {
  const pages = [
    { name: '产品空间', depth: 0, type: 'space' },
    { name: WRE_NB_PAGE, depth: 1, type: 'doc', active: true },
    { name: '竞品分析', depth: 1, type: 'doc' },
    { name: '数据看板', depth: 1, type: 'doc' },
    { name: '用户访谈纪要', depth: 1, type: 'doc' },
    { name: '团队空间', depth: 0, type: 'space' },
    { name: '排期表', depth: 1, type: 'doc' },
    { name: '线上问题跟踪', depth: 1, type: 'doc' },
    { name: '技术方案', depth: 1, type: 'doc' },
  ];
  return `
    <div class="wre-nb-topbar">
      <div class="wre-nb-topbar-inner">
        <span class="wre-nb-logo">A</span>
        <div class="wre-nb-crumbs">
          <span class="wre-nb-crumb-muted">${WRE_NB_TEAM}</span>
          <span class="wre-nb-slash">/</span>
          <span class="wre-nb-crumb-muted">${WRE_NB_SPACE}</span>
          <span class="wre-nb-slash">/</span>
          <span class="wre-nb-crumb">${WRE_NB_PAGE}</span>
        </div>
        <div class="wre-nb-right">
          <span class="wre-nb-share">Share</span>
          <span class="wre-nb-dots">···</span>
          <span class="wre-gh-avatar" id="wre-gh-avatar" title="Settings"></span>
        </div>
      </div>
    </div>

    <aside class="wre-gh-sidebar wre-nb-side">
      <div class="wre-nb-workspace">
        <span class="wre-nb-ws-avatar">A</span>
        <b>${WRE_NB_TEAM}</b>
      </div>
      <div class="wre-nb-search">${WRE_SVG.search}<span>Search</span></div>
      <div class="wre-nb-tree">
        ${pages.map((item) => `
          <div class="wre-nb-tree-item${item.active ? ' wre-nb-tree-active' : ''}${item.type === 'space' ? ' wre-nb-tree-space' : ''}"
            style="padding-left:${10 + item.depth * 14}px">
            <span class="wre-nb-doc"></span><span>${item.name}</span>
          </div>`).join('')}
      </div>
    </aside>

    <div class="wre-gh-pager wre-nb-pager">
      <button class="wre-gh-pager-btn" data-dir="-1" aria-label="上一页">‹</button>
      <button class="wre-gh-pager-btn" data-dir="1" aria-label="下一页">›</button>
    </div>

    <div id="wre-gh-toast"></div>
  `;
}

function ghBindShell(shell) {
  shell.querySelectorAll('.wre-gh-pager-btn').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const dir = Number(btn.getAttribute('data-dir')) || 1;
      if (ghIsDoubleColumn()) {
        ghDispatchPageKey(dir);
      } else if (!ghClickChapterNav(dir)) {
        ghToast('没找到微信读书的翻章按钮，可先按 G 切回原版');
      }
    });
  });
}

// 皮肤切换是低频操作（弹窗里点一下）：直接重建骨架，避免两套 DOM 互相干扰
function ghEnsureShell(force) {
  const skin = wreCurrentSkin();
  const existing = document.getElementById('wre-gh-shell');
  if (existing && !force && existing.dataset.skin === skin) return existing;
  if (existing) existing.remove();

  const shell = document.createElement('div');
  shell.id = 'wre-gh-shell';
  shell.dataset.skin = skin;
  shell.innerHTML = skin === 'notion' ? ghShellHtmlNotion() : ghShellHtmlGithub();
  document.body.appendChild(shell);
  document.documentElement.dataset.wreSkin = skin;
  ghBindShell(shell);
  ghCatalogSignature = ''; // 骨架重建后目录要重新铺一遍
  ghRenderCatalogTree(true);
  return shell;
}

/* ---- 标签页身份：标题 + 图标（最容易被瞟到的暴露面） ---- */

let ghTitleObserver = null;
let ghOriginalTitle = null;
let ghOriginalFavicons = null;

// 当前皮肤对应的「标签页身份」（标题 + 图标），皮肤切换后两边都要跟着换
function ghIdentityTarget() {
  return wreCurrentSkin() === 'notion'
    ? { title: WRE_NB_PAGE_TITLE, favicon: WRE_NB_FAVICON }
    : { title: WRE_GH_PAGE_TITLE, favicon: WRE_GH_FAVICON };
}

function ghApplyPageIdentity() {
  const target = ghIdentityTarget();
  if (ghOriginalTitle === null) ghOriginalTitle = document.title;
  if (document.title !== target.title) document.title = target.title;

  const links = Array.from(document.querySelectorAll('link[rel~="icon"]'));
  if (!ghOriginalFavicons) {
    ghOriginalFavicons = links.map((el) => ({ el, href: el.getAttribute('href') }));
  }
  if (links.length > 0) {
    links.forEach((el) => el.setAttribute('href', target.favicon));
  } else {
    let link = document.getElementById('wre-gh-favicon');
    if (!link) {
      link = document.createElement('link');
      link.id = 'wre-gh-favicon';
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.setAttribute('href', target.favicon);
  }

  if (ghTitleObserver) return;
  const titleEl = document.querySelector('title');
  if (titleEl) {
    ghTitleObserver = new MutationObserver(() => {
      if (!document.documentElement.classList.contains('wre-disguise')) return;
      const want = ghIdentityTarget().title;
      if (document.title !== want) document.title = want;
    });
    ghTitleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
  }
}

function ghRestorePageIdentity() {
  if (ghTitleObserver) {
    ghTitleObserver.disconnect();
    ghTitleObserver = null;
  }
  if (ghOriginalFavicons) {
    ghOriginalFavicons.forEach(({ el, href }) => {
      if (el && el.isConnected && href) el.setAttribute('href', href);
    });
    ghOriginalFavicons = null;
  }
  document.getElementById('wre-gh-favicon')?.remove();
  if (ghOriginalTitle !== null) {
    document.title = ghOriginalTitle;
    ghOriginalTitle = null;
  }
}

/* ---- 外观同步：顶栏高度对齐原生 / 卡片底色跟随主题 / 深浅色外壳 ---- */

// 隐藏微信读书原生的「上一页/下一页/上一章/下一章」按钮（中文字样会露馅）
const GH_NATIVE_PAGER_TEXTS = ['上一页', '下一页', '上一章', '下一章', '上一节', '下一节'];
let ghLastPagerSweep = 0;

/* 双栏（Canvas 位图）放侧栏：正文一个像素都不动，把侧栏直接盖在书页左侧的页边空白上。
 * 空白宽度靠读 canvas 像素实测（找第一列有墨迹的 x），侧栏宽度随之自适应；
 * 宁可窄也不压字 —— 留白不够就直接不显示。 */
const GH_SIDEBAR_MIN_W = 120; // 窄于这个宽度，文件树没有意义
const GH_SIDEBAR_MAX_W = 248;
let ghSidebarVisualW = '';
let ghInkCache = { key: '', left: null };

// 双栏 canvas 里「第一列有墨迹」的页面坐标（CSS px）；读不到就返回 null
function ghCanvasInkLeft(canvas, rect) {
  if (!canvas.width || !canvas.height || !rect.width) return null;
  const scale = canvas.width / rect.width;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  let ctx = null;
  try {
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  } catch (e) {
    return null;
  }
  if (!ctx) return null;

  // 大屏双栏正文居中，页边距可能落在 300px 开外：扫描范围放宽到 600 CSS px
  const scanW = Math.max(1, Math.min(canvas.width, Math.round(Math.min(rect.width, 600) * scale)));
  const stepY = Math.max(1, Math.round(10 * scale)); // 每 10 CSS px 采一行
  const startY = Math.round(canvas.height * 0.05);   // 避开顶部装饰
  const endY = Math.round(canvas.height * 0.92);     // 避开底部进度
  let bg = null;
  try {
    bg = ctx.getImageData(1, 1, 1, 1).data;
  } catch (e) {
    return null;
  }
  const transparentBg = bg[3] < 12;

  for (let y = startY; y < endY; y += stepY) {
    let row = null;
    try {
      row = ctx.getImageData(0, y, scanW, 1).data;
    } catch (e) {
      return null;
    }
    for (let x = 0; x < scanW; x++) {
      const i = x * 4;
      const isInk = transparentBg
        ? row[i + 3] > 24
        : Math.abs(row[i] - bg[0]) + Math.abs(row[i + 1] - bg[1]) + Math.abs(row[i + 2] - bg[2]) > 36;
      if (isInk) return rect.left + x / scale;
    }
  }
  return null;
}

// 双栏正文的视觉左边界（CSS px）：优先读 Canvas 像素（书页页边距），读不到退回 DOM 边界
function ghMeasureDoubleColumnLeft() {
  const canvases = Array.from(document.querySelectorAll('.wr_canvasContainer canvas'));
  if (canvases.length) {
    const canvas = canvases.reduce((a, b) => (
      a.getBoundingClientRect().left <= b.getBoundingClientRect().left ? a : b
    ));
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0) {
      const key = `${Math.round(rect.left)}|${Math.round(rect.width)}|${canvas.width}x${canvas.height}`;
      if (ghInkCache.key !== key) {
        ghInkCache = { key, left: ghCanvasInkLeft(canvas, rect) };
      }
      if (ghInkCache.left !== null) return ghInkCache.left;
      return rect.left;
    }
  }
  const candidates = [
    document.querySelector('.readerChapterContent'),
    document.querySelector('.wr_horizontalReader_app_content'),
  ].filter(Boolean);
  let left = Infinity;
  candidates.forEach((el) => {
    const r = el.getBoundingClientRect?.();
    if (r && r.width > 0 && r.left >= 0) left = Math.min(left, r.left);
  });
  return Number.isFinite(left) ? left : null;
}

function ghApplySidebarVisualWidth(widthPx) {
  const root = document.documentElement;
  const next = `${widthPx}px`;
  if (ghSidebarVisualW !== next) {
    ghSidebarVisualW = next;
    root.style.setProperty('--wre-gh-sidebar-visual-w', next);
  }
  root.classList.add('wre-gh-sidebar-ok');
}

function ghClearSidebarFits() {
  const root = document.documentElement;
  root.classList.remove('wre-gh-sidebar-ok');
  if (ghSidebarVisualW) {
    ghSidebarVisualW = '';
    root.style.removeProperty('--wre-gh-sidebar-visual-w');
  }
}

// 侧栏能不能站住，统一按「正文左侧的真实留白」判断：
// - 双栏：读 Canvas 像素，找书页页边距；
// - 滚动模式：正文被 CSS 收窄到 280px 之后量 .app_content；
// - 单栏翻页：正文定宽居中，只能吃页边留白，量 .readerChapterContent。
function ghSyncSidebarFits() {
  if (!document.querySelector('.wre-gh-sidebar')) return;

  let left = null;
  if (ghIsDoubleColumn()) {
    left = ghMeasureDoubleColumnLeft();
  } else {
    const isScroll = document.documentElement.classList.contains('wre-gh-scroll');
    const el = isScroll
      ? (document.querySelector('.app_content') || document.querySelector('.readerChapterContent'))
      : document.querySelector('.readerChapterContent');
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0) left = rect.left;
    }
  }

  // 留 10px 呼吸位，绝不贴着字裁断
  const avail = left === null ? 0 : Math.floor(left - 10);
  if (avail >= GH_SIDEBAR_MIN_W) {
    ghApplySidebarVisualWidth(Math.min(GH_SIDEBAR_MAX_W, avail));
  } else {
    ghClearSidebarFits();
  }
}

function ghHideNativePager() {
  const now = Date.now();
  if (now - ghLastPagerSweep < 2000) return; // 低频：避免与微信读书重渲染互相触发
  ghLastPagerSweep = now;
  const scope = document.querySelector('.readerChapterContent_container')
    || document.querySelector('.wr_horizontalReader')
    || document.querySelector('.readerContent');
  if (!scope) return;
  scope.querySelectorAll('button, [class*="button"], [class*="pager"], [class*="Pager"], span, div').forEach((el) => {
    if (el.children.length) return; // 只看叶子
    if (!GH_NATIVE_PAGER_TEXTS.includes((el.textContent || '').trim())) return;
    const host = el.closest('button, [class*="button"], [class*="pager"], [class*="Pager"]') || el;
    if (host.dataset.wreHidden === '1') return;
    host.dataset.wreHidden = '1';
    host.style.setProperty('display', 'none', 'important');
  });
}

// 防重入 + 状态签名去重：观察器回调里调用的样式同步必须幂等，
// 否则会在「我方改 class → 观察器触发 → 再改 class」之间形成死循环（主线程卡死）。
let ghSyncing = false;
let ghChromeSignature = '';

function ghSyncChrome(force) {
  if (ghSyncing) return;
  ghSyncing = true;
  try {
    ghSyncChromeInner(force);
  } catch (e) {
    log('error', '伪装外观同步失败', { error: String(e) });
  } finally {
    ghSyncing = false;
  }
}

function ghSyncChromeInner(force) {
  const nativeBar = document.querySelector('.readerTopBar');
  const barHeight = nativeBar?.getBoundingClientRect?.().height;
  if (barHeight && barHeight > 20) {
    document.documentElement.style.setProperty('--wre-gh-topbar-h', `${Math.round(barHeight)}px`);
  }
  const dark = !document.body.classList.contains('wr_whiteTheme');
  const wasDouble = document.documentElement.classList.contains('wre-double-column');
  const isDouble = ghIsDoubleColumn();
  const isScroll = !isDouble && detectScrollMode();

  // 签名去重：只有「深色/双栏/滚动」这几个 class 相关状态变化时才动 class 与重排，
  // 避免「改 class → 观察器 → 再改 class 的死循环」。
  const signature = `${dark}|${isDouble}|${isScroll}`;
  if (force || signature !== ghChromeSignature) {
    ghChromeSignature = signature;
    document.documentElement.classList.toggle('wre-gh-dark', dark);
    document.documentElement.classList.toggle('wre-double-column', isDouble);
    document.documentElement.classList.toggle('wre-gh-scroll', isScroll);
    if (wasDouble !== isDouble) {
      // 模式切换后让微信读书按新容器宽度重排（尤其双栏 Canvas）。
      // 只派发一次：以前这里「立即 schedule + 100ms 再 resize」会连排两遍，画面连闪两下。
      setTimeout(() => triggerWereadLayoutReflow('gh-mode-switch'), 120);
    }
  }
  ghSyncSidebarFits();
  ghRenderCatalogTree();

  // 伪装态正文固定 GitHub 卡片色：暖色/米黄主题留在「按 G 退出伪装」时自己看。
  // 米黄卡片贴在灰白外壳上色块断层太明显，一眼就看得出不是网页。
  document.documentElement.style.setProperty('--wre-gh-card-bg', dark ? '#0d1117' : '#ffffff');
  ghPublishActiveTheme();
}

/* ---- 伪分页条行为 ---- */

function ghDispatchPageKey(dir) {
  const forward = dir > 0;
  document.dispatchEvent(new KeyboardEvent('keydown', {
    key: forward ? 'ArrowRight' : 'ArrowLeft',
    code: forward ? 'ArrowRight' : 'ArrowLeft',
    keyCode: forward ? 39 : 37,
    which: forward ? 39 : 37,
    bubbles: true,
    cancelable: true,
  }));
}

// 点微信读书原生翻章控件（多策略：class / aria / 文本 / 底栏首尾 / 目录兜底）
function ghClickChapterNav(dir) {
  const forward = dir > 0;
  const words = forward ? ['下一章', '下一节', '下一卷', '下一页'] : ['上一章', '上一节', '上一卷', '上一页'];
  const clsRe = forward ? /(next|forward)/i : /(prev|back)/i;
  const clsExclude = forward ? /(prev|back)/i : /(next|forward)/i;
  const clicked = new Set();
  const tryClick = (el, tag) => {
    if (!el || clicked.has(el)) return false;
    clicked.add(el);
    el.click();
    log('info', '已通过伪分页条翻章', { dir, tag });
    return true;
  };

  const items = Array.from(document.querySelectorAll('.readerControls_item, [class*="readerControls"] [class*="item"]'));
  for (const el of items) {
    const cls = String(el.className || '');
    if (clsRe.test(cls) && !clsExclude.test(cls) && tryClick(el, `class:${cls}`)) return true;
  }

  for (const el of Array.from(document.querySelectorAll('[aria-label], [title]'))) {
    const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`;
    if (words.some((w) => label.includes(w)) && tryClick(el, `aria:${label.trim()}`)) return true;
  }

  const scopes = [
    document.querySelector('.readerFooter'),
    document.querySelector('[class*="readerFooter"]'),
    document.querySelector('.readerControls'),
    document.querySelector('[class*="readerBottom"]'),
  ].filter(Boolean);
  for (const scope of scopes) {
    for (const el of Array.from(scope.querySelectorAll('button, [role="button"], [class*="button"], span, div, a'))) {
      const text = (el.textContent || '').trim();
      if (!words.includes(text)) continue;
      if (el.querySelector('button, span, div, a')) continue;
      if (tryClick(el, `text:${text}`)) return true;
    }
  }

  const bottom = document.querySelector('[class*="readerBottom"], .readerFooter, [class*="readerFooter"]');
  if (bottom) {
    const btns = Array.from(bottom.querySelectorAll('button, [role="button"], [class*="button"]'))
      .filter((el) => !el.querySelector('button, [class*="button"]'));
    const target = forward ? btns[btns.length - 1] : btns[0];
    if (target && tryClick(target, 'bottom-first-last')) return true;
  }

  // 目录兜底：面板没开时行是 0 尺寸，先点底栏目录按钮把面板打开，点完再收回
  if (ghCatalogTrigger()) {
    log('info', '翻章走目录兜底', { dir });
    (async () => {
      const opened = await ghOpenCatalogPanel();
      if (opened) {
        const list = ghCollectCatalogItems();
        const idx = ghCatalogActiveIndex(list);
        const next = idx >= 0 ? list[idx + (forward ? 1 : -1)] : null;
        if (next) {
          ghActivateCatalogItem(next);
          await ghSleep(600);
        }
        ghCloseCatalogPanel();
        if (next) return;
      }
      ghDispatchPageKey(dir); // 目录里定位不到当前章，退回按键翻页
    })();
    return true;
  }

  ghDispatchPageKey(dir);
  return false;
}

// 分页条显示时机：双栏常显；滚动模式滚到章末附近才出现
let ghPagerRaf = null;

function ghUpdatePager() {
  ghPagerRaf = null;
  const pager = document.querySelector('.wre-gh-pager');
  if (!pager) return;
  if (!document.documentElement.classList.contains('wre-disguise')) {
    pager.classList.remove('wre-pager-visible');
    return;
  }
  if (ghIsDoubleColumn()) {
    pager.classList.add('wre-pager-visible');
    return;
  }
  const content = document.querySelector('.readerChapterContent');
  let scroller = null;
  let node = content?.parentElement;
  while (node && node !== document.body) {
    const overflowY = getComputedStyle(node).overflowY;
    if (/(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight + 10) {
      scroller = node;
      break;
    }
    node = node.parentElement;
  }
  const top = scroller ? scroller.scrollTop : window.scrollY;
  const viewport = scroller ? scroller.clientHeight : window.innerHeight;
  const total = scroller ? scroller.scrollHeight : (document.scrollingElement || document.documentElement).scrollHeight;
  pager.classList.toggle('wre-pager-visible', top + viewport >= total - 260);
}

function ghOnPagerScroll() {
  if (!ghPagerRaf) ghPagerRaf = requestAnimationFrame(ghUpdatePager);
}

/* ---- Toast ---- */

let ghToastTimer = null;

function ghToast(message) {
  const el = document.getElementById('wre-gh-toast');
  log('info', message);
  if (!el) return;
  el.textContent = message;
  el.classList.add('wre-visible');
  if (ghToastTimer) clearTimeout(ghToastTimer);
  ghToastTimer = setTimeout(() => el.classList.remove('wre-visible'), 2600);
}

/* ---- 开关与生命周期 ---- */

let ghObserver = null;
let ghObserverTimer = null;
let ghBodyObserver = null;
let ghModeTick = null;
let ghLastDoubleFlag = null;

// 双栏开关（.readerControls_item.isHorizontalReader）不在任何被观察的子树里，
// 靠 1s 轮询兜住「用户切阅读方式」这一事件；其它情况只补量一次留白，成本极低。
function ghStartModeTick() {
  if (ghModeTick) return;
  ghLastDoubleFlag = null;
  ghModeTick = setInterval(() => {
    if (!WRE_STATE.disguise) return;
    const isDouble = ghIsDoubleColumn();
    if (isDouble !== ghLastDoubleFlag) {
      ghLastDoubleFlag = isDouble;
      ghSyncChrome();
      return;
    }
    ghSyncSidebarFits();
  }, 1000);
}

function ghStopModeTick() {
  if (!ghModeTick) return;
  clearInterval(ghModeTick);
  ghModeTick = null;
  ghLastDoubleFlag = null;
}

function ghSetActive(on) {
  if (on) {
    document.documentElement.classList.add('wre-disguise');
    ghEnsureShell();
    ghChromeSignature = ''; // 强制重算一次外观状态
    ghSyncChrome(true);
    ghApplyPageIdentity();
    ghUpdatePager();
    scheduleWereadLayoutReflow('gh-disguise-on');
    // 阅读器 DOM 可能晚于 content script 就绪：延后补一次屏占比 + 侧栏测量。
    // 滚动模式改宽度浏览器会自动重排，不需要再惊动微信读书（否则会整块闪一下）。
    setTimeout(() => {
      applyScreenRatio(WRE_STATE.screenRatio);
      if (!detectScrollMode()) scheduleWereadLayoutReflow('gh-ratio-retry');
      ghSyncSidebarFits();
      ghHideNativePager();
    }, 1200);

    if (!ghBodyObserver) {
      // 只观察 body（微信读书会翻转 wr_whiteTheme），不观察 html 自身——
      // 否则我们自己切换的 class 会再次触发回调，形成死循环。
      ghBodyObserver = new MutationObserver(() => {
        if (WRE_STATE.disguise) ghSyncChrome();
      });
      ghBodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    if (!ghObserver) {
      const attach = () => {
        const target = document.querySelector('.readerContent');
        if (!target) return false;
        ghObserver = new MutationObserver(() => {
          if (ghObserverTimer) clearTimeout(ghObserverTimer);
          ghObserverTimer = setTimeout(() => {
            if (!WRE_STATE.disguise) return;
            ghSyncChrome();
            ghOnPagerScroll();
          }, 400);
        });
        ghObserver.observe(target, { childList: true, subtree: true });
        return true;
      };
      if (!attach()) {
        let tries = 0;
        const timer = setInterval(() => {
          tries++;
          if (attach() || tries > 120) clearInterval(timer);
        }, 500);
      }
    }
    ghStartModeTick();
    log('info', '伪装已开启', { doubleColumn: ghIsDoubleColumn() });
  } else {
    ghStopModeTick();
    document.documentElement.classList.remove('wre-disguise');
    document.documentElement.classList.remove('wre-gh-dark');
    document.documentElement.classList.remove('wre-double-column');
    document.documentElement.classList.remove('wre-gh-scroll');
    ghClearSidebarFits();
    ghRestorePageIdentity();
    scheduleWereadLayoutReflow('gh-disguise-off');
    if (ghObserver) {
      ghObserver.disconnect();
      ghObserver = null;
    }
    if (ghBodyObserver) {
      ghBodyObserver.disconnect();
      ghBodyObserver = null;
    }
    log('info', '伪装已关闭（微信读书原样）');
  }
}

function ghToggle() {
  WRE_STATE.disguise = !WRE_STATE.disguise;
  saveState();
  ghSetActive(WRE_STATE.disguise);
}

// 弹窗改的设置：逐项 diff 后只应用变化项（避免无谓重排 / 打断自动阅读）
function ghApplyStateFromStorage(next) {
  const prev = WRE_STATE;
  const merged = { ...WRE_DEFAULT_STATE, ...next };
  merged.autoRead = { ...WRE_DEFAULT_STATE.autoRead, ...(next.autoRead || {}) };
  WRE_STATE = merged;

  if (merged.skin !== prev.skin) {
    ghEnsureShell(true); // 皮肤变了：骨架结构与文案整体重建
    if (WRE_STATE.disguise) {
      ghApplyPageIdentity(); // 标题 / 图标一起换，避免「Notion 页面 + GitHub 标题」
      ghSyncChrome(true);
    }
  }
  if (merged.theme !== prev.theme) {
    applyTheme();
    watchSystemTheme();
    updateThemeUI();
  }
  if (merged.immersiveMode !== prev.immersiveMode) {
    applyImmersive();
    updateImmersiveUI();
  }
  if (merged.screenRatio !== prev.screenRatio) {
    applyScreenRatio(merged.screenRatio);
    scheduleWereadLayoutReflow('popup-ratio');
    updateScreenRatioUI();
    // 宽度变了，左侧留白随之变化：重新量一次侧栏是否放得下
    setTimeout(() => ghSyncSidebarFits(), 120);
    setTimeout(() => ghSyncSidebarFits(), 600);
  }
  if (merged.autoRead.enabled !== prev.autoRead.enabled) {
    if (merged.autoRead.enabled) startAutoRead();
    else stopAutoRead();
  }
  if (merged.autoRead.speed !== prev.autoRead.speed) setAutoReadSpeed(merged.autoRead.speed);
  if (merged.autoRead.direction !== prev.autoRead.direction) setAutoReadDirection(merged.autoRead.direction);
  if (merged.bgLightIdx !== prev.bgLightIdx || merged.bgDarkIdx !== prev.bgDarkIdx) {
    wreBgIdx = isWereadDarkMode() ? merged.bgDarkIdx : merged.bgLightIdx;
    applyBgColor();
    updateBgThemeUI();
    ghPublishActiveTheme();
  }
  if (merged.disguise !== prev.disguise) {
    ghSetActive(merged.disguise);
  }
}

// 把当前生效的正文主题上报给弹窗（弹窗侧无法判断微信读书深浅色）
let ghLastActiveTheme = '';
function ghPublishActiveTheme() {
  const color = WRE_BG_COLORS[wreBgIdx];
  if (!color) return;
  const active = { isDark: isWereadDarkMode(), name: color.name };
  const key = `${active.isDark}:${active.name}`;
  if (key === ghLastActiveTheme) return;
  ghLastActiveTheme = key;
  try {
    chrome.storage.local.set({ wreActiveTheme: active });
  } catch (e) {
    /* 上报失败不影响功能 */
  }
}

function initGhDisguise() {
  ghBindCatalogDelegation();
  document.addEventListener('scroll', ghOnPagerScroll, { passive: true, capture: true });
  window.addEventListener('resize', ghOnPagerScroll);
  // 拖窗口时 resize 会高频触发：侧栏要量 getBoundingClientRect，去抖后再算
  let ghResizeTimer = null;
  window.addEventListener('resize', () => {
    if (ghResizeTimer) clearTimeout(ghResizeTimer);
    ghResizeTimer = setTimeout(() => {
      ghResizeTimer = null;
      ghSyncSidebarFits();
    }, 250);
  });

  // 弹窗（popup）是设置唯一入口：监听存储变更并即时应用到阅读页
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const next = changes[WRE_STORAGE_KEYS.state]?.newValue;
    if (!next) return;
    ghApplyStateFromStorage(next);
  });

  if (location.hash.includes('wre-off')) {
    // 逃生开关：页面异常时用 weread.qq.com/…#wre-off 打开，强制不启用伪装
    WRE_STATE.disguise = false;
    log('warn', '检测到 #wre-off，已强制关闭伪装');
    return;
  }

  if (!isReaderPage()) {
    // SPA：从书城点进书时再开
    let wasReader = false;
    setInterval(() => {
      const isReader = isReaderPage();
      if (isReader === wasReader) return;
      wasReader = isReader;
      if (isReader && WRE_STATE.disguise) ghSetActive(true);
      if (!isReader && WRE_STATE.disguise) ghSetActive(false);
    }, 600);
    return;
  }
  ghSetActive(!!WRE_STATE.disguise);
}
