/* Canvas 像素自愈 + 系统深浅色 / DOM 重建监听
 * 由 content.js 拆分而来：语句顺序与原文件一致，跨文件共享同一全局作用域。
 */

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function collectReaderCanvases() {
  let canvases = document.querySelectorAll(
    '.readerChapterContent canvas, .renderTargetContent canvas, .wr_canvasContainer canvas'
  );
  if (canvases.length === 0) {
    canvases = Array.prototype.filter.call(
      document.querySelectorAll('.readerContent canvas, .app_content canvas'),
      (c) => c.width >= 200 || c.height >= 200
    );
  }
  return canvases;
}

function analyzeCanvas(c) {
  const scale = Math.min(1, 256 / Math.max(c.width, c.height));
  const w = Math.max(1, Math.round(c.width * scale));
  const h = Math.max(1, Math.round(c.height * scale));
  const buf = document.createElement('canvas');
  buf.width = w;
  buf.height = h;
  let bctx = null;
  try {
    bctx = buf.getContext('2d', { willReadFrequently: true });
    if (bctx) bctx.drawImage(c, 0, 0, w, h);
  } catch (e) {
    return null;
  }
  if (!bctx) return null;
  let img;
  try {
    img = bctx.getImageData(0, 0, w, h);
  } catch (e) {
    return null;
  }
  const d = img.data;
  let transparent = 0;
  let total = 0;
  let fgN = 0;
  let fgR = 0;
  let fgG = 0;
  let fgB = 0;
  for (let i = 0; i < d.length; i += 4) {
    total++;
    if (d[i + 3] < 32) {
      transparent++;
      continue; // eslint-disable-line no-continue
    }
    fgN++;
    fgR += d[i];
    fgG += d[i + 1];
    fgB += d[i + 2];
  }
  if (total === 0) return null;
  return {
    transparentRatio: transparent / total,
    fgColor: fgN ? [Math.round(fgR / fgN), Math.round(fgG / fgN), Math.round(fgB / fgN)] : null,
  };
}

function recolorTextCanvas(c, oldRgb, textRgb) {
  const buf = document.createElement('canvas');
  buf.width = c.width;
  buf.height = c.height;
  let bctx = null;
  try {
    bctx = buf.getContext('2d', { willReadFrequently: true });
    if (bctx) bctx.drawImage(c, 0, 0);
  } catch (e) {
    return false;
  }
  if (!bctx) return false;
  let img;
  try {
    img = bctx.getImageData(0, 0, c.width, c.height);
  } catch (e) {
    return false;
  }
  let writeCtx = null;
  try {
    writeCtx = c.getContext('2d');
  } catch (e) {
    writeCtx = null;
  }
  if (!writeCtx) return false;
  const d = img.data;
  const [or, og, ob] = oldRgb;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue; // eslint-disable-line no-continue
    const dr = d[i] - or;
    const dg = d[i + 1] - og;
    const db = d[i + 2] - ob;
    if (dr * dr + dg * dg + db * db > 120 * 120) continue; // eslint-disable-line no-continue
    d[i] = textRgb[0];
    d[i + 1] = textRgb[1];
    d[i + 2] = textRgb[2];
  }
  writeCtx.putImageData(img, 0, 0);
  return true;
}

function healIssueLog(c, tag, msg) {
  const key = `${tag}:${c.width}x${c.height}`;
  if (wreHealIssueKeys && wreHealIssueKeys.has(key)) return;
  if (!wreHealIssueKeys) wreHealIssueKeys = new Set();
  wreHealIssueKeys.add(key);
  log('info', 'canvas 自愈', { size: `${c.width}x${c.height}`, msg });
}

function healReaderCanvases() {
  const theme = WRE_BG_COLORS[wreBgIdx];
  const isDark = theme.type === 'dark';
  const textRgb = hexToRgb(isDark ? WRE_DARK_TEXT : WRE_LIGHT_TEXT);
  const textLum = 0.299 * textRgb[0] + 0.587 * textRgb[1] + 0.114 * textRgb[2];

  collectReaderCanvases().forEach((c) => {
    if (!c.width || !c.height) return;
    const info = analyzeCanvas(c);
    if (!info) {
      healIssueLog(c, 'unreadable', '像素不可读（canvas 被跨域资源污染），跳过');
      return;
    }
    const fg = info.fgColor;
    if (!fg) return;
    const fgLum = 0.299 * fg[0] + 0.587 * fg[1] + 0.114 * fg[2];
    if (theme.rgb) {
      // 插件主题：期望文字色即插件常量，接近即正确（自愈循环重复调用，正确的保持静默）
      if (Math.abs(fgLum - textLum) < 40) return;
    } else {
      // 系统默认：原生文字色未必等于插件常量，只按方向判断残留
      const looksHealthy = isDark ? fgLum >= 120 : fgLum < 120;
      if (looksHealthy) return;
    }
    if (info.transparentRatio <= 0.5) {
      // 整页绘制层可能含插图，重染风险高，只记录不改写
      healIssueLog(c, 'opaque', `整页绘制层颜色异常 rgb(${fg.join(',')})，暂未处理`);
      return;
    }
    if (recolorTextCanvas(c, fg, textRgb)) {
      log('info', 'canvas 自愈：已重染', {
        size: `${c.width}x${c.height}`,
        from: `rgb(${fg.join(',')})`,
        to: `rgb(${textRgb.join(',')})`,
      });
    } else {
      healIssueLog(c, 'nowrite', '像素可读但无法写回（WebGL/离屏渲染 canvas），跳过');
    }
  });
}

