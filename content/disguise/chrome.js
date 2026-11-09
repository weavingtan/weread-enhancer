/* 标签页身份 + 外观同步 + 侧栏留白 + 隐藏原生分页
 * 由 content.js 拆分而来：语句顺序与原文件一致，跨文件共享同一全局作用域。
 */

let ghTitleObserver = null;

let ghOriginalTitle = null;

let ghOriginalFavicons = null;

// 标签页身份跟着当前章走：窗口标题 / file chip / Notion 面包屑三处必须是同一个名字。
// 具体拼法由皮肤注册表决定（github 用 .md 文件名，notion 用页面名）。
function ghIdentityTarget() {
  const profile = wreSkinProfile();
  return {
    title: profile.title(profile.chapterText(ghCurrentChapterLabel())),
    favicon: profile.favicon,
  };
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

const GH_NATIVE_PAGER_TEXTS = ['上一页', '下一页', '上一章', '下一章', '上一节', '下一节'];

let ghLastPagerSweep = 0;

/* 双栏（Canvas 位图）放侧栏：正文一个像素都不动，把侧栏直接盖在书页左侧的页边空白上。
 * 空白宽度靠读 canvas 像素实测（找第一列有墨迹的 x），侧栏宽度随之自适应；
 * 宁可窄也不压字 —— 留白不够就直接不显示。 */
const GH_SIDEBAR_MIN_W = 72; // 窄于这个宽度，文件树没有意义（极窄时只留图标 + 截断文件名）

// 视觉宽度低于这个值时切「极窄档」：隐藏装饰文字，只留图标 + 截断文件名。
// 它就是旧版 GH_SIDEBAR_MIN_W（120），独立成常量以免将来改 MIN 时漏改这个档位阈值。
const GH_SIDEBAR_NARROW_W = 120;

const GH_SIDEBAR_MAX_W = 248;

let ghSidebarVisualW = '';

// 「没量到」的连续重试计数：量到一次就归零，防止真没内容的页面上无限重试
let ghSidebarNullRetries = 0;

let ghInkCache = { key: '', left: null };

// 读像素必须走自建的 willReadFrequently 离屏画布：微信读书已经先用普通属性取过 2D 上下文，
// 我们再用 canvas.getContext('2d', { willReadFrequently: true }) 拿到的还是同一个上下文，
// 属性不生效，于是 Chrome 照样报「Multiple readback operations…」。
let ghInkBuf = null;
let ghInkBufCtx = null;

function ghInkBuffer(w, h) {
  if (!ghInkBuf) ghInkBuf = document.createElement('canvas');
  if (ghInkBuf.width !== w || ghInkBuf.height !== h) {
    ghInkBuf.width = w;
    ghInkBuf.height = h;
  }
  if (!ghInkBufCtx) {
    try {
      ghInkBufCtx = ghInkBuf.getContext('2d', { willReadFrequently: true });
    } catch (e) {
      return null;
    }
  }
  return ghInkBufCtx;
}

function ghCanvasInkLeft(canvas, rect) {
  if (!canvas.width || !canvas.height || !rect.width) return null;
  const scale = canvas.width / rect.width;
  if (!Number.isFinite(scale) || scale <= 0) return null;

  // 大屏双栏正文居中，页边距可能落在 300px 开外：扫描范围放宽到 600 CSS px
  const scanW = Math.max(1, Math.min(canvas.width, Math.round(Math.min(rect.width, 600) * scale)));
  const stepY = Math.max(1, Math.round(10 * scale)); // 每 10 CSS px 采一行
  const startY = Math.round(canvas.height * 0.05);   // 避开顶部装饰
  const endY = Math.round(canvas.height * 0.92);     // 避开底部进度

  // 一次搬 8 行的条带进离屏画布再读回：读回次数降到 1/8，且画布带 willReadFrequently
  const rowsPerChunk = 8;
  const bufH = stepY * rowsPerChunk;
  const bctx = ghInkBuffer(scanW, bufH);
  if (!bctx) return null;

  let bg = null;
  let transparentBg = false;
  let first = true;
  for (let y = startY; y < endY; y += stepY * rowsPerChunk) {
    const chunkH = Math.min(stepY * rowsPerChunk, endY - y);
    let block = null;
    try {
      bctx.clearRect(0, 0, scanW, bufH);
      bctx.drawImage(canvas, 0, y, scanW, chunkH, 0, 0, scanW, chunkH);
      block = bctx.getImageData(0, 0, scanW, chunkH).data;
    } catch (e) {
      return null;
    }
    if (first) {
      // 背景色取条带里的 (1, 0)：对应画布 (1, y)，和原来 (1, 1) 的含义一致
      const bgi = (scanW > 1 ? 1 : 0) * 4;
      bg = [block[bgi], block[bgi + 1], block[bgi + 2], block[bgi + 3]];
      transparentBg = bg[3] < 12;
      first = false;
    }
    for (let ry = 0; ry < chunkH; ry += stepY) {
      const rowOffset = ry * scanW * 4;
      for (let x = 0; x < scanW; x++) {
        const i = rowOffset + x * 4;
        const isInk = transparentBg
          ? block[i + 3] > 24
          : Math.abs(block[i] - bg[0]) + Math.abs(block[i + 1] - bg[1]) + Math.abs(block[i + 2] - bg[2]) > 36;
        if (isInk) return rect.left + x / scale;
      }
    }
  }
  return null;
}

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
      // 像素读不到（画布被跨域图片污染 / 读回失败）时，别拿 canvas 的 rect.left 兜底：
      // canvas 可能横跨整个视口（书页卡片画在中间），left=0 会把留白判成 0，
      // 侧栏就被永久判「放不下」。改用正文卡片容器的真实左边界。
      const card = document.querySelector('.wr_horizontalReader_app_content')
        || document.querySelector('.readerChapterContent_container')
        || document.querySelector('.readerChapterContent');
      const cardRect = card?.getBoundingClientRect?.();
      if (cardRect && cardRect.width > 0 && cardRect.left >= 0) return cardRect.left;
      // 连卡片容器也量不到：不猜 canvas 的 rect.left，返回 null 交给上层重试（绝不压字）。
      return null;
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
  // 视觉宽度不足 GH_SIDEBAR_NARROW_W 时进入极窄档：只留图标 + 截断文件名，隐藏装饰文字
  root.classList.toggle('wre-gh-sidebar-narrow', widthPx < GH_SIDEBAR_NARROW_W);
}

