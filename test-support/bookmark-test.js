// 断言：目录行 meta 里的「书签」被标成侧栏树里的 ⭐；
// ① 章节名自己含「书签」不误标；② 目录项 <3 时走 raw 兜底分支仍能识别书签
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const files = manifest.content_scripts[0].js;
const code = files.map((f) => `\n/* ==== ${f} ==== */\n` + fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');

const results = [];
const check = (name, ok, extra) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

function makeDom(liHtml) {
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
  window.console.error = () => {};
  window.eval(code);
  return dom;
}

(async () => {
  // 场景①：主路径（有 _title_text 节点）—— 第一章带 meta 书签、第三章标题叫「谈书签」
  const titled = [
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

  {
    const dom = makeDom(titled);
    const doc = dom.window.document;
    await tick(900);
    const rows = Array.from(doc.querySelectorAll('.wre-gh-tree-item'));
    check('主路径渲染 3 行', rows.length === 3, `rows=${rows.length}`);
    check('主路径：有书签的章带 ⭐', !!rows[0]?.querySelector('.wre-gh-tree-star'), '无 ⭐');
    check('主路径：无书签章不带 ⭐', !rows[1]?.querySelector('.wre-gh-tree-star'), '误标');
    check('主路径：标题含「书签」不误标', !rows[2]?.querySelector('.wre-gh-tree-star'), '误标');
  }

  // 场景②：raw 兜底分支（3 个 li 但都没有 _title_text，触发 ghCollectCatalogItems 的兜底）
  const raw = ['第一章 起', '第二章 承', '第三章 转'].map((t, i) => `
    <li class="readerCatalog_list_item">
      <span>${t}</span>
      ${i === 0 ? '<span>书签</span>' : ''}
    </li>`).join('');
  {
    const dom = makeDom(raw);
    const doc = dom.window.document;
    await tick(900);
    const rows = Array.from(doc.querySelectorAll('.wre-gh-tree-item'));
    check('兜底路径渲染 3 行', rows.length === 3, `rows=${rows.length}`);
    check('兜底路径：书签仍被识别', !!rows[0]?.querySelector('.wre-gh-tree-star'), '无 ⭐');
    check('兜底路径：无书签章不带 ⭐', !rows[1]?.querySelector('.wre-gh-tree-star'), '误标');
  }

  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} 通过`);
  process.exit(failed ? 1 : 0);
})();
