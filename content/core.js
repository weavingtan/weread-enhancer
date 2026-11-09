/* 常量 / 状态 / 存储 / 日志 / 元素定位与基准测量
 * 由 content.js 拆分而来：语句顺序与原文件一致，跨文件共享同一全局作用域。
 */

const WRE_PREFIX = '[Wechat-Reader-Enhancer]';

const WRE_STORAGE_KEYS = {
  state: 'wreState',
};

const WRE_DEFAULT_STATE = {
  // 100% = 不干预正文宽度（与微信读书原生一致）。改宽度会在每次窗口缩放时
  // 让微信读书重新分页/重渲染，看起来就是「页面又刷新了」，所以默认不插手。
  screenRatio: 100,
  // 用户是否亲手拖过屏占比滑杆：没动过就一直按 100% 处理，动过才记忆自定义值
  ratioUserSet: false,
  screenBasePx: null,
  screenBaseMode: 'container-v1',
  autoRead: {
    enabled: false,
    speed: 50,
    direction: 'down',
  },
  // 沉浸模式：隐藏顶部工具栏 / 右侧控制条 / 底部进度条（边缘唤出）
  immersiveMode: false,
  // GitHub 伪装开关（叠加在沉浸式之上，G 键切换）
  disguise: true,
  // 伪装皮肤：github（代码仓库） / notion（团队文档）
  skin: 'github',
  // 正文主题色：按系统深浅色分键记忆（weread-plus 移植；0=浅色清单首个「系统默认」，8=深色清单首个「系统默认」）
  bgLightIdx: 0,
  bgDarkIdx: 8,
  // 插件自身界面外观档位（light 浅色 / dark 深色 / auto 跟随系统）
  theme: 'auto',
};

let WRE_STATE = { ...WRE_DEFAULT_STATE };

let wreStyleTag = null;

let wreLastWrittenCss = '';

let wreRoot = null;

let lastReflowAt = 0;

let lastPreviewLogAt = 0;

let wreUnderlineReflowObserver = null;

let wreUnderlineReflowTimer = null;

let wreUnderlineReflowFired = false;

let wreAppliedSignature = '';

let autoReadTimer = null;

let autoReadIsInterval = false;

let wreFullscreenPreviousRatio = null;