function ghClearSidebarFits() {
  const root = document.documentElement;
  root.classList.remove('wre-gh-sidebar-ok');
  root.classList.remove('wre-gh-sidebar-narrow');
  if (ghSidebarVisualW) {
    ghSidebarVisualW = '';
    root.style.removeProperty('--wre-gh-sidebar-visual-w');
  }
}

// 真实文字左边界：用 Range 量正文里第一个有内容的文本节点。
// 容器 rect.left 不等于字的左边界（正文容器有内边距、居中分栏时容器比字更靠左），
// 照容器留白就会压到字。取该文本节点所有行框里最靠左的那个，避开首行缩进。
function ghFirstTextLeft() {
  const scope = document.querySelector('.readerChapterContent') || document.querySelector('.app_content');
  if (!scope) return null;
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
  let seen = 0;
  while (walker.nextNode() && seen < 40) {
    const node = walker.currentNode;
    if (!node.nodeValue || node.nodeValue.trim().length < 2) continue;
    seen += 1;
    if (typeof document.createRange !== 'function') return null;
    const range = document.createRange();
    if (typeof range.getClientRects !== 'function') return null;
    let rects = null;
    try {
      range.selectNodeContents(node);
      rects = range.getClientRects();
    } catch (e) {
      continue;
    }
    if (!rects) continue;
    let min = Infinity;
    for (let i = 0; i < rects.length; i += 1) {
      const r = rects[i];
      if (r.width > 8 && r.height > 4 && r.left >= 0 && r.left < window.innerWidth && r.left < min) min = r.left;
    }
    if (Number.isFinite(min)) return min;
  }
  return null;
}

