/* 样式表与屏占比（含工具栏浮动、自绘滚动条）
 * 由 content.js 拆分而来：语句顺序与原文件一致，跨文件共享同一全局作用域。
 */

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

function detectScrollMode() {
  return !document.querySelector('.readerChapterContent_container')
    && !!document.querySelector('.app_content');
}

function isReaderPage() {
  return window.location.pathname.indexOf('/web/reader') === 0;
}

function buildRatioCSS(ratio) {
  const numericRatio = clampNumber(Number(ratio), 50, 100);

  // 100% = 不写任何宽度规则。这一条很关键：翻页模式原来即使 100% 也会写
  // `.readerChapterContent { width: <基准px> }`，缩放窗口后这个 px 不会跟着变，
  // 微信读书发现容器宽度对不上就会重新分页/重渲染（用户看到的「刷新两次」）。
  if (numericRatio >= 100) return '';

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
  wreAppliedSignature = `${numericRatio}|${scrollMode ? 'scroll' : 'page'}|${basePx || 0}`;

  // 整块 <style> 重写会让整篇文档重新计算样式（= 一次全页重排）。
  // 内容没变就别碰 DOM：比例/模式的组合通常会重复应用很多次。
  const nextCss = `${buildRatioCSS(numericRatio)}\n${toolbarFloatCSS}\n${immersiveCSS}`;
  if (nextCss !== wreLastWrittenCss) {
    wreLastWrittenCss = nextCss;
    wreStyleTag.textContent = nextCss;
  }

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
      // 100% 是原生宽度，工具栏本来就在原生位置放得下，别去接管它
      enableToolbarFloat = (numericRatio < 100 && numericRatio > 85)
        || tr.left < -1 || tr.right > window.innerWidth + 1 || cr.right > window.innerWidth;
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

let wreToolbarMoveHandler = null;

let wreToolbarHideTimer = null;

let wreToolbarRightTimer = null;

const WRE_TOPBAR_ZONE_PX = 100;

const WRE_CONTROLS_ZONE_PX = 120;

const WRE_BOTTOM_ZONE_PX = 80;

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
