/* 悬浮球设置界面与事件绑定
 * 由 content.js 拆分而来：语句顺序与原文件一致，跨文件共享同一全局作用域。
 */

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

  // 监听全屏变化（Esc 键或浏览器按钮退出全屏时恢复屏占比）
  document.addEventListener('fullscreenchange', handleFullscreenChange);
}
