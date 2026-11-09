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
  narrow: root.classList.contains('wre-gh-sidebar-narrow'),
});

const results = [];

// 场景 1：字在 150 → 留白 140，侧栏 140px，不压字（常规档）
window.ghSyncSidebarFits();
results.push({ name: '字在 150（容器 60）', expect: { ok: true, w: '140px', narrow: false }, got: read() });

// 场景 2：字在 110 → 留白 100，进入极窄档（<120），侧栏 100px
TEXT_LEFT = 110;
window.ghSyncSidebarFits();
results.push({ name: '字在 110（极窄档）', expect: { ok: true, w: '100px', narrow: true }, got: read() });

// 场景 3：字在 60 → 留白 50 < 72，太窄不显示
TEXT_LEFT = 60;
window.ghSyncSidebarFits();
results.push({ name: '字在 60（过窄隐藏）', expect: { ok: false, w: '', narrow: false }, got: read() });

// 场景 4：字在 900（正文被推到很右）→ 宽度封顶 248
TEXT_LEFT = 900;
window.ghSyncSidebarFits();
results.push({ name: '字在 900（封顶）', expect: { ok: true, w: '248px', narrow: false }, got: read() });

// 场景 5：暂态量空（正文还没渲染）→ 先隐藏并排 500ms 重试；内容恢复后自愈显示
const origRects = window.Range.prototype.getClientRects;
const origRect = window.Element.prototype.getBoundingClientRect;
window.Range.prototype.getClientRects = () => [];
window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
};
window.ghSyncSidebarFits();
results.push({ name: '暂态量空（隐藏）', expect: { ok: false, w: '', narrow: false }, got: read() });
// 内容渲染好了：恢复 mock，等重试定时器跑完
window.Range.prototype.getClientRects = origRects;
window.Element.prototype.getBoundingClientRect = origRect;
TEXT_LEFT = 150;

function finish() {
  // 500ms 重试已经跑过：侧栏应已自愈显示。此刻才 read，补上「自愈」这条真正要验的路径。
  results.push({ name: '暂态量空（自愈显示）', expect: { ok: true, w: '140px', narrow: false }, got: read() });
  let pass = true;
  for (const r of results) {
    const ok = r.got.ok === r.expect.ok && r.got.w === r.expect.w && r.got.narrow === r.expect.narrow;
    if (!ok) pass = false;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.name}  期望 ${JSON.stringify(r.expect)}  实际 ${JSON.stringify(r.got)}`);
  }
  console.log(pass ? '\nPASS' : '\nFAIL');
  process.exit(pass ? 0 : 1);
}

setTimeout(finish, 700);
