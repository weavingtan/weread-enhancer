// 断言：当前章 → 窗口标题 / file chip / Notion 面包屑三处一致，并跟随切章
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const files = manifest.content_scripts[0].js;

const chapters = ['第一章 起', '第二章 承', '第三章 转'];
const liHtml = chapters.map((t, i) => `
  <li class="readerCatalog_list_item${i === 1 ? ' readerCatalog_list_item_selected' : ''}">
    <div class="readerCatalog_list_item_inner">
      <div class="readerCatalog_list_item_title">
        <div class="readerCatalog_list_item_title_text">${t}</div>
      </div>
    </div>
  </li>`).join('');

const html = [
  '<!doctype html><html><head><title>微信读书 - 某本书</title></head><body>',
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

  const chip = () => doc.querySelector('.wre-gh-file-chip-label')?.textContent || '';
  check('标题用当前章文件名', doc.title === '第二章 承.md at main · dev-lab/notes', doc.title);
  check('file chip 用当前章文件名', chip() === '第二章 承.md', chip());
  check('chip 里带文件图标', !!doc.querySelector('.wre-gh-file-chip .wre-gh-ico'));

  // 切到第三章（模拟微信读书改选中项）
  doc.querySelector('.readerCatalog_list_item_selected')?.classList.remove('readerCatalog_list_item_selected');
  doc.querySelectorAll('.readerCatalog_list_item')[2].classList.add('readerCatalog_list_item_selected');
  window.eval('ghCatalogInvalidate(); ghSyncChrome(true);');
  await tick(30);
  check('切章后标题跟着变', doc.title === '第三章 转.md at main · dev-lab/notes', doc.title);
  check('切章后 chip 跟着变', chip() === '第三章 转.md', chip());

  // Notion 皮肤：标题 / 面包屑换成章名，不带 .md
  window.eval('setDisguiseSkin("notion")');
  await tick(30);
  check('Notion 标题 = 章名 · 团队', doc.title === '第三章 转 · Acme 团队', doc.title);
  check('Notion 面包屑换成章名', doc.querySelector('.wre-nb-crumb')?.textContent === '第三章 转',
    doc.querySelector('.wre-nb-crumb')?.textContent);

  // 关伪装 → 标题还原；再开 → 回到章名
  window.eval('ghToggle()');
  check('退出伪装后标题还原', doc.title === '微信读书 - 某本书', doc.title);
  window.eval('ghToggle()');
  await tick(30);
  check('重新伪装后标题回到章名', doc.title === '第三章 转 · Acme 团队', doc.title);

  if (errors.length) {
    console.log('运行期错误:');
    [...new Set(errors)].slice(0, 6).forEach((e) => console.log('  -', e));
  }
  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} 通过${errors.length ? '，' + new Set(errors).size + ' 条错误' : ''}`);
  process.exit(failed || errors.length ? 1 : 0);
})();
