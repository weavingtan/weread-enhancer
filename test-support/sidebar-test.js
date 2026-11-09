// 验证侧栏留白测量：按「真实文字左边界」而不是容器 rect 决定宽度，
// 留白不足时直接不显示，绝不压字。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const files = manifest.content_scripts[0].js;

const html = '<!doctype html><html><body><div class="readerContent"><div class="app_content">'
  + '<div class="readerChapterContent_container"><div class="readerChapterContent">'
  + '<p>正文第一段正文第一段</p></div></div></div></div>'
  + '<div class="wre-gh-sidebar"></div></body></html>';

const dom = new JSDOM(html, { url: 'https://weread.qq.com/web/reader/x', runScripts: 'outside-only', pretendToBeVisual: true });
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
window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });

// 容器 rect 故意比字更靠左（容器内边距），旧的算法就是被这个 rect 骗到的
const CONTAINER_LEFT = 60;
window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  if (this.classList && (this.classList.contains('readerChapterContent') || this.classList.contains('app_content'))) {
    return { left: CONTAINER_LEFT, top: 0, width: 800, height: 600, right: CONTAINER_LEFT + 800, bottom: 600 };
  }
  return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
};

let TEXT_LEFT = 150;
window.Range.prototype.getClientRects = function getClientRects() {
  return [{ left: TEXT_LEFT, top: 10, width: 300, height: 20, right: TEXT_LEFT + 300, bottom: 30 }];
};

window.eval(files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n'));

const root = window.document.documentElement;
const read = () => ({
  ok: root.classList.contains('wre-gh-sidebar-ok'),
  w: root.style.getPropertyValue('--wre-gh-sidebar-visual-w'),
});

const results = [];

// 场景 1：字在 150 → 留白 140，侧栏 140px，不压字
window.ghSyncSidebarFits();
results.push({ name: '字在 150（容器 60）', expect: { ok: true, w: '140px' }, got: read() });

// 场景 2：字在 110 → 留白 100 < 120，侧栏应该隐藏
TEXT_LEFT = 110;
window.ghSyncSidebarFits();
results.push({ name: '字在 110', expect: { ok: false, w: '' }, got: read() });

// 场景 3：字在 900（正文被推到很右）→ 宽度封顶 248
TEXT_LEFT = 900;
window.ghSyncSidebarFits();
results.push({ name: '字在 900（封顶）', expect: { ok: true, w: '248px' }, got: read() });

let pass = true;
for (const r of results) {
  const ok = r.got.ok === r.expect.ok && r.got.w === r.expect.w;
  if (!ok) pass = false;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.name}  期望 ${JSON.stringify(r.expect)}  实际 ${JSON.stringify(r.got)}`);
}
console.log(pass ? '\nPASS' : '\nFAIL');
process.exit(pass ? 0 : 1);
