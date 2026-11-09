/* 自动阅读
 * 由 content.js 拆分而来：语句顺序与原文件一致，跨文件共享同一全局作用域。
 */

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
