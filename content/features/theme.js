/* 外观主题档 + 正文主题色（16 档预设）
 * 由 content.js 拆分而来：语句顺序与原文件一致，跨文件共享同一全局作用域。
 */

const WRE_THEME_ATTR = 'data-wre-theme';

let wreThemeMedia = null;

function resolveEffectiveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch (err) {
    return 'light';
  }
}

function applyTheme() {
  const effective = resolveEffectiveTheme(WRE_STATE.theme);
  document.documentElement.setAttribute(WRE_THEME_ATTR, effective);
  return effective;
}

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

function updateThemeUI() {
  if (!wreRoot) return;
  const toggle = wreRoot.querySelector('#wre-theme-toggle');
  if (!toggle) return;
  toggle.querySelectorAll('.wre-theme-btn').forEach((btn) => {
    btn.classList.toggle('wre-theme-active', btn.getAttribute('data-theme') === WRE_STATE.theme);
  });
}

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

let wreBgIdx = 0;

let wreBgStyleEl = null;

let wreBgStyleCache = '';

let wreBgColorObserver = null;

let wreBgColorObserverTarget = null;

let wreBgApplyingColor = false;

let wreSystemThemeGen = 0;

let wreHealIssueKeys = null;

let wreBgModeDedup = null;

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

function cycleBgTheme(delta) {
  const available = getBgAvailableColors();
  const nextIdx = (getCurrentBgColorIndex() + delta + available.length) % available.length;
  setActiveBgIdx(WRE_BG_COLORS.indexOf(available[nextIdx]));
}

function applySystemBgMode(isDark) {
  wreBgIdx = isDark ? WRE_STATE.bgDarkIdx : WRE_STATE.bgLightIdx;
  applyBgColor();
  updateBgThemeUI();
}

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
