// 断言：文件头（路径 + 行数 + Copy）只在正文上方真有空白时出现，且不压正文
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const files = manifest.content_scripts[0].js;

const chapters = ['第一章 起', '第二章 承'];
const liHtml = chapters.map((t, i) => `
  <li class="readerCatalog_list_item${i === 1 ? ' readerCatalog_list_item_selected' : ''}">
    <div class="readerCatalog_list_item_inner">
      <div class="readerCatalog_list_item_title">
        <div class="readerCatalog_list_item_title_text">${t}</div>
      </div>
    </div>
  </li>`).join('');

const html = [
  '<!doctype html><html><head><title>微信读书</title></head><body>',
  '<div class="readerTopBar"></div>',
  '<div class="readerContent"><div class="app_content">',
  '<div class="readerChapterContent_container"><div class="readerChapterContent">',
  '<p>第一段正文，足够长以便被当成首行文字。</p>',
  '<p>第二段正文。</p>',
  '</div></div>',
  '</div></div>',
  '<div class="readerControls"><button class="readerControls_item catalog"></button></div>',
  `<div class="readerCatalog" style="display:none"><ul class="readerCatalog_list">${liHtml}</ul></div>`,
  '</body></html>',
].join('');

const dom = new JSDOM(html, {
  pretendToBeVisual: true,
  url: 'https://weread.qq.com/web/reader/a3032ab0813ab8f89g01328ek341323f021e34173cb3824c',
  runScripts: 'outside-only',
});
const { window } = dom;
const doc = window.document;

const store = {};
window.chrome = {
  storage: {
    local: {
      get: (keys) => Promise.resolve(keys.reduce((acc, k) => (k in store ? { ...acc, [k]: store[k] } : acc), {})),
      set: (obj) => { Object.assign(store, obj); return Promise.resolve(); },
    },
    onChanged: { addListener: () => {} },
  },
  runtime: { id: 'test' },
};
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.console.log = () => {};
const errors = [];
window.addEventListener('error', (e) => errors.push(e.message));
window.console.error = (...a) => errors.push('console.error: ' + a.map(String).join(' ').slice(0, 160));

// Range 打桩：jsdom 不做排版，getClientRects 永远空 → 默认走「量不到 = 不显示」这条
let fakeTextTop = null;
const realCreateRange = doc.createRange.bind(doc);
doc.createRange = () => {
  const range = realCreateRange();
  range.selectNodeContents = () => {};
  range.getClientRects = () => (fakeTextTop === null
    ? []
    : [{ width: 420, height: 22, top: fakeTextTop, left: 300, bottom: fakeTextTop + 22, right: 720 }]);
  return range;
};

const code = files.map((f) => `\n/* ==== ${f} ==== */\n` + fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
window.eval(code);

// 剪贴板打桩
const copied = [];
Object.defineProperty(window.navigator, 'clipboard', {
  value: { writeText: async (t) => { copied.push(t); } },
  configurable: true,
});

const results = [];
const check = (name, ok, extra) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const hasFitClass = () => doc.documentElement.classList.contains('wre-gh-filebar-ok');

(async () => {
  await tick(900);

  // 结构
  check('骨架里有文件头', !!doc.querySelector('.wre-gh-filebar'));
  check('文件名跟随当前章', doc.querySelector('.wre-gh-filebar-name')?.textContent === '第二章 承.md',
    doc.querySelector('.wre-gh-filebar-name')?.textContent);
  const meta = doc.querySelector('.wre-gh-filebar-meta')?.textContent || '';
  check('行数文案来自真实正文', /\d+ lines \(\d+ loc\) · [\d.]+ KB/.test(meta), meta);
  check('有 Copy 按钮', !!doc.querySelector('.wre-gh-filebtn[data-copy]'));

  // 量不到排版 → 不显示（fail-safe）
  check('量不到几何时不显示文件头', !hasFitClass(), `class=${doc.documentElement.className}`);

  // 正文上方有 68px 空白（top=200，文件头底边 48+44+40=132）→ 显示
  fakeTextTop = 200;
  window.eval('ghUpdateFilebarFit(true)');
  await tick(30);
  check('有空白时显示文件头', hasFitClass(), 'class 缺失');

  // 贴脸（top=120 < 132+8）→ 隐藏，不能压字
  fakeTextTop = 120;
  window.eval('ghUpdateFilebarFit(true)');
  await tick(30);
  check('空白不足时自动隐藏', !hasFitClass(), '仍然显示 → 会压住首行');

  // 量不到时不能把「放不下」写进缓存（否则文件头永远不出现）
  fakeTextTop = null;
  window.eval('ghUpdateFilebarFit(true)');
  await tick(20);
  fakeTextTop = 260;
  window.eval('ghUpdateFilebarFit()');
  await tick(20);
  check('量不到之后仍能重新量出来', hasFitClass(), '缓存被误写 → 文件头不再出现');

  // Copy：真复制本章正文
  fakeTextTop = null;
  doc.querySelector('.wre-gh-filebtn[data-copy]')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await tick(30);
  check('Copy 复制到剪贴板', copied.length === 1 && /第一段正文/.test(copied[0]), `copied=${copied.length}`);
  check('Copy 后有 toast 反馈', /已复制本章正文/.test(doc.getElementById('wre-gh-toast')?.textContent || ''),
    doc.getElementById('wre-gh-toast')?.textContent);

  // 退出伪装 → 清掉 class，别让侧栏位置残留
  window.eval('ghToggle()');
  check('退出伪装清掉文件头状态', !hasFitClass() && !doc.documentElement.classList.contains('wre-disguise'));

  if (errors.length) {
    console.log('运行期错误:');
    [...new Set(errors)].slice(0, 6).forEach((e) => console.log('  -', e));
  }
  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} 通过${errors.length ? '，' + new Set(errors).size + ' 条错误' : ''}`);
  process.exit(failed || errors.length ? 1 : 0);
})();
