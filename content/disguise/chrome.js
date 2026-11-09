/* 标签页身份 + 外观同步 + 侧栏留白 + 隐藏原生分页
 * 由 content.js 拆分而来：语句顺序与原文件一致，跨文件共享同一全局作用域。
 */

let ghTitleObserver = null;

let ghOriginalTitle = null;

let ghOriginalFavicons = null;

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

const GH_NATIVE_PAGER_TEXTS = ['上一页', '下一页', '上一章', '下一章', '上一节', '下一节'];

let ghLastPagerSweep = 0;

/* 双栏（Canvas 位图）放侧栏：正文一个像素都不动，把侧栏直接盖在书页左侧的页边空白上。
 * 空白宽度靠读 canvas 像素实测（找第一列有墨迹的 x），侧栏宽度随之自适应；
 * 宁可窄也不压字 —— 留白不够就直接不显示。 */
const GH_SIDEBAR_MIN_W = 120; // 窄于这个宽度，文件树没有意义

const GH_SIDEBAR_MAX_W = 248;

let ghSidebarVisualW = '';

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

let ghLastSizeSig = '';

let ghLastCardBg = '';

let ghLastModeReflowAt = 0;

// 被节流吞掉的切模式，用这个定时器补最后一次（否则停在旧分页宽度）
let ghModeReflowTrailing = null;

let ghTopbarH = '';

function ghSizeSignature() {
  const canvas = document.querySelector('.wr_canvasContainer canvas');
  const c = canvas ? `${canvas.width}x${canvas.height}` : 'none';
  // 屏占比也要进签名：滚动模式下正文宽度按视口百分比走，窗口尺寸没变但
  // .app_content 的 left 变了，侧栏留白必须重算，否则会按旧留白盖住正文。
  return `${window.innerWidth}x${window.innerHeight}|${c}|${WRE_STATE.screenRatio}`;
}

function ghSyncChromeInner(force) {
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
        setTimeout(() => triggerWereadLayoutReflow('gh-mode-switch'), 120);
      } else if (!ghModeReflowTrailing) {
        ghModeReflowTrailing = setTimeout(() => {
          ghModeReflowTrailing = null;
          ghLastModeReflowAt = Date.now();
          triggerWereadLayoutReflow('gh-mode-switch-trailing');
        }, wait + 120);
      }
    }
  }

  // 尺寸真的变了才重新量留白（这一步含 getBoundingClientRect，会强制布局）
  const sizeSig = ghSizeSignature();
  if (statusChanged || sizeSig !== ghLastSizeSig) {
    ghLastSizeSig = sizeSig;
    ghSyncSidebarFits();
  }
  ghRenderCatalogTree();

  // 伪装态正文固定 GitHub 卡片色：暖色/米黄主题留在「按 G 退出伪装」时自己看。
  // 米黄卡片贴在灰白外壳上色块断层太明显，一眼就看得出不是网页。
  const cardBg = dark ? '#0d1117' : '#ffffff';
  if (cardBg !== ghLastCardBg) {
    ghLastCardBg = cardBg;
    document.documentElement.style.setProperty('--wre-gh-card-bg', cardBg);
  }
  ghPublishActiveTheme();
}