function onBgSystemThemeChange() {
  wreSystemThemeGen++;
  const gen = wreSystemThemeGen;
  wreHealIssueKeys = new Set(); // 异常日志重新计数
  // 像素自愈：切换瞬间立即改写 canvas 旧像素，随后重复几次，对抗微信读书迟到的重绘
  [0, 300, 800, 1500, 2500, 3500].forEach((delay) => {
    setTimeout(() => {
      if (gen !== wreSystemThemeGen) return;
      if (isDoubleColumnMode()) return; // 双栏模式由 forceCanvasRedraw 覆盖
      healReaderCanvases();
    }, delay);
  });
}

function bgRefreshWithRetry(fn, delays) {
  fn();
  delays.forEach((d) => setTimeout(fn, d));
}

function handleBgModeChange(isDark) {
  // 系统切换的 canvas 保护窗口 + 滚动模式兜底重绘（需先于新主题样式应用）
  onBgSystemThemeChange();
  // 恢复目标模式上次使用的主题
  applySystemBgMode(isDark);
  bgRefreshWithRetry(applyBgColor, [300, 800, 1500]);
}

function onBgSystemModeChange(isDark) {
  if (wreBgModeDedup !== null && isDark === wreBgModeDedup) return;
  wreBgModeDedup = isDark;
  log('info', '系统深浅色切换', { isDark });
  handleBgModeChange(isDark);
}

function startBgModeWatching() {
  wreBgModeDedup = isWereadDarkMode();

  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      onBgSystemModeChange(e.matches);
    });
  } catch (err) {
    log('warn', '监听系统深浅色失败', { error: String(err) });
  }

  const modeObserver = new MutationObserver(() => {
    onBgSystemModeChange(isWereadDarkMode());
  });
  modeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  modeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

let wreBgDomObserver = null;

let wreBgDomTimer = null;

function startBgDomWatching() {
  const attach = () => {
    const target = document.querySelector('.readerContent');
    if (!target) return false;
    applyBgColor();
    if (!wreBgDomObserver || wreBgDomObserver.__target !== target) {
      if (wreBgDomObserver) wreBgDomObserver.disconnect();
      wreBgDomObserver = new MutationObserver(() => {
        if (wreBgDomTimer) clearTimeout(wreBgDomTimer);
        wreBgDomTimer = setTimeout(() => {
          applyBgColor();
        }, 400);
      });
      wreBgDomObserver.__target = target;
      wreBgDomObserver.observe(target, { childList: true, subtree: true });
    }
    return true;
  };

  if (attach()) return;
  // .readerContent 尚未创建：轮询等待
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    if (attach() || tries > 120) clearInterval(timer);
  }, 500);
}

function initBgTheme() {
  const isDark = isWereadDarkMode();
  const key = isDark ? 'bgDarkIdx' : 'bgLightIdx';
  if (!isValidBgIdx(WRE_STATE[key], isDark ? 'dark' : 'light')) {
    WRE_STATE[key] = WRE_DEFAULT_STATE[key];
  }
  wreBgIdx = WRE_STATE[key];
  applyBgColor();
  startBgModeWatching();
  startBgDomWatching();
  log('info', '正文主题已初始化', { name: WRE_BG_COLORS[wreBgIdx].name, isDark });
}

function updateBgThemeUI() {
  if (!wreRoot) return;
  const name = wreRoot.querySelector('#wre-bg-name');
  const swatch = wreRoot.querySelector('#wre-bg-swatch');
  const theme = WRE_BG_COLORS[wreBgIdx];
  if (name && theme) {
    name.textContent = theme.name;
  }
  if (swatch && theme) {
    swatch.style.background = theme.rgb || 'linear-gradient(135deg, #ddd 45%, #333 55%)';
    swatch.style.display = 'inline-block';
  }
}
