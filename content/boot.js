/* 启动：初始化（loadState → 主题 → 面板 → 伪装 → 屏占比）与 SPA 路由接管
 * 必须最后加载：init 里调用的函数分散在前面的模块里。
 */
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
      // 兜底：模式/基准判定晚于正文时再补一次；组合没变就不重复写（重复写会再触发一遍样式重算）
      setTimeout(() => {
        const signature = `${Number(WRE_STATE.screenRatio)}|${detectScrollMode() ? 'scroll' : 'page'}|${WRE_STATE.screenBasePx || 0}`;
        if (signature === wreAppliedSignature) return;
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
  log('warn', '刷新后未判定就绪，已兜底应用屏占比', { ratio, applied });
  return false;
}

// 5 秒内重复加载 = 页面真的被重新载入（而不是重排造成的视觉闪烁），
// 排查「刷新后页面又刷新一次」时，这一行能直接区分两者。
function wreTrackBoot() {
  try {
    const KEY = 'wre-boot-at';
    const prev = Number(sessionStorage.getItem(KEY) || 0);
    const now = Date.now();
    sessionStorage.setItem(KEY, String(now));
    if (prev && now - prev < 5000) {
      log('warn', '检测到 5 秒内页面被重复加载', {
        gapMs: now - prev,
        navType: performance.getEntriesByType?.('navigation')?.[0]?.type || '(unknown)',
      });
    }
  } catch (e) { /* 隐私模式下 sessionStorage 不可用就跳过 */ }
}

async function init() {
  const t0 = performance.now();
  wreTrackBoot();
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
  wreLastWrittenCss = '';
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
  // 卡片宽度随窗口/屏占比变化时，分页条要重新对齐卡片边缘（强制重量一次 rect）
  window.addEventListener('resize', ghRepositionPager);

  // 监听全屏变化（Esc 键或浏览器按钮退出全屏时恢复屏占比）
  document.addEventListener('fullscreenchange', handleFullscreenChange);
}

if (document.body) {
  init();
} else {
  document.addEventListener("DOMContentLoaded", init);
}
