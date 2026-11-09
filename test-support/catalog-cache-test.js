// 验证：目录采集走缓存（结构/高亮变化才重采）；原生翻页按钮按文本节点找并隐藏
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const files = manifest.content_scripts[0].js;

const rows = ['第一章', '第二章', '第三章', '第四章']
  .map((t) => `<li class="readerCatalog_list_item"><div class="readerCatalog_list_item_inner">`
    + `<div class="readerCatalog_list_item_title_text">${t}</div></div></li>`)
  .join('');

const dom = new JSDOM(
  '<!doctype html><html><body>'
  + `<div class="readerCatalog"><ul class="readerCatalog_list">${rows}</ul></div>`
  + '<div class="readerContent"><div class="readerChapterContent_container">'
  + '<button class="readerControls_item"><span>下一页</span></button>'
  + '<p>正文内容</p>'
  + '</div></div>'
  + '</body></html>',
  { url: 'https://weread.qq.com/web/reader/x', runScripts: 'outside-only', pretendToBeVisual: true },
);
const { window } = dom;
const store = {};
window.chrome = {
  storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() }, onChanged: { addListener: () => {} } },
  runtime: { id: 't', getURL: (p) => p, sendMessage: () => {} },
};
window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });

window.eval(files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n'));

const doc = window.document;
const tick = () => new Promise((r) => setTimeout(r, 0));
const results = [];

(async () => {
  // --- 采集缓存 ---
  const a = window.ghCollectCatalogItems();
  const b = window.ghCollectCatalogItems();
  results.push({ name: '未变化时返回同一数组（命中缓存）', ok: a === b && a.length === 4, got: `same=${a === b}, len=${a.length}` });

  // 加一章 → 观察器置脏 → 重新采集
  const li = doc.createElement('li');
  li.className = 'readerCatalog_list_item';
  li.innerHTML = '<div class="readerCatalog_list_item_title_text">第五章</div>';
  doc.querySelector('.readerCatalog_list').appendChild(li);
  await tick();
  const c = window.ghCollectCatalogItems();
  results.push({ name: '目录新增章节后重采', ok: c !== a && c.length === 5, got: `same=${c === a}, len=${c.length}` });

  // 只改当前章 class → 也要置脏（高亮行变了）
  doc.querySelector('.readerCatalog_list_item').classList.add('active');
  await tick();
  const d = window.ghCollectCatalogItems();
  results.push({ name: '当前章高亮变化后重采', ok: d !== c && d.length === 5, got: `same=${d === c}, len=${d.length}` });

  // --- 原生翻页按钮隐藏 ---
  window.ghHideNativePager();
  const btn = doc.querySelector('.readerControls_item');
  const hidden = btn.dataset.wreHidden === '1' && /none/.test(btn.style.display);
  results.push({ name: '隐藏原生「下一页」按钮', ok: hidden, got: `dataset=${btn.dataset.wreHidden}, display=${btn.style.display}` });

  let pass = true;
  for (const r of results) {
    if (!r.ok) pass = false;
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.got})`);
  }
  console.log(pass ? '\nPASS' : '\nFAIL');
  process.exit(pass ? 0 : 1);
})();
