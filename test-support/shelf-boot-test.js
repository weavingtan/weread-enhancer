// 断言：书城 / 书架页不再做屏占比恢复（不轮询 20s、不兜底写入、不报「未能初始化」）
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const files = manifest.content_scripts[0].js;
const code = files.map((f) => `\n/* ==== ${f} ==== */\n` + fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');

const results = [];
const check = (name, ok, extra) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

async function run(url) {
  const html = '<!doctype html><html><head><title>t</title></head><body><div id="root"></div></body></html>';
  const dom = new JSDOM(html, { pretendToBeVisual: true, url, runScripts: 'outside-only' });
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
  const warns = [];
  window.console.warn = (...a) => warns.push(a.map(String).join(' '));
  window.console.log = () => {};
  window.console.error = (...a) => warns.push('ERROR ' + a.map(String).join(' '));
  window.eval(code);
  // init 里的轮询是 400ms × 50，这里不等它跑完：1.6s 内就该看到「跳过」而不是兜底
  await new Promise((r) => setTimeout(r, 1600));
  return { doc: window.document, warns };
}

(async () => {
  const shelf = await run('https://weread.qq.com/web/shelf');
  check('书架页不做屏占比兜底', !shelf.warns.some((m) => m.includes('刷新后未判定就绪')), JSON.stringify(shelf.warns.slice(0, 4)));
  check('书架页不报「未能初始化 screenBasePx」', !shelf.warns.some((m) => m.includes('screenBasePx')), '仍有 warn');
  check('书架页不写屏占比样式', (shelf.doc.getElementById('we-read-enhancer-style')?.textContent || '') === '',
    (shelf.doc.getElementById('we-read-enhancer-style')?.textContent || '').slice(0, 60));

  // 对照组：阅读页 URL 下行为不变（样式会写入；这里 ratio 默认 100，CSS 可能为空串，所以看签名相关副作用）
  const reader = await run('https://weread.qq.com/web/reader/a3032ab0813ab8f89g01328ek341323f021e34173cb3824c');
  check('阅读页仍走正常初始化（无 shelf 跳过日志）', !reader.warns.some((m) => m.includes('非阅读页')), '误判成书架');

  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} 通过`);
  process.exit(failed ? 1 : 0);
})();
