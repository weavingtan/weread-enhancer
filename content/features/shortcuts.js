/* 快捷键系统
 * 由 content.js 拆分而来：语句顺序与原文件一致，跨文件共享同一全局作用域。
 */

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

  // 伪装态的「代码仓库」键位：/ 或 t 打开章节查找器，j / k 上下一章，h / l 上一页下一页。
  // 刻意不用 g 前缀（gg/ge）做首末章：g 是伪装开关的救命键，不能为了组合键让它延迟响应。
  if (WRE_STATE.disguise) {
    if (event.key === '/' || event.key === 't') {
      event.preventDefault();
      ghOpenFinder();
      return;
    }
    if (event.key === 'j' || event.key === 'k') {
      event.preventDefault();
      ghStepChapter(event.key === 'j' ? 1 : -1);
      return;
    }
    if (event.key === 'h' || event.key === 'l') {
      event.preventDefault();
      ghStepPage(event.key === 'l' ? 1 : -1);
      return;
    }
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
