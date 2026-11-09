// 断言：皮肤注册表——两套皮肤能力对等（都渲染真目录、都能点、身份都对）
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
  '<!doctype html><html><head><title>微信读书</title></head><body>',
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

const jumps = [];
window.__jumps = jumps;
window.eval('window.ghJumpToCatalogEntry = async (el, label) => { window.__jumps.push(label); return { ok: true, report: [] }; };');

const results = [];
const check = (name, ok, extra) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = (sel) => Array.from(doc.querySelectorAll(sel));

(async () => {
  await tick(900);

  // 注册表
  check('注册表有 2 套皮肤', window.eval('wreSkinList().length') === 2);
  check('当前 profile 是 github', window.eval('wreSkinProfile().id') === 'github');

  // GitHub：真目录
  const ghRows = rows('.wre-gh-tree .wre-tree-row');
  check('GitHub 树渲染真章节 4 行', ghRows.length === 4, `rows=${ghRows.length}`);
  check('GitHub 当前章高亮', /wre-gh-tree-active/.test(ghRows[1]?.className || ''), ghRows[1]?.className);
  check('GitHub 行显示 .md 文件名', /承\.md/.test(ghRows[1]?.textContent || ''), ghRows[1]?.textContent?.trim());

  ghRows[2]?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await tick(30);
  check('GitHub 点目录行能跳章', jumps[0] === '第三章 转', JSON.stringify(jumps));

  // 切 Notion
  window.eval('setDisguiseSkin("notion")');
  await tick(50);
  const nbRows = rows('.wre-nb-tree .wre-tree-row');
  check('Notion 树也是真章节（不再是 8 个假文档）', nbRows.length === 4, `rows=${nbRows.length}`);
  check('Notion 当前章高亮', /wre-nb-tree-active/.test(nbRows[1]?.className || ''), nbRows[1]?.className);
  check('Notion 行不带 .md', !/\.md/.test(nbRows[1]?.textContent || ''), nbRows[1]?.textContent?.trim());
  check('Notion 标题换成页面名', doc.title === '第二章 承 · Acme 团队', doc.title);
  check('Notion 面包屑换成页面名', doc.querySelector('.wre-nb-crumb')?.textContent === '第二章 承',
    doc.querySelector('.wre-nb-crumb')?.textContent);

  jumps.length = 0;
  nbRows[0]?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await tick(30);
  check('Notion 点目录行能跳章', jumps[0] === '第一章 起', JSON.stringify(jumps));

  // 切回 GitHub：chip / 标题都回来
  window.eval('setDisguiseSkin("github")');
  await tick(50);
  check('切回 GitHub 后 chip 正常', doc.querySelector('.wre-gh-file-chip-label')?.textContent === '第二章 承.md',
    doc.querySelector('.wre-gh-file-chip-label')?.textContent);
  check('切回 GitHub 后标题正常', doc.title === '第二章 承.md at main · dev-lab/notes', doc.title);
  check('切回后 GitHub 树回来', rows('.wre-gh-tree .wre-tree-row').length === 4);

  // 面板里的皮肤按钮由注册表生成
  const btns = rows('#wre-skin-toggle button[data-skin]');
  check('设置面板皮肤按钮由注册表生成', btns.length === 2 && btns[0].textContent === 'GitHub' && btns[1].textContent === 'Notion',
    btns.map((b) => b.textContent).join('/'));

  if (errors.length) {
    console.log('运行期错误:');
    [...new Set(errors)].slice(0, 6).forEach((e) => console.log('  -', e));
  }
  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} 通过${errors.length ? '，' + new Set(errors).size + ' 条错误' : ''}`);
  process.exit(failed || errors.length ? 1 : 0);
})();
