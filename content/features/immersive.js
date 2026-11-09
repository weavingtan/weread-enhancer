/* 沉浸模式（隐藏顶栏、右侧控制条、底部进度条）
 * 由 content.js 拆分而来：语句顺序与原文件一致，跨文件共享同一全局作用域。
 */

let wreImmersiveHideTimer = null;

let wreImmersiveMoveHandler = null;

function applyImmersive() {
  const on = !!WRE_STATE.immersiveMode;
  document.documentElement.classList.toggle('wre-immersive', on);
  // 沉浸态下悬浮球一并隐藏（菜单展开时除外），左上角原位置悬停即唤出
  if (wreRoot) {
    const menuVisible = wreRoot.querySelector('#wre-main-menu')?.classList.contains('wre-visible');
    if (on && !menuVisible) {
      wreRoot.classList.add('wre-immersive-fab');
    } else if (!on) {
      wreRoot.classList.remove('wre-immersive-fab');
    }
  }
  if (!on) {
    if (wreImmersiveHideTimer) { clearTimeout(wreImmersiveHideTimer); wreImmersiveHideTimer = null; }
    document.documentElement.classList.remove('wre-immersive-show-top');
    document.documentElement.classList.remove('wre-immersive-show-controls');
    document.documentElement.classList.remove('wre-immersive-show-bottom');
  } else {
    // 沉浸态下顶栏/控制条的钉住样式沿用浮动逻辑（z-index 与居中）
    pinTopBar();
    pinControls();
    ensureImmersiveTrigger();
    ensureToolbarTrigger();
  }
  updateImmersiveUI();
}

function ensureImmersiveTrigger() {
  if (wreImmersiveMoveHandler) return;

  const show = (cls) => {
    if (wreImmersiveHideTimer) { clearTimeout(wreImmersiveHideTimer); wreImmersiveHideTimer = null; }
    document.documentElement.classList.add(cls);
  };
  const scheduleHide = () => {
    if (wreImmersiveHideTimer) return;
    wreImmersiveHideTimer = setTimeout(() => {
      document.documentElement.classList.remove('wre-immersive-show-top');
      document.documentElement.classList.remove('wre-immersive-show-controls');
      document.documentElement.classList.remove('wre-immersive-show-bottom');
      wreImmersiveHideTimer = null;
    }, 400);
  };

  wreImmersiveMoveHandler = (event) => {
    if (!WRE_STATE.immersiveMode) return;
    const inTop = event.clientY <= WRE_TOPBAR_ZONE_PX && !isOfficialPanelAtTop();
    const inRight = window.innerWidth - event.clientX <= WRE_CONTROLS_ZONE_PX;
    const inBottom = window.innerHeight - event.clientY <= WRE_BOTTOM_ZONE_PX;
    if (inTop) {
      pinTopBar();
      show('wre-immersive-show-top');
    }
    if (inRight) {
      pinControls();
      show('wre-immersive-show-controls');
    }
    if (inBottom) {
      show('wre-immersive-show-bottom');
    }
    if (!inTop && !inRight && !inBottom) {
      scheduleHide();
    }
  };
  document.addEventListener('mousemove', wreImmersiveMoveHandler, true);
}

function toggleImmersive() {
  WRE_STATE.immersiveMode = !WRE_STATE.immersiveMode;
  applyImmersive();
  saveState();
  log('info', '沉浸模式已切换', { immersiveMode: WRE_STATE.immersiveMode });
}

function updateImmersiveUI() {
  if (!wreRoot) return;
  const btn = wreRoot.querySelector('#wre-immersive-toggle');
  if (btn) {
    btn.textContent = WRE_STATE.immersiveMode ? '退出沉浸模式' : '进入沉浸模式';
    btn.classList.toggle('wre-immersive-active', !!WRE_STATE.immersiveMode);
  }
}

function getViewportScroller() {
  return document.scrollingElement || document.documentElement;
}

