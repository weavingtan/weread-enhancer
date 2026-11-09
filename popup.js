/**
 * GitHub Reader · 工具栏弹窗（设置的唯一入口）
 *
 * 读 / 写 chrome.storage.local 的 wreState，阅读页 content script 监听变更即时生效。
 * 阅读页不再有悬浮球，所有设置都在这里。
 */
(function () {
  'use strict';

  // 与 content/features/theme.js 的 WRE_BG_COLORS 保持一致（顺序 / 色值 / 深浅分组）
  const BG_COLORS = [
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

  const STATE_KEY = 'wreState';
  const ACTIVE_KEY = 'wreActiveTheme';
  const DEFAULT_STATE = {
    disguise: true,
    skin: 'github',
    immersiveMode: false,
    // 100 = 不干预正文宽度；只有用户亲手拖过滑杆才记忆自定义值
    screenRatio: 100,
    ratioUserSet: false,
    autoRead: { enabled: false, speed: 50, direction: 'down' },
    bgLightIdx: 0,
    bgDarkIdx: 8,
    theme: 'auto',
  };

  let state = { ...DEFAULT_STATE, autoRead: { ...DEFAULT_STATE.autoRead } };
  // 阅读页上报的当前生效主题（无法从弹窗侧判断微信读书深浅色）
  let active = { isDark: false, name: '系统默认' };

  const $ = (id) => document.getElementById(id);
  let saveTimer = null;

  function save(immediate) {
    const write = () => {
      try {
        chrome.storage.local.set({ [STATE_KEY]: state });
      } catch (e) {
        /* 写入失败不影响交互 */
      }
    };
    if (immediate) {
      write();
      return;
    }
    // 滑块拖动时防抖，避免频繁写存储
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(write, 220);
  }

  function availableColors() {
    return BG_COLORS.filter((c) => (active.isDark ? c.type === 'dark' : c.type === 'light'));
  }

  function currentColorIndex() {
    const available = availableColors();
    const key = active.isDark ? 'bgDarkIdx' : 'bgLightIdx';
    const idx = state[key];
    const color = BG_COLORS[idx];
    const pos = available.indexOf(color);
    return pos >= 0 ? pos : 0;
  }

  function applyUI() {
    const setSwitch = (id, on) => {
      const el = $(id);
      if (!el) return;
      el.classList.toggle('wre-on', !!on);
      el.setAttribute('aria-pressed', String(!!on));
    };
    setSwitch('wre-pop-disguise', state.disguise);
    setSwitch('wre-pop-immersive', state.immersiveMode);
    setSwitch('wre-pop-autoread', state.autoRead?.enabled);

    const ratio = $('wre-pop-ratio');
    if (ratio) ratio.value = String(state.screenRatio);
    const ratioValue = $('wre-pop-ratio-value');
    if (ratioValue) ratioValue.textContent = `${state.screenRatio}%`;

    const speed = $('wre-pop-speed');
    if (speed) speed.value = String(state.autoRead.speed);
    const speedValue = $('wre-pop-speed-value');
    if (speedValue) speedValue.textContent = String(state.autoRead.speed);

    document.querySelectorAll('#wre-pop-dir button').forEach((btn) => {
      btn.classList.toggle('wre-active', btn.getAttribute('data-dir') === state.autoRead.direction);
    });
    document.querySelectorAll('#wre-pop-theme button').forEach((btn) => {
      btn.classList.toggle('wre-active', btn.getAttribute('data-theme') === state.theme);
    });
    document.querySelectorAll('#wre-pop-skin button').forEach((btn) => {
      btn.classList.toggle('wre-active', btn.getAttribute('data-skin') === (state.skin || 'github'));
    });

    const available = availableColors();
    const color = available[currentColorIndex()];
    const name = $('wre-pop-bg-name');
    if (name) name.textContent = color ? color.name : '系统默认';
    const swatch = $('wre-pop-swatch');
    if (swatch) swatch.style.background = color?.rgb || 'linear-gradient(135deg, #ddd 45%, #333 55%)';
  }

  function cycleColor(delta) {
    const available = availableColors();
    const next = (currentColorIndex() + delta + available.length) % available.length;
    const color = available[next];
    const idx = BG_COLORS.indexOf(color);
    if (idx < 0) return;
    if (color.type === 'dark') state.bgDarkIdx = idx;
    else state.bgLightIdx = idx;
    applyUI();
    save(true);
  }

  function bindSwitch(id, onChange) {
    $(id)?.addEventListener('click', () => {
      onChange();
      applyUI();
      save(true);
    });
  }

  async function init() {
    try {
      const version = chrome.runtime.getManifest().version;
      const el = $('wre-pop-version');
      if (el && version) el.textContent = 'v' + version;
    } catch (e) {
      /* 版本号拿不到就不显示 */
    }

    try {
      const result = await chrome.storage.local.get([STATE_KEY, ACTIVE_KEY]);
      if (result[STATE_KEY]) {
        state = { ...DEFAULT_STATE, ...result[STATE_KEY] };
        state.autoRead = { ...DEFAULT_STATE.autoRead, ...(result[STATE_KEY].autoRead || {}) };
      }
      if (result[ACTIVE_KEY]) active = { ...active, ...result[ACTIVE_KEY] };
    } catch (e) {
      /* 读取失败用默认值 */
    }
    applyUI();

    bindSwitch('wre-pop-disguise', () => { state.disguise = !state.disguise; });
    bindSwitch('wre-pop-immersive', () => { state.immersiveMode = !state.immersiveMode; });
    bindSwitch('wre-pop-autoread', () => {
      state.autoRead.enabled = !state.autoRead.enabled;
    });

    $('wre-pop-ratio')?.addEventListener('input', (event) => {
      state.screenRatio = Number.parseInt(event.target.value, 10) || 100;
      // 标记「用户亲手设过」，否则下次加载会被当成默认值回退到 100%
      state.ratioUserSet = true;
      applyUI();
      save();
    });

    $('wre-pop-speed')?.addEventListener('input', (event) => {
      state.autoRead.speed = Number.parseInt(event.target.value, 10) || 50;
      applyUI();
      save();
    });

    document.querySelectorAll('#wre-pop-dir button').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.autoRead.direction = btn.getAttribute('data-dir') === 'up' ? 'up' : 'down';
        applyUI();
        save(true);
      });
    });

    document.querySelectorAll('#wre-pop-theme button').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.theme = btn.getAttribute('data-theme') || 'auto';
        applyUI();
        save(true);
      });
    });

    document.querySelectorAll('#wre-pop-skin button').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.skin = btn.getAttribute('data-skin') === 'notion' ? 'notion' : 'github';
        applyUI();
        save(true);
      });
    });

    $('wre-pop-bg-prev')?.addEventListener('click', () => cycleColor(-1));
    $('wre-pop-bg-next')?.addEventListener('click', () => cycleColor(1));

    $('wre-pop-reset')?.addEventListener('click', () => {
      state = { ...DEFAULT_STATE, autoRead: { ...DEFAULT_STATE.autoRead } };
      applyUI();
      save(true);
    });
  }

  init();
})();
