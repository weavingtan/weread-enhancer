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