function clampNumber(value, min, max) {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

/* 延迟任务统一登记：退出伪装时一次性取消。
 * 单独一个 setTimeout 的问题是「关了伪装它还会响」—— 表现为按 G 之后页面又闪一下，
 * 而这正是本项目最想避免的那种「又刷新了」的错觉。 */
const wreTimers = new Set();

function wreSetTimeout(fn, delay) {
  const id = window.setTimeout(() => {
    wreTimers.delete(id);
    fn();
  }, delay);
  wreTimers.add(id);
  return id;
}

function wreClearTimeout(id) {
  if (!id) return;
  window.clearTimeout(id);
  wreTimers.delete(id);
}

function wreClearTimers() {
  wreTimers.forEach((id) => window.clearTimeout(id));
  wreTimers.clear();
}

function scheduleWereadLayoutReflow(reason) {
  const now = Date.now();
  if (now - lastReflowAt < 120) {
    return;
  }
  lastReflowAt = now;
  wreSetTimeout(() => {
    triggerWereadLayoutReflow(reason);
  }, 0);
}

// 「页面被自己刷掉」这类问题只能靠计数对齐时间线：reload 紧跟在我们派发 resize 之后，
// 才说明是我们的锅。计数要跨 reload 保留，所以落在 sessionStorage（隐私模式下不可用就返回 -1）。
const WRE_REFLOW_COUNT_KEY = 'wre-reflow-count';

function readReflowCount() {
  try {
    return Number(sessionStorage.getItem(WRE_REFLOW_COUNT_KEY) || 0);
  } catch (e) {
    return -1;
  }
}

function bumpReflowCount() {
  const next = readReflowCount() + 1;
  try {
    sessionStorage.setItem(WRE_REFLOW_COUNT_KEY, String(next));
  } catch (e) {
    return -1;
  }
  return next;
}

function triggerWereadLayoutReflow(reason) {
  try {
    void document.body?.offsetHeight;
    // 只派发 resize：orientationchange 会让微信读书当成「设备旋转」走一遍完整重排，
    // 视觉上就是页面内容整块闪一下（用户感知为「又刷新了一次」）。
    window.dispatchEvent(new Event('resize'));
    log('info', '已触发页面重排', { reason, total: bumpReflowCount() });
  } catch (error) {
    log('warn', '触发页面重排失败', { reason, error: String(error) });
  }
}

// 官方划线层（.wr_underline_wrapper）在正文之后才渲染，且只在 resize 时按当前宽度重算坐标。
// 插件改过正文宽度后，如果划线层先于/晚于这次重排渲染，就会出现「打开书籍划线错位、刷新才正常」。
// 这里等划线层真正出现后再补一次重排，让官方按插件宽度重新计算划线坐标。
function scheduleUnderlineLayerReflow(reason) {
  // 屏占比 100% 时正文宽度与微信读书原生完全一致，划线坐标不需要重算；
  // 这时候再补派 resize 只会让微信读书把整块正文重新渲染一遍
  // —— 用户看到的就是「刷新页面后页面又刷新了一次」。
  if (clampNumber(Number(WRE_STATE.screenRatio), 50, 100) >= 100) {
    log('info', '屏占比 100%，跳过划线重排', { reason });
    return;
  }
  if (wreUnderlineReflowObserver) {
    wreUnderlineReflowObserver.disconnect();
    wreUnderlineReflowObserver = null;
  }
  if (wreUnderlineReflowTimer) {
    clearTimeout(wreUnderlineReflowTimer);
    wreUnderlineReflowTimer = null;
  }
  wreUnderlineReflowFired = false;

  const fire = (tag) => {
    if (wreUnderlineReflowFired || !getPrimaryContentElement()) {
      return;
    }
    wreUnderlineReflowFired = true;
    if (wreUnderlineReflowObserver) {
      wreUnderlineReflowObserver.disconnect();
      wreUnderlineReflowObserver = null;
    }
    if (wreUnderlineReflowTimer) {
      clearTimeout(wreUnderlineReflowTimer);
      wreUnderlineReflowTimer = null;
    }
    scheduleWereadLayoutReflow(`${reason}:${tag}`);
    // 官方划线层可能分多帧铺开，再补一次；但划线层数量没变就说明没有新的一批铺开，
    // 这时再派 resize 等于让微信读书白重排一次（用户看到的就是「又刷新了一次」）。
    const underlineCount = document.querySelectorAll('.wr_underline_wrapper').length;
    window.setTimeout(() => {
      if (document.querySelectorAll('.wr_underline_wrapper').length === underlineCount) return;
      scheduleWereadLayoutReflow(`${reason}:${tag}-late1`);
    }, 700);
  };

  if (document.querySelector('.wr_underline_wrapper')) {
    fire('already');
    return;
  }

  wreUnderlineReflowObserver = new MutationObserver(() => {
    if (document.querySelector('.wr_underline_wrapper')) {
      fire('underline-ready');
    }
  });
  wreUnderlineReflowObserver.observe(document.body, { childList: true, subtree: true });

  // 兜底：划线少 / 加载慢时也补一次重排
  wreUnderlineReflowTimer = window.setTimeout(() => fire('fallback'), 8000);
}

// info 级日志默认静默：伪装主题下「F12 一开满屏 [Wechat-Reader-Enhancer]」本身就是暴露面，
// 而且条数多（每次外观同步都有一条「侧栏留白测量」）。需要详细日志时在 URL 后加
// #wre-debug（与 #wre-off 同一族逃生开关，不占 UI）。warn / error 始终输出。
const WRE_DEBUG = /(^|[#&])wre-debug\b/.test(location.hash);

function log(level, message, meta) {
  if (level === 'info' && !WRE_DEBUG) return;
  const printable = meta ? `${WRE_PREFIX} ${message} ${JSON.stringify(meta)}` : `${WRE_PREFIX} ${message}`;
  if (level === 'error') {
    console.error(printable);
  } else if (level === 'warn') {
    console.warn(printable);
  } else {
    console.log(printable);
  }
}

async function loadState() {
  try {
    const result = await chrome.storage.local.get([WRE_STORAGE_KEYS.state]);
    log('info', '初始化读取存储状态', {
      hasState: Boolean(result[WRE_STORAGE_KEYS.state]),
      storedScreenRatio: result[WRE_STORAGE_KEYS.state]?.screenRatio || null,
    });
    if (result[WRE_STORAGE_KEYS.state]) {
      WRE_STATE = { ...WRE_DEFAULT_STATE, ...result[WRE_STORAGE_KEYS.state] };
    }
    if (WRE_STATE.screenBaseMode !== WRE_DEFAULT_STATE.screenBaseMode) {
      WRE_STATE.screenBaseMode = WRE_DEFAULT_STATE.screenBaseMode;
      WRE_STATE.screenBasePx = null;
      await chrome.storage.local.set({ [WRE_STORAGE_KEYS.state]: WRE_STATE });
    }
    // 旧版本把 80% 当默认值写进了存储；用户从没拖过滑杆的话，回到 100%（不干预宽度）。
    // 干预正文宽度的代价是每次窗口缩放微信读书都要重新分页重渲染，表现为「页面又刷新了」。
    if (WRE_STATE.ratioUserSet !== true && WRE_STATE.screenRatio !== 100) {
      log('info', '屏占比未由用户设置过，回退到 100%（不干预正文宽度）', { was: WRE_STATE.screenRatio });
      WRE_STATE.screenRatio = 100;
      WRE_STATE.screenBasePx = null;
      await chrome.storage.local.set({ [WRE_STORAGE_KEYS.state]: WRE_STATE });
    }
  } catch (error) {
    console.warn(`${WRE_PREFIX} 加载状态失败`, error);
  }
}

async function saveState() {
  try {
    await chrome.storage.local.set({ [WRE_STORAGE_KEYS.state]: WRE_STATE });
    log('info', '已保存插件状态', { screenRatio: WRE_STATE.screenRatio });
  } catch (error) {
    log('error', '保存插件状态失败', { error: String(error) });
  }
}

function getPrimaryContentElement() {
  return document.querySelector('.readerChapterContent');
}

function getReaderContainerElement() {
  return document.querySelector('.readerChapterContent_container');
}

async function measureDefaultBaseWidthPx() {
  // 基准取 .readerChapterContent_container 自身的宽度：它不受屏占比 CSS 影响（CSS 只作用于
  // .readerChapterContent / .app_content）。不再临时清空 styleTag，避免启动瞬间正文宽度反复
  // 变化，导致官方按错误宽度排版、划线层坐标随之错位。
  const container = getReaderContainerElement();
  if (!container) {
    return null;
  }
  const width = container.getBoundingClientRect().width;
  if (!Number.isFinite(width) || width <= 0) {
    return null;
  }
  return Number(width.toFixed(2));
}

async function primeScreenBasePx(force) {
  if (!force && Number.isFinite(WRE_STATE.screenBasePx) && WRE_STATE.screenBasePx > 0) {
    return;
  }
  const width = await measureDefaultBaseWidthPx();
  if (!width) {
    // 滚动模式没有 .readerChapterContent_container（宽度走百分比），不需要像素基准，静默跳过
    if (detectScrollMode() || !document.querySelector('.readerChapterContent')) {
      log('info', '滚动模式无需 screenBasePx 基准，跳过');
    } else {
      log('warn', '未能初始化 screenBasePx（未找到阅读内容元素）');
    }
    return;
  }
  WRE_STATE.screenBasePx = width;
  WRE_STATE.screenBaseMode = WRE_DEFAULT_STATE.screenBaseMode;
  await saveState();
  log('info', '已初始化 screenBasePx', { screenBasePx: WRE_STATE.screenBasePx });
}


