// 断言：伪装态顶栏头像能打开设置面板，面板里带伪装开关与皮肤切换
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
window.console.error = (...args) => { errors.push(`console.error: ${args.map(String).join(' ').slice(0, 200)}`); };
window.console.log = () => {}; // 静音，输出只看断言

const code = files.map((f) => `\n/* ==== ${f} ==== */\n` + fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
try {
  window.eval(code);
} catch (e) {
  errors.push(`throw: ${e.message}`);
}

const results = [];
const check = (name, ok, extra) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

setTimeout(() => {
  const doc = window.document;
  const avatar = doc.querySelector('.wre-gh-avatar');
  check('骨架里有头像', !!avatar);

  const modal = doc.getElementById('wre-read-settings-modal');
  check('设置面板存在', !!modal);
  check('初始未展开', modal && !modal.classList.contains('wre-visible'));

  // 点头像
  avatar?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  check('点头像后展开', !!(modal && modal.classList.contains('wre-visible')));

  // 面板里的伪装 / 皮肤控件
  const disguiseBtn = doc.getElementById('wre-disguise-toggle');
  const skinBtns = doc.querySelectorAll('#wre-skin-toggle button[data-skin]');
  check('面板有伪装开关', !!disguiseBtn, disguiseBtn ? disguiseBtn.textContent.trim() : '');
  check('面板有 2 个皮肤按钮', skinBtns.length === 2, `count=${skinBtns.length}`);
  check('GitHub 被标为当前皮肤', /wre-theme-active/.test(skinBtns[0]?.className || ''), skinBtns[0]?.className);
  check('伪装开关是开启态', /wre-toggle-on/.test(disguiseBtn?.className || ''), disguiseBtn?.className);

  // 点“伪装开关”→ 退出伪装
  disguiseBtn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const root = doc.documentElement;
  check('退出伪装：html 无 wre-disguise', !root.classList.contains('wre-disguise'), root.className);
  check('退出伪装：按钮文案已更新', /点击进入/.test(doc.getElementById('wre-disguise-toggle-text')?.textContent || ''),
    doc.getElementById('wre-disguise-toggle-text')?.textContent);
  check('退出伪装：按钮不再是开启态', !/wre-toggle-on/.test(doc.getElementById('wre-disguise-toggle')?.className || ''));

  // 再点回来
  doc.getElementById('wre-disguise-toggle')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  check('重新进入伪装', doc.documentElement.classList.contains('wre-disguise'));

  // 切 Notion 皮肤
  const notionBtn = doc.querySelector('#wre-skin-toggle button[data-skin="notion"]');
  notionBtn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  check('切皮肤：html data-wre-skin 变了', doc.documentElement.dataset.wreSkin === 'notion', doc.documentElement.dataset.wreSkin);
  check('切皮肤：Notion 被标为当前', /wre-theme-active/.test(doc.querySelector('#wre-skin-toggle button[data-skin="notion"]')?.className || ''));
  check('切皮肤：标题跟着换', /Acme/.test(doc.title), doc.title);
  check('切皮肤：骨架重建（侧栏变成 notion 树）', !!doc.querySelector('.wre-nb-tree'), true);

  const uniq = [...new Set(errors)];
  if (uniq.length) {
    console.log('运行期错误:');
    uniq.slice(0, 8).forEach((e) => console.log('  -', e));
  }
  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} 通过${uniq.length ? '，另有 ' + uniq.length + ' 条运行期错误' : ''}`);
  process.exit(failed || uniq.length ? 1 : 0);
}, 1800);
