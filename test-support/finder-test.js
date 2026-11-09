// 断言：章节查找器（/ 或 t）、j/k 翻章、非伪装态不生效
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const files = manifest.content_scripts[0].js;

const chapters = ['第一章 起', '第二章 承', '第三章 转', '第四章 合'];
const liHtml = chapters.map((t, i) => `
  <li class="readerCatalog_list_item${i === 1 ? ' readerCatalog_list_item_selected' : ''}">
    <div class="readerCatalog_list_item_inner">
      <div class="readerCatalog_list_item_title">
        <div class="readerCatalog_list_item_title_text">${t}</div>
      </div>
    </div>
  </li>`).join('');

const html = [
  '<!doctype html><html><head><title>t</title></head><body>',
  '<div class="readerTopBar"></div>',
  '<div class="readerContent"><div class="app_content">',
  '<div class="readerChapterContent_container"><div class="readerChapterContent"><p>正文</p></div></div>',
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

const code = files.map((f) => `\n/* ==== ${f} ==== */\n` + fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
window.eval(code);

// 跳章函数打桩：只记录点到了哪一章，真跳章依赖微信读书目录面板，jsdom 里做不到
const jumps = [];
window.eval('window.ghJumpToCatalogEntry = async (el, label) => { window.__jumps.push(label); return { ok: true, report: [] }; };');
window.__jumps = jumps;

const results = [];
const check = (name, ok, extra) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await tick(900);

  // 1. 打开 / 列全
  const opened = window.eval('ghOpenFinder()');
  check('伪装态 / 能打开查找器', opened === true);
  let finder = doc.getElementById('wre-gh-finder');
  check('浮层可见', !!finder && finder.classList.contains('wre-visible'));
  let rows = () => Array.from(doc.querySelectorAll('.wre-gh-finder-row'));
  check('列出全部 4 章', rows().length === 4, `rows=${rows().length}`);
  check('首行默认高亮', /wre-gh-finder-active/.test(rows()[0]?.className || ''));
  check('文件名带 .md', /起\.md$/.test(rows()[0]?.querySelector('.wre-gh-finder-name')?.textContent || ''),
    rows()[0]?.querySelector('.wre-gh-finder-name')?.textContent);

  // 2. 过滤
  const input = doc.getElementById('wre-gh-finder-input');
  input.value = '转';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  check('输入「转」只剩 1 条', rows().length === 1, `rows=${rows().length}`);
  check('计数文案更新', /1 result/.test(doc.getElementById('wre-gh-finder-count')?.textContent || ''),
    doc.getElementById('wre-gh-finder-count')?.textContent);

  // 3. Enter 跳章
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await tick(30);
  check('Enter 跳到第三章', jumps[0] === '第三章 转', JSON.stringify(jumps));
  check('跳章后浮层关闭', !finder.classList.contains('wre-visible'));

  // 4. Esc 关闭
  window.eval('ghOpenFinder()');
  doc.getElementById('wre-gh-finder-input').dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  check('Esc 关闭浮层', !doc.getElementById('wre-gh-finder').classList.contains('wre-visible'));

  // 5. 点顶栏假搜索框打开
  doc.querySelector('.wre-gh-search')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  check('点假搜索框打开查找器', doc.getElementById('wre-gh-finder').classList.contains('wre-visible'));
  window.eval('ghCloseFinder()');

  // 6. j / k 翻章（当前章 = 第二章，j → 第三章，k → 第一章）
  jumps.length = 0;
  await window.eval('ghStepChapter(1)');
  await tick(20);
  check('j 跳到下一章', jumps[0] === '第三章 转', JSON.stringify(jumps));
  await window.eval('ghStepChapter(-1)');
  await tick(20);
  check('k 跳到上一章', jumps[1] === '第一章 起', JSON.stringify(jumps));

  // 7. 关伪装后不生效
  window.eval('ghToggle()');
  const openedOff = window.eval('ghOpenFinder()');
  check('非伪装态打不开查找器', openedOff === false, String(openedOff));
  const moved = await window.eval('ghStepChapter(1)');
  check('非伪装态 j/k 不动', moved === false, String(moved));

  if (errors.length) {
    console.log('运行期错误:');
    [...new Set(errors)].slice(0, 6).forEach((e) => console.log('  -', e));
  }
  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} 通过${errors.length ? '，' + new Set(errors).size + ' 条错误' : ''}`);
  process.exit(failed || errors.length ? 1 : 0);
})();
