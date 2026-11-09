// 断言：目录行 meta 里的「书签」被标成侧栏树里的 ⭐；章节名自己含「书签」不误标
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const files = manifest.content_scripts[0].js;

// 第一章：行内带 meta「书签」→ 应标 ⭐；第三章：标题本身叫「谈书签」但没有 meta → 不标
const liHtml = [
  { t: '第一章 起', meta: '<span class="readerCatalog_list_item_bookmark">书签</span>' },
  { t: '第二章 承', meta: '' },
  { t: '谈书签的方法', meta: '' },
].map((c, i) => `
  <li class="readerCatalog_list_item${i === 1 ? ' readerCatalog_list_item_selected' : ''}">
    <div class="readerCatalog_list_item_inner">
      <div class="readerCatalog_list_item_title">
        <div class="readerCatalog_list_item_title_text">${c.t}</div>
      </div>
      ${c.meta}
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

const results = [];
const check = (name, ok, extra) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await tick(900);

  const ghRows = Array.from(doc.querySelectorAll('.wre-gh-tree-item'));
  check('GitHub 树渲染 3 行', ghRows.length === 3, `rows=${ghRows.length}`);
  check('第一章（有 meta 书签）带 ⭐', !!ghRows[0]?.querySelector('.wre-gh-tree-star'), '无 ⭐');
  check('第二章（无书签）不带 ⭐', !ghRows[1]?.querySelector('.wre-gh-tree-star'), '误标');
  check('第三章标题含「书签」但不带 ⭐（不误判）', !ghRows[2]?.querySelector('.wre-gh-tree-star'), '误标');

  // Notion 皮肤同样标 ⭐
  window.eval('setDisguiseSkin("notion")');
  await tick(50);
  const nbRows = Array.from(doc.querySelectorAll('.wre-nb-tree-item'));
  check('Notion 树同样渲染 3 行', nbRows.length === 3, `rows=${nbRows.length}`);
  check('Notion 第一章带 ⭐', !!nbRows[0]?.querySelector('.wre-nb-tree-star'), '无 ⭐');
  check('Notion 标题含「书签」的章不误标', !nbRows[2]?.querySelector('.wre-nb-tree-star'), '误标');

  if (errors.length) {
    console.log('运行期错误:');
    [...new Set(errors)].slice(0, 6).forEach((e) => console.log('  -', e));
  }
  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} 通过${errors.length ? '，' + new Set(errors).size + ' 条错误' : ''}`);
  process.exit(failed || errors.length ? 1 : 0);
})();
