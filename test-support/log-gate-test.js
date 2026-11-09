// 断言：info 日志默认静默，#wre-debug 后恢复；warn/error 始终输出
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const files = manifest.content_scripts[0].js;
const code = files.map((f) => `\n/* ==== ${f} ==== */\n` + fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');

const html = [
  '<!doctype html><html><head><title>t</title></head><body>',
  '<div class="readerTopBar"></div>',
  '<div class="readerContent"><div class="app_content">',
  '<div class="readerChapterContent_container"><div class="readerChapterContent"><p>正文第一段</p></div></div>',
  '</div></div>',
  '<div class="readerControls"><button class="readerControls_item catalog"></button></div>',
  '</body></html>',
].join('');

function run(url) {
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
  const counts = { log: 0, warn: 0, error: 0 };
  window.console.log = () => { counts.log += 1; };
  window.console.warn = () => { counts.warn += 1; };
  window.console.error = () => { counts.error += 1; };
  window.eval(code);
  return new Promise((resolve) => setTimeout(() => resolve(counts), 1600));
}

const base = 'https://weread.qq.com/web/reader/a3032ab0813ab8f89g01328ek341323f021e34173cb3824c';
const results = [];
const check = (name, ok, extra) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

(async () => {
  const quiet = await run(base);
  check('默认静默：info 一条不打', quiet.log === 0, JSON.stringify(quiet));
  check('默认仍报 warn', quiet.warn > 0, `warn=${quiet.warn}`);

  const loud = await run(`${base}#wre-debug`);
  check('#wre-debug 后 info 恢复', loud.log > 5, `log=${loud.log}`);

  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} 通过`);
  process.exit(failed ? 1 : 0);
})();