// 侧栏能不能站住，统一按「正文左侧的真实留白」判断：
// - 首选真实文字左边界（Range 量字），双栏再叠加 Canvas 像素找书页页边距；
// - 都量不到时退回容器 rect（滚动模式 = .app_content，翻页 = .readerChapterContent）；
// - 多个候选取最靠左的那个：宁可侧栏窄一点，也绝不让它压住正文。
function ghSyncSidebarFits() {
  if (!document.querySelector('.wre-gh-sidebar')) return;

  const isDouble = ghIsDoubleColumn();
  const textLeft = ghFirstTextLeft();
  const canvasLeft = isDouble ? ghMeasureDoubleColumnLeft() : null;
  const candidates = [textLeft, canvasLeft].filter((v) => Number.isFinite(v));

  let left = candidates.length ? Math.min(...candidates) : null;
  if (left === null) {
    const isScroll = document.documentElement.classList.contains('wre-gh-scroll');
    const el = isScroll
      ? (document.querySelector('.app_content') || document.querySelector('.readerChapterContent'))
      : document.querySelector('.readerChapterContent');
    const rect = el?.getBoundingClientRect?.();
    if (rect && rect.width > 0) left = rect.left;
  }

  // 留 10px 呼吸位，绝不贴着字裁断
  const avail = left === null ? 0 : Math.floor(left - 10);
  const width = avail >= GH_SIDEBAR_MIN_W ? Math.min(GH_SIDEBAR_MAX_W, avail) : null;
  if (width === null) {
    ghClearSidebarFits();
    // left === null = 「根本没量到」（正文重建中 / canvas 0 尺寸），是暂态；
    // left 有值但太小才是「真的放不下」的终态。暂态补几次重试：
    // 之后的同步被尺寸签名去重拦住（内容重建不改签名），不补就没有人再量了。
    if (left === null && ghSidebarNullRetries < 5) {
      ghSidebarNullRetries += 1;
      wreSetTimeout(() => ghSyncSidebarFits(), 500);
      log('warn', '侧栏留白没量到，稍后重试', { retry: ghSidebarNullRetries, double: isDouble });
    }
  } else {
    ghSidebarNullRetries = 0;
    ghApplySidebarVisualWidth(width);
  }
  log('info', '侧栏留白测量', { double: isDouble, textLeft, canvasLeft, left, width });

  // 侧栏有无/宽度变了，分页条能用的左边界跟着变：可见时补一次对齐
  if (ghPagerVisible) {
    const pager = document.querySelector('.wre-gh-pager');
    if (pager) ghAlignPagerToCard(pager);
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

  // 逐个文本节点找「上一页/下一页」：比对整章几万个子孙跑 5 个属性选择器便宜得多。
  // closest 的 4 个选择器只在真正命中时才执行（一章通常 0~2 个）。
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
  let hidden = 0;
  let node = walker.nextNode();
  while (node) {
    const text = (node.nodeValue || '').trim();
    if (text && GH_NATIVE_PAGER_TEXTS.includes(text)) {
      const el = node.parentElement;
      const host = el
        ? (el.closest('button, [class*="button"], [class*="pager"], [class*="Pager"]') || el)
        : null;
      if (host && host.dataset.wreHidden !== '1') {
        host.dataset.wreHidden = '1';
        host.style.setProperty('display', 'none', 'important');
        hidden += 1;
      }
    }
    node = walker.nextNode();
  }
  if (hidden) log('info', '隐藏原生翻页按钮', { hidden });
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

let ghLastSizeSig = '';

let ghLastCardBg = '';

let ghLastModeReflowAt = 0;

// 被节流吞掉的切模式，用这个定时器补最后一次（否则停在旧分页宽度）
let ghModeReflowTrailing = null;

let ghTopbarH = '';

/* 布局观察：原来靠 1 秒轮询（每秒一次 getBoundingClientRect = 每秒一次强制布局）
 * 来发现「窗口尺寸变了 / 双栏 canvas 出现了」。这两件事本来就是可观察事件，
 * 改成 ResizeObserver；回调只调幂等的 ghSyncChrome（内部有状态 + 尺寸签名去重）。
 * canvas 从无到有这件事留给 lifecycle 里的低频探针兜底（见 ghStartCanvasProbe）。 */
let ghLayoutObserver = null;

const ghLayoutTargets = new Set();

let ghLayoutSyncTimer = null;

function ghObserveLayoutTarget(el) {
  if (!el || ghLayoutTargets.has(el)) return;
  ghLayoutObserver.observe(el);
  ghLayoutTargets.add(el);
}

function ghEnsureLayoutObservers() {
  if (typeof ResizeObserver !== 'function') return false; // 旧内核 / jsdom：退回事件路径
  if (!ghLayoutObserver) ghLayoutObserver = new ResizeObserver(ghOnLayoutResize);

  // 微信读书重建过节点：先把已断开的移出观察集合，避免集合无限增长
  ghLayoutTargets.forEach((el) => {
    if (el.isConnected) return;
    ghLayoutObserver.unobserve(el);
    ghLayoutTargets.delete(el);
  });

  ghObserveLayoutTarget(document.documentElement);
  ghObserveLayoutTarget(document.querySelector('.wr_canvasContainer canvas'));
  ghObserveLayoutTarget(document.querySelector('.readerChapterContent'));
  ghObserveLayoutTarget(document.querySelector('.app_content'));
  return ghLayoutTargets.size > 0;
}

// 160ms 去抖，而不是逐事件同步：微信读书重建 canvas 是「先移除、再插入」，
// 逐帧同步会把模式签名算成 double → 单栏 → double，白派两次 resize（正文整块闪，
// 严重时把阅读器搅进重渲染循环）。去抖后拿到的总是稳定下来的状态。
function ghOnLayoutResize() {
  if (ghLayoutSyncTimer) clearTimeout(ghLayoutSyncTimer);
  ghLayoutSyncTimer = setTimeout(() => {
    ghLayoutSyncTimer = null;
    if (!WRE_STATE.disguise) return;
    ghSyncChrome();
  }, 160);
}

function ghStopLayoutObservers() {
  if (ghLayoutSyncTimer) {
    clearTimeout(ghLayoutSyncTimer);
    ghLayoutSyncTimer = null;
  }
  if (!ghLayoutObserver) return;
  ghLayoutObserver.disconnect();
  ghLayoutTargets.clear();
  ghLayoutObserver = null;
}

function ghSizeSignature() {
  const canvas = document.querySelector('.wr_canvasContainer canvas');
  const c = canvas ? `${canvas.width}x${canvas.height}` : 'none';
  // 屏占比也要进签名：滚动模式下正文宽度按视口百分比走，窗口尺寸没变但
  // .app_content 的 left 变了，侧栏留白必须重算，否则会按旧留白盖住正文。
  return `${window.innerWidth}x${window.innerHeight}|${c}|${WRE_STATE.screenRatio}`;
}

// 「当前文件」三处同步：file chip、窗口标题、Notion 面包屑。
// 只在章节真的变了时写 DOM —— 切章会连带一串同步调用，每次都写标题会让标签页闪。
function ghSyncChapterIdentity() {
  const profile = wreSkinProfile();
  const label = ghCurrentChapterLabel();
  const chapterText = profile.chapterText(label);
  const key = `${profile.id}|${chapterText}`;
  if (key === ghLastChapterFile) return;
  ghLastChapterFile = key;

  const chip = profile.chipSelector ? document.querySelector(profile.chipSelector) : null;
  if (chip) chip.textContent = chapterText;
  const crumb = profile.crumbSelector ? document.querySelector(profile.crumbSelector) : null;
  if (crumb) crumb.textContent = chapterText;
  // 文件头也是皮肤的一部分：选择器从注册表拿，别在这里硬编码 GitHub 的类名
  const barName = profile.filebarNameSelector ? document.querySelector(profile.filebarNameSelector) : null;
  if (barName) barName.textContent = chapterText;
  const barMeta = profile.filebarMetaSelector ? document.querySelector(profile.filebarMetaSelector) : null;
  if (barMeta) barMeta.textContent = ghFilebarMetaText();
  ghApplyPageIdentity();
}

/* 文件头（GitHub 文件视图里「路径 + N lines + Copy」那一行）
 *
 * 它是个 fixed 覆盖层：不推正文，只在正文上方本来就有足够空白时才出现。
 * 判据是「首行文字的顶边」与「文件头底边」的间距 —— 量不到（jsdom、
 * 页面还在重渲染、或者已经滚到半截）就当作放不下，直接不显示。
 * 这条项目铁律：宁可少一行假界面，也不能压住真正文。 */
function ghContentText() {
  const el = document.querySelector('.readerChapterContent');
  if (!el) return '';
  // innerText 才带换行（真实浏览器）；jsdom 里没有这个属性，退回 textContent
  const text = typeof el.innerText === 'string' ? el.innerText : el.textContent || '';
  return text.replace(/\r/g, '').trim();
}

// GitHub 那行是 "1,284 lines (1,020 loc) · 45.6 KB"：行数 / 字符数 / 体积
function ghFilebarMetaText() {
  const text = ghContentText();
  if (!text) return '—';
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean).length;
  let size = 0;
  try {
    size = new Blob([text]).size;
  } catch (e) {
    size = text.length * 3; // 中文按 UTF-8 三字节估
  }
  const kb = (size / 1024).toFixed(1);
  return `${lines.toLocaleString()} lines (${lines.toLocaleString()} loc) · ${kb} KB`;
}

// 注意不能用 `parseFloat(x) || fallback`：Notion 皮肤把这两项合法地定义成 0px，
// 用 || 会把 0 当成「没定义」而多算 84px。
function ghCssPx(name, fallback) {
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

function ghFilebarBottomPx() {
  const rect = document.querySelector('.wre-gh-filebar')?.getBoundingClientRect?.();
  if (rect && rect.height > 0) return rect.bottom;
  return ghCssPx('--wre-gh-topbar-h', 48) + ghCssPx('--wre-gh-repobar-h', 44) + ghCssPx('--wre-gh-filebar-h', 40);
}

// 正文第一行文字的顶边（视口坐标）。翻页模式直接看 canvas 顶边。
function ghFirstTextTop() {
  if (ghIsDoubleColumn()) {
    const rect = document.querySelector('.wr_canvasContainer canvas')?.getBoundingClientRect?.();
    return rect && rect.height > 0 ? rect.top : null;
  }
  const scope = document.querySelector('.readerChapterContent') || document.querySelector('.app_content');
  if (!scope || typeof document.createRange !== 'function') return null;

  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
  let inspected = 0;
  while (walker.nextNode() && inspected < 40) {
    const node = walker.currentNode;
    if (!node.nodeValue || node.nodeValue.trim().length < 2) continue;
    inspected += 1;
    const range = document.createRange();
    if (typeof range.getClientRects !== 'function') return null; // 非浏览器环境（jsdom）
    try {
      range.selectNodeContents(node);
    } catch (e) {
      continue;
    }
    const rects = range.getClientRects();
    let top = Infinity;
    for (let i = 0; i < rects.length; i += 1) {
      const r = rects[i];
      if (r.width > 8 && r.height > 4 && r.top < top) top = r.top;
    }
    if (Number.isFinite(top)) return top;
  }
  return null;
}

function ghUpdateFilebarFit(force) {
  const key = `${ghSizeSignature()}|${ghCurrentChapterLabel()}`;
  if (!force && key === ghFilebarFitKey) return;

  const bottom = ghFilebarBottomPx();
  const textTop = ghFirstTextTop();
  const fits = Number.isFinite(textTop) && textTop >= bottom + 8;
  document.documentElement.classList.toggle('wre-gh-filebar-ok', fits);
  // 量不到（正文还没渲染 / 刚滚过 / 正在重排）就别把结果记进缓存，
  // 否则一次「没量到」会让文件头到下次切章为止一直不出现。
  ghFilebarFitKey = Number.isFinite(textTop) ? key : '';
  log('info', '文件头可用空白', { textTop, bottom, fits });
}

function ghSyncChromeInner(force) {
  // 顺带把观察目标补上：正文 / canvas 被重建时，下一次任意同步就能恢复观察
  ghEnsureLayoutObservers();
  const nativeBar = document.querySelector('.readerTopBar');
  const barHeight = nativeBar?.getBoundingClientRect?.().height;
  if (barHeight && barHeight > 20) {
    const want = `${Math.round(barHeight)}px`;
    if (ghTopbarH !== want) {
      ghTopbarH = want;
      document.documentElement.style.setProperty('--wre-gh-topbar-h', want);
    }
  }
  const dark = !document.body.classList.contains('wr_whiteTheme');
  const wasDouble = document.documentElement.classList.contains('wre-double-column');
  const isDouble = ghIsDoubleColumn();
  const isScroll = !isDouble && detectScrollMode();

  // 签名去重：只有「深色/双栏/滚动」这几个 class 相关状态变化时才动 class 与重排，
  // 避免「改 class → 观察器 → 再改 class 的死循环」。
  const signature = `${dark}|${isDouble}|${isScroll}`;
  const statusChanged = force || signature !== ghChromeSignature;
  if (statusChanged) {
    ghChromeSignature = signature;
    document.documentElement.classList.toggle('wre-gh-dark', dark);
    document.documentElement.classList.toggle('wre-double-column', isDouble);
    document.documentElement.classList.toggle('wre-gh-scroll', isScroll);
    if (wasDouble !== isDouble) {
      // 只派发一次：以前这里「立即 schedule + 100ms 再 resize」会连排两遍，画面连闪两下。
      // 模式切换后让微信读书按新容器宽度重排（尤其双栏 Canvas）。
      // 1.2s 内只允许一次：重排期间 canvas 会短暂 0 尺寸，来回翻转会连锁触发，
      // 表现就是拖一下窗口「连刷两下」。被吞掉的那次用 trailing 定时器补上，
      // 不然快速来回切之后会停在旧的分页宽度。
      const now = Date.now();
      const wait = ghLastModeReflowAt + 1200 - now;
      if (wait <= 0) {
        ghLastModeReflowAt = now;
        wreSetTimeout(() => triggerWereadLayoutReflow('gh-mode-switch'), 120);
      } else if (!ghModeReflowTrailing) {
        ghModeReflowTrailing = wreSetTimeout(() => {
          ghModeReflowTrailing = null;
          ghLastModeReflowAt = Date.now();
          triggerWereadLayoutReflow('gh-mode-switch-trailing');
        }, wait + 120);
      }
    }
  }

  // 尺寸真的变了才重新量留白（这一步含 getBoundingClientRect，会强制布局）。
  // 例外：侧栏当前处于隐藏态时每次同步都重量——内容重建（DOM 换新、尺寸不变）
  // 不会改尺寸签名，不补这条，一次暂态量空就会把侧栏一直钉在隐藏态。
  // 与 ghSyncSidebarFits 里的 500ms 重试分工：timer 管「之后没有任何同步事件」的兜底，
  // 这里管「同步来了但尺寸签名没变」的兜底，两者一起才覆盖得住「暂态量空」。
  const sizeSig = ghSizeSignature();
  const sidebarHidden = !document.documentElement.classList.contains('wre-gh-sidebar-ok');
  if (statusChanged || sizeSig !== ghLastSizeSig || sidebarHidden) {
    ghLastSizeSig = sizeSig;
    ghSyncSidebarFits();
  }
  ghRenderCatalogTree();
  ghSyncChapterIdentity();
  ghUpdateFilebarFit();

  // 伪装态正文固定 GitHub 卡片色：暖色/米黄主题留在「按 G 退出伪装」时自己看。
  // 米黄卡片贴在灰白外壳上色块断层太明显，一眼就看得出不是网页。
  const cardBg = dark ? '#0d1117' : '#ffffff';
  if (cardBg !== ghLastCardBg) {
    ghLastCardBg = cardBg;
    document.documentElement.style.setProperty('--wre-gh-card-bg', cardBg);
  }
  ghPublishActiveTheme();
}
