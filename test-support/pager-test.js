// 验证分页条对齐：贴着正文卡片左右边缘、侧栏在时 Previous 不压文件树、极端窄屏回退默认
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const files = manifest.content_scripts[0].js;

const dom = new JSDOM(
  '<!doctype html><html class="wre-disguise"><body>'
  + '<div class="readerContent"><div class="app_content"><div class="readerChapterContent"><p>正文</p></div></div></div>'
  + '<div class="wre-gh-sidebar"><span>文件树</span></div>'
  + '<div class="wre-gh-pager"><button class="wre-gh-pager-btn">Previous</button><button class="wre-gh-pager-btn">Next</button></div>'
  + '</body></html>',
  { url: 'https://weread.qq.com/web/reader/x', runScripts: 'outside-only', pretendToBeVisual: true },
);
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

let CARD = { left: 130, right: 1093, width: 963, top: 0, bottom: 600, height: 600 };
let SIDEBAR_RIGHT = 0;
let VIEWPORT = 1220;

window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  const cls = this.classList;
  if (cls && cls.contains('readerChapterContent')) return { ...CARD };
  if (cls && cls.contains('wre-gh-sidebar')) return { left: 0, right: SIDEBAR_RIGHT, width: SIDEBAR_RIGHT, top: 0, bottom: 600, height: 600 };
  return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
};
Object.defineProperty(window.document.documentElement, 'clientWidth', { get: () => VIEWPORT, configurable: true });

window.eval(files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n'));

const root = window.document.documentElement;
const pager = window.document.querySelector('.wre-gh-pager');
const read = () => ({ left: pager.style.left, right: pager.style.right });

// 场景 1：无侧栏，卡片 130~1093
SIDEBAR_RIGHT = 0;
VIEWPORT = 1220;
root.classList.remove('wre-gh-sidebar-ok');
window.ghRepositionPager();
const case1 = read();

// 场景 2：侧栏显示（右边缘 248），双栏式卡片从 0 起 → Previous 让到 260
SIDEBAR_RIGHT = 248;
root.classList.add('wre-gh-sidebar-ok');
CARD = { left: 0, right: 1220, width: 1220, top: 0, bottom: 600, height: 600 };
window.ghRepositionPager();
const case2 = read();

// 场景 3：卡片比视口宽 → 两侧钳到 8px
root.classList.remove('wre-gh-sidebar-ok');
CARD = { left: -40, right: 1300, width: 1340, top: 0, bottom: 600, height: 600 };
window.ghRepositionPager();
const case3 = read();

// 场景 4：窄屏 + 宽侧栏，两侧塞不下 → 回退默认（清空内联，走 CSS 的 32px）
SIDEBAR_RIGHT = 248;
root.classList.add('wre-gh-sidebar-ok');
VIEWPORT = 900;
CARD = { left: 300, right: 330, width: 30, top: 0, bottom: 600, height: 600 };
window.ghRepositionPager();
const case4 = read();

const results = [
  { name: '无侧栏 130~1093 / 1220', expect: { left: '130px', right: '127px' }, got: case1 },
  { name: '侧栏 248 + 卡片从 0 起', expect: { left: '260px', right: '8px' }, got: case2 },
  { name: '卡片超出视口', expect: { left: '8px', right: '8px' }, got: case3 },
  { name: '窄屏塞不下 → 回退默认', expect: { left: '', right: '' }, got: case4 },
];

let pass = true;
for (const r of results) {
  const ok = r.got.left === r.expect.left && r.got.right === r.expect.right;
  if (!ok) pass = false;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.name}  期望 ${JSON.stringify(r.expect)}  实际 ${JSON.stringify(r.got)}`);
}
console.log(pass ? '\nPASS' : '\nFAIL');
process.exit(pass ? 0 : 1);
