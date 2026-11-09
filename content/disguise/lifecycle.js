/* Toast、伪装开关与生命周期
 * 由 content.js 拆分而来：语句顺序与原文件一致，跨文件共享同一全局作用域。
 */

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

let ghObserver = null;

let ghObserverTimer = null;

let ghBodyObserver = null;

// canvas 从无到有（滚动 → 双栏）时不一定伴随被观察元素的尺寸变化，用低频探针兜底：
// 只做一次 querySelector（不量 rect、不读 Range），一旦观察到 canvas 就停表。
let ghCanvasProbe = null;

function ghStartCanvasProbe() {
  if (ghCanvasProbe || typeof ResizeObserver !== 'function') return;
  ghCanvasProbe = setInterval(() => {
    if (!WRE_STATE.disguise) {
      ghStopCanvasProbe();
      return;
    }
    const canvas = document.querySelector('.wr_canvasContainer canvas');
    if (!canvas) return;
    // 只做「挂上观察器」：ResizeObserver 对每个新目标都会立即回调一次，
    // 同步由那条回调（去抖后）完成 —— 探针自己不再测量，也不再读 rect。
    ghEnsureLayoutObservers();
    if (ghLayoutTargets.has(canvas)) ghStopCanvasProbe();
  }, 2000);
}

function ghStopCanvasProbe() {
  if (!ghCanvasProbe) return;
  clearInterval(ghCanvasProbe);
  ghCanvasProbe = null;
}

function ghSetActive(on) {
  ghLastChapterFile = ''; // 进出伪装都重算一次「当前文件」，别沿用上一轮的身份
  if (on) {
    document.documentElement.classList.add('wre-disguise');
    ghEnsureShell();
    ghChromeSignature = ''; // 强制重算一次外观状态
    ghSyncChrome(true);
    ghApplyPageIdentity();
    ghUpdatePager();
    // 只有翻页模式才需要惊动微信读书重新分页；滚动模式浏览器自己会重排，
    // 多派一次 resize 就是多一次整块闪（用户感知为「又刷新了一次」）。
    if (!detectScrollMode()) scheduleWereadLayoutReflow('gh-disguise-on');
    // 阅读器 DOM 可能晚于 content script 就绪：延后补一次屏占比 + 侧栏测量。
    wreSetTimeout(() => {
      // SPA 进书（书架 → 阅读器）时基准可能还没量过：先补量再应用，否则翻页模式没有 px 上限
      primeScreenBasePx(false).then(() => {
        applyScreenRatio(WRE_STATE.screenRatio);
        // 屏占比 100% = 没改正文宽度，不需要让微信读书再分页一次
        if (WRE_STATE.screenRatio !== 100 && !detectScrollMode()) {
          scheduleWereadLayoutReflow('gh-ratio-retry');
        }
        ghSyncSidebarFits();
        ghHideNativePager();
      });
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
          // 正文被重建时观察目标会失效：先补挂，再去抖同步（顺序反了会漏一帧尺寸）
          if (WRE_STATE.disguise) ghEnsureLayoutObservers();
          if (ghObserverTimer) wreClearTimeout(ghObserverTimer);
          ghObserverTimer = wreSetTimeout(() => {
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
    ghEnsureLayoutObservers();
    ghStartCanvasProbe();
    log('info', '伪装已开启', { doubleColumn: ghIsDoubleColumn() });
  } else {
    ghStopCanvasProbe();
    ghStopLayoutObservers();
    ghCloseFinder();
    // 关伪装时取消所有待执行的延迟任务：否则按 G 之后还会补一次 reflow / 屏占比，
    // 表现就是「已经退出了，页面又闪一下」。
    wreClearTimers();
    document.documentElement.classList.remove('wre-gh-filebar-ok');
    ghFilebarFitKey = '';
    document.documentElement.classList.remove('wre-disguise');
    document.documentElement.classList.remove('wre-gh-dark');
    document.documentElement.classList.remove('wre-double-column');
    document.documentElement.classList.remove('wre-gh-scroll');
    ghClearSidebarFits();
    ghRestorePageIdentity();
    ghChromeSignature = '';
    ghLastSizeSig = '';
    // 定时器本体已由上面的 wreClearTimers() 取消，这里只重置标记，
    // 否则下次切模式时 `!ghModeReflowTrailing` 恒为假、trailing 永远排不上。
    ghModeReflowTrailing = null;
    if (!detectScrollMode()) scheduleWereadLayoutReflow('gh-disguise-off');
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
    updateSkinUI();
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
    updateDisguiseUI();
  }
}

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
