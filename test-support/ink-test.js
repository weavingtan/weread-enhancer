// 验证 ghCanvasInkLeft：像素改走离屏 willReadFrequently 画布后，
// 1) 不再直接在微信读书画布上 getImageData（这正是 Chrome 告警的来源）
// 2) 找出的「第一列有墨迹」的 CSS 坐标仍然正确
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const files = manifest.content_scripts[0].js;

const dom = new JSDOM('<!doctype html><html><body><div class="readerContent"></div></body></html>', {
  url: 'https://weread.qq.com/web/reader/x',
  runScripts: 'outside-only',
});
const { window } = dom;

const store = {};
window.chrome = {
  storage: {
    local: {
      get: (keys) => Promise.resolve(keys.reduce((a, k) => (k in store ? { ...a, [k]: store[k] } : a), {})),
      set: (o) => { Object.assign(store, o); return Promise.resolve(); },
    },
    onChanged: { addListener: () => {} },
  },
  runtime: { id: 't', getURL: (p) => p, sendMessage: () => {} },
};
window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} });

// ---- 用假的 2D 上下文替换（jsdom 没有 canvas 实现）----
const SCALE = 2;           // 设备像素 / CSS px
const INK_CSS_X = 200;     // 正文左边界（CSS px）→ 设备 px 400
const INK_DEV_X = INK_CSS_X * SCALE;
const canvasHits = [];     // 记录「谁被直接读了像素」
const ctxLog = [];         // 记录每个上下文的创建属性

window.HTMLCanvasElement.prototype.getContext = function getContext(type, attrs) {
  const el = this;
  const isBuffer = el.id !== 'page-canvas';
  ctxLog.push({ isBuffer, willReadFrequently: !!(attrs && attrs.willReadFrequently) });
  let last = { sx: 0, sy: 0 };
  return {
    canvas: el,
    __willReadFrequently: !!(attrs && attrs.willReadFrequently),
    clearRect() {},
    drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh) {
      last = { sx, sy };
    },
    getImageData(x, y, w, h) {
      if (!isBuffer) canvasHits.push('page-canvas');
      const data = new Uint8ClampedArray(w * h * 4);
      for (let j = 0; j < h; j += 1) {
        for (let i = 0; i < w; i += 1) {
          const srcX = last.sx + x + i;
          const ink = srcX >= INK_DEV_X;
          const o = (j * w + i) * 4;
          const v = ink ? 0 : 255;
          data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255;
        }
      }
      return { data, width: w, height: h };
    },
  };
};

const code = files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
window.eval(code);

// 造一个 2000×1500 设备像素、对应 1000×750 CSS 的「正文画布」
const pageCanvas = window.document.createElement('canvas');
pageCanvas.id = 'page-canvas';
pageCanvas.width = 2000;
pageCanvas.height = 1500;
const rect = { left: 120, width: 1000, height: 750 };

const left = window.ghCanvasInkLeft(pageCanvas, rect);
console.log('返回的正文左边界:', left, '（期望', 120 + INK_CSS_X, '）');
console.log('页面上画布被直接 getImageData 的次数:', canvasHits.length, '（期望 0）');
const bufCtxOk = ctxLog.some((c) => c.isBuffer && c.willReadFrequently);
console.log('离屏中转画布带 willReadFrequently:', bufCtxOk);
console.log('上下文创建记录:', JSON.stringify(ctxLog));

const ok = left === 120 + INK_CSS_X && canvasHits.length === 0 && bufCtxOk;
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
