// 冒烟：按 manifest 顺序把全部 content script 加载进 jsdom，检查有无加载期异常
// （数量不写死：模块数会随版本变，写死只会让注释过期）
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const files = manifest.content_scripts[0].js;

const html = [
  '<!doctype html><html><head><title>t</title></head><body>',
  '<div class="readerTopBar"><span class="readerTopBar_title_link">书</span></div>',
  '<div class="readerContent"><div class="app_content">',
  '<div class="readerChapterContent_container"><div class="readerChapterContent"><p>正文第一段</p></div></div>',
  '</div></div>',
  '<div class="readerControls"><button class="readerControls_item catalog"></button></div>',
  '<div class="readerCatalog" style="display:none"><ul class="readerCatalog_list">',
  ['甲', '乙', '丙', '丁'].map((t) => `<li class="readerCatalog_list_item"><div class="readerCatalog_list_item_inner"><div class="readerCatalog_list_item_info"><div class="readerCatalog_list_item_title"><div class="readerCatalog_list_item_title_text">${t}</div></div></div></div></li>`).join(''),
  '</ul></div>',
  '</body></html>',
].join('');

const dom = new JSDOM(html, {
  pretendToBeVisual: true,
  url: 'https://weread.qq.com/web/reader/a3032ab0813ab8f89g01328ek341323f021e34173cb3824c',
  runScripts: 'outside-only',
});
const { window } = dom;

// --- chrome API stub ---
const store = {};
window.chrome = {
  storage: {
    local: {
      get: (keys) => Promise.resolve(keys.reduce((acc, k) => (k in store ? { ...acc, [k]: store[k] } : acc), {})),
      set: (obj) => { Object.assign(store, obj); return Promise.resolve(); },
    },
    onChanged: { addListener: () => {} },
  },
  runtime: { id: 'test', getURL: (p) => p, sendMessage: () => {} },
};

const errors = [];
window.addEventListener('error', (e) => errors.push(`error: ${e.message}`));
window.onerror = (msg) => { errors.push(`onerror: ${msg}`); };
const origError = window.console.error;
window.console.error = (...args) => { errors.push(`console.error: ${args.map(String).join(' ').slice(0, 200)}`); };

const code = files.map((f) => `\n/* ==== ${f} ==== */\n` + fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
try {
  window.eval(code);
} catch (e) {
  console.log('加载期抛出异常:', e.message);
  errors.push(`throw: ${e.message}`);
}

// init 是 async 的，等一轮微任务/定时器
setTimeout(() => {
  const uniq = [...new Set(errors)];
  if (uniq.length) {
    console.log(`\n发现 ${uniq.length} 条错误（前 8 条）:`);
    uniq.slice(0, 8).forEach((e) => console.log('  -', e));
    process.exit(1);
  }
  console.log('\nOK：' + files.length + ' 个文件按顺序加载无异常，init 已执行');
  console.log('  标题:', window.document.title);
  console.log('  html class:', window.document.documentElement.className);
  process.exit(0); // init 里的轮询定时器会拖着进程不退，跑完就退
}, 1500);