function updateCustomScrollbar() {
  if (!wreCustomScrollbar || !wreCustomScrollbarThumb) return;
  if (!document.documentElement.classList.contains('wre-scrollmode')) return;
  const se = getViewportScroller();
  const sh = se.scrollHeight;
  const ch = se.clientHeight;
  if (sh <= ch + 4) {
    wreCustomScrollbar.style.display = 'none';
    return;
  }
  wreCustomScrollbar.style.display = 'block';
  const trackH = wreCustomScrollbar.clientHeight || window.innerHeight;
  const thumbH = Math.max(40, Math.round((trackH * ch) / sh));
  const maxScroll = sh - ch;
  const maxThumbTop = trackH - thumbH;
  const thumbTop = maxScroll > 0 ? Math.round(maxThumbTop * (se.scrollTop / maxScroll)) : 0;
  wreCustomScrollbarThumb.style.height = `${thumbH}px`;
  wreCustomScrollbarThumb.style.top = `${thumbTop}px`;
}

function ensureCustomScrollbar() {
  if (wreCustomScrollbar && document.body.contains(wreCustomScrollbar)) return;
  const bar = document.createElement('div');
  bar.id = 'wre-custom-scrollbar';
  const thumb = document.createElement('div');
  thumb.id = 'wre-custom-scrollbar-thumb';
  bar.appendChild(thumb);
  document.body.appendChild(bar);
  wreCustomScrollbar = bar;
  wreCustomScrollbarThumb = thumb;

  // 拖动 thumb 跳转
  let dragStartY = 0;
  let dragStartScroll = 0;
  thumb.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    wreScrollbarDragging = true;
    dragStartY = e.clientY;
    dragStartScroll = getViewportScroller().scrollTop;
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', (e) => {
    if (!wreScrollbarDragging) return;
    const se = getViewportScroller();
    const sh = se.scrollHeight;
    const ch = se.clientHeight;
    const trackH = bar.clientHeight || window.innerHeight;
    const thumbH = thumb.offsetHeight;
    const maxThumbTop = trackH - thumbH;
    const maxScroll = sh - ch;
    if (maxThumbTop <= 0) return;
    const deltaY = e.clientY - dragStartY;
    se.scrollTop = dragStartScroll + (deltaY / maxThumbTop) * maxScroll;
  });
  document.addEventListener('mouseup', () => {
    if (wreScrollbarDragging) {
      wreScrollbarDragging = false;
      document.body.style.userSelect = '';
    }
  });

  // 点击 track 空白处跳转到对应位置
  bar.addEventListener('mousedown', (e) => {
    if (e.target !== bar) return;
    const se = getViewportScroller();
    const rect = bar.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    se.scrollTop = ratio * (se.scrollHeight - se.clientHeight);
    updateCustomScrollbar();
  });

  log('info', '已创建自绘悬浮滚动条');
}

function openModal(selector) {
  const modal = wreRoot?.querySelector(selector);
  if (modal) {
    modal.classList.add('wre-visible');
  }
}

function closeModal(selector) {
  const modal = wreRoot?.querySelector(selector);
  if (modal) {
    modal.classList.remove('wre-visible');
  }
}

function createUI() {
  const existingRoot = document.getElementById('we-read-enhancer-root');
  if (existingRoot) {
    existingRoot.remove();
  }

  const root = document.createElement('div');
  root.id = 'we-read-enhancer-root';

  root.innerHTML = `
    <div class="wre-fab" id="wre-fab"><svg class="wre-fab-logo" viewBox="0 0 448 448" aria-hidden="true"><circle cx="224" cy="224" r="224" fill="#3B82F6"/><path d="M126 148 L174 300 L224 184 L274 300 L322 148" fill="none" stroke="#FFFFFF" stroke-width="38" stroke-linecap="round" stroke-linejoin="round"/></svg></div>

    <div class="wre-panel-container" id="wre-main-menu">
      <div class="wre-menu-group">阅读</div>
      <div class="wre-menu-item" data-action="immersive"><span class="wre-menu-icon">🔮</span>沉浸模式</div>
      <div class="wre-menu-item" data-action="read-settings"><span class="wre-menu-icon">📖</span>阅读设置</div>

      <div class="wre-menu-group">关于</div>
      <div class="wre-menu-item" data-action="shortcuts"><span class="wre-menu-icon">⌨️</span>快捷键说明</div>
      <div class="wre-menu-item" data-action="restore-default"><span class="wre-menu-icon">🔄</span>恢复默认设置</div>
    </div>

    <div class="wre-modal-overlay" id="wre-read-settings-modal">
      <div class="wre-modal">
        <div class="wre-modal-header">
          <span class="wre-modal-title">📖 阅读设置</span>
          <button class="wre-modal-close" data-close="#wre-read-settings-modal">&times;</button>
        </div>
        <div class="wre-modal-body">
          <div class="wre-setting-item">
            <label class="wre-setting-label">🕶 伪装视图</label>
            <div class="wre-setting-control">
              <button class="wre-btn" id="wre-disguise-toggle">
                <span id="wre-disguise-toggle-text">伪装已开启 · 点击退出</span>
              </button>
            </div>
            <div class="wre-setting-tip">把阅读页画成 GitHub 仓库页（伪装态下点顶栏头像即可回到这里）；快捷键 G 随时切换。</div>
          </div>

          <div class="wre-setting-item">
            <label class="wre-setting-label">🎭 伪装皮肤</label>
            <div class="wre-setting-control">
              <div class="wre-theme-toggle" id="wre-skin-toggle">
                <button class="wre-btn wre-btn-small" data-skin="github">GitHub</button>
                <button class="wre-btn wre-btn-small" data-skin="notion">Notion</button>
              </div>
            </div>
            <div class="wre-setting-tip">GitHub = 代码仓库页；Notion = 团队文档页。切换后标题、图标与侧栏一起更换。</div>
          </div>

          <div class="wre-setting-item">
            <label class="wre-setting-label">🔮 沉浸模式</label>
            <div class="wre-setting-control">
              <button class="wre-btn" id="wre-immersive-toggle">进入沉浸模式</button>
            </div>
            <div class="wre-setting-tip">隐藏顶部工具栏、右侧控制条与底部进度条，只留正文；鼠标移到顶部 / 右侧 / 底部边缘可临时唤出，快捷键 I。</div>
          </div>

          <div class="wre-setting-item">
            <label class="wre-setting-label">屏占比调节</label>
            <div class="wre-setting-control">
              <input type="range" class="wre-slider" id="wre-screen-ratio" min="50" max="100" value="${WRE_STATE.screenRatio}">
              <span class="wre-slider-value" id="wre-screen-ratio-value">${WRE_STATE.screenRatio}%</span>
            </div>
            <div class="wre-setting-tip">比例含义：相对于阅读区域容器宽度（100% = 当前屏幕可用宽度）。</div>
            <div class="wre-quick-actions" id="wre-screen-ratio-quick">
              <button class="wre-btn wre-btn-small" data-ratio="100">100%</button>
              <button class="wre-btn wre-btn-small" data-ratio="90">90%</button>
              <button class="wre-btn wre-btn-small" data-ratio="80">80%</button>
              <button class="wre-btn wre-btn-small" data-ratio="70">70%</button>
            </div>
          </div>

          <div class="wre-setting-item">
            <label class="wre-setting-label">📜 自动阅读</label>
            <div class="wre-autoread-controls">
              <button class="wre-btn wre-autoread-btn" id="wre-autoread-toggle">
                <span id="wre-autoread-toggle-text">▶ 开始自动阅读</span>
              </button>
              <div class="wre-direction-toggle">
                <button class="wre-btn wre-btn-small wre-dir-btn" data-dir="down" id="wre-dir-down">↓ 向下</button>
                <button class="wre-btn wre-btn-small wre-dir-btn" data-dir="up" id="wre-dir-up">↑ 向上</button>
              </div>
            </div>
            <div class="wre-setting-control" style="margin-top: 12px;">
              <span style="font-size: 12px; color: var(--wre-text); min-width: 36px;">速度</span>
              <input type="range" class="wre-slider" id="wre-autoread-speed" min="10" max="100" value="${WRE_STATE.autoRead.speed}">
              <span class="wre-slider-value" id="wre-autoread-speed-value">${WRE_STATE.autoRead.speed}</span>
            </div>
            <div class="wre-setting-tip">快捷键：空格 开始/暂停 | 按 ? 查看全部快捷键</div>
          </div>

          <div class="wre-setting-item">
            <label class="wre-setting-label">🌈 正文主题</label>
            <div class="wre-setting-control">
              <button class="wre-btn wre-btn-small" id="wre-bg-prev">‹</button>
              <span class="wre-bg-swatch" id="wre-bg-swatch"></span>
              <span class="wre-slider-value" id="wre-bg-name">系统默认</span>
              <button class="wre-btn wre-btn-small" id="wre-bg-next">›</button>
            </div>
            <div class="wre-setting-tip">16 种预设背景色（浅色 / 深色各 8 种），随系统深浅色分档记忆；「系统默认」跟随微信读书原生外观。</div>
          </div>

          <div class="wre-setting-item">
            <label class="wre-setting-label">🎨 外观</label>
            <div class="wre-theme-toggle" id="wre-theme-toggle">
              <button class="wre-btn wre-btn-small wre-theme-btn${WRE_STATE.theme === 'light' ? ' wre-theme-active' : ''}" data-theme="light">浅色</button>
              <button class="wre-btn wre-btn-small wre-theme-btn${WRE_STATE.theme === 'dark' ? ' wre-theme-active' : ''}" data-theme="dark">深色</button>
              <button class="wre-btn wre-btn-small wre-theme-btn${WRE_STATE.theme !== 'light' && WRE_STATE.theme !== 'dark' ? ' wre-theme-active' : ''}" data-theme="auto">跟随系统</button>
            </div>
            <div class="wre-setting-tip">仅调整插件自身界面（菜单 / 弹窗）的明暗，不影响阅读页正文与官方样式。</div>
          </div>

        </div>
      </div>
    </div>

    <div class="wre-modal-overlay" id="wre-shortcuts-modal">
      <div class="wre-modal">
        <div class="wre-modal-header">
          <span class="wre-modal-title">⌨️ 快捷键说明</span>
          <button class="wre-modal-close" data-close="#wre-shortcuts-modal">&times;</button>
        </div>
        <div class="wre-modal-body">
          <table class="wre-shortcuts-table">
            <thead>
              <tr><th>快捷键</th><th>功能</th><th>状态</th></tr>
            </thead>
            <tbody>
              <tr class="wre-shortcuts-group"><td colspan="3">插件快捷键</td></tr>
              <tr>
                <td><span class="wre-shortcut-key">G</span></td>
                <td>一键切换 伪装视图 / 微信读书原样</td>
                <td>启用</td>
              </tr>
              <tr>
                <td><span class="wre-shortcut-key">/</span><span class="wre-shortcut-sep">/</span><span class="wre-shortcut-key">T</span></td>
                <td>章节查找器（伪装态，输入章节名回车跳章）</td>
                <td>启用</td>
              </tr>
              <tr>
                <td><span class="wre-shortcut-key">J</span><span class="wre-shortcut-sep">/</span><span class="wre-shortcut-key">K</span></td>
                <td>下一章 / 上一章（伪装态）</td>
                <td>启用</td>
              </tr>
              <tr>
                <td><span class="wre-shortcut-key">I</span></td>
                <td>进入 / 退出沉浸模式（隐藏顶部 / 右侧 / 底部，边缘唤出）</td>
                <td>启用</td>
              </tr>
              <tr>
                <td><span class="wre-shortcut-key">Space</span></td>
                <td>开始 / 暂停自动阅读（按设定节奏自动往下翻页）</td>
                <td id="wre-shortcut-autoread-status">启用</td>
              </tr>
              <tr>
                <td><span class="wre-shortcut-key">F</span></td>
                <td>进入 / 退出全屏（全屏时屏比自动设为 100%）</td>
                <td>启用</td>
              </tr>
              <tr>
                <td><span class="wre-shortcut-key">?</span></td>
                <td>显示 / 隐藏此帮助面板</td>
                <td>启用</td>
              </tr>
              <tr class="wre-shortcuts-group"><td colspan="3">微信读书原生（插件不拦截）</td></tr>
              <tr>
                <td><span class="wre-shortcut-key">←</span><span class="wre-shortcut-sep">/</span><span class="wre-shortcut-key">→</span></td>
                <td>上一页 / 下一页</td>
                <td>官方原生</td>
              </tr>
              <tr>
                <td><span class="wre-shortcut-key">Esc</span></td>
                <td>退出全屏（屏占比自动恢复）</td>
                <td>官方原生</td>
              </tr>
            </tbody>
          </table>
          <div class="wre-shortcuts-footer">提示：快捷键仅在微信读书网页内生效，输入框中不触发；Ctrl / Alt / Cmd 组合键同样不触发</div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(root);
  wreRoot = root;
  bindEvents(root);
  updateImmersiveUI();
  updateBgThemeUI();
  log('info', '插件 UI 已加载', {
    screenRatio: WRE_STATE.screenRatio,
    screenBasePx: WRE_STATE.screenBasePx,
    href: window.location.href,
  });
}
