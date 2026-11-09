// 断言：重复加载探针只对「循环刷新」报警，单次手刷不叫；并带上插件派发 resize 的次数
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
  '<div class="readerChapterContent_container"><div class="readerChapterContent"><p>正文</p></div></div>',
  '</div></div>',
  '<div class="readerControls"><button class="readerControls_item catalog"></button></div>',
  '</body></html>',
].join('');

function run({ bootsAgo = [], reflow = 0, prevReflow = 0, hash = '' }) {
  const url = 'https://weread.qq.com/web/reader/a3032ab0813ab8f89g01328ek341323f021e34173cb3824c' + hash;
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

  const now = Date.now();
  window.sessionStorage.setItem('wre-boot-log', JSON.stringify(bootsAgo.map((ms) => now - ms)));
  window.sessionStorage.setItem('wre-reflow-count', String(reflow));
  window.sessionStorage.setItem('wre-prev-reflow', String(prevReflow));

  const warns = [];
  const infos = [];
  window.console.warn = (...a) => warns.push(a.map(String).join(' '));
  window.console.log = (...a) => infos.push(a.map(String).join(' '));
  window.console.error = () => {};
  window.eval(code);
  return { warns, infos, window };
}

const results = [];
const check = (name, ok, extra) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

// A. 15 秒内第 3 次启动 → 报警
const a = run({ bootsAgo: [2000, 1000] });
const aWarn = a.warns.find((m) => m.includes('15 秒内页面被重复加载'));
check('3 次连续启动触发报警', !!aWarn, aWarn ? 'found' : JSON.stringify(a.warns));
check('报警带 count=3', !!aWarn && aWarn.includes('"count":3'), aWarn);

// B. 用户截图那种：单次手刷，间隔 4.5 秒 → 不报警
const b = run({ bootsAgo: [4500], hash: '#wre-debug' });
check('单次 4.5 秒后重载不报警', !b.warns.some((m) => m.includes('重复加载')), JSON.stringify(b.warns));
check('改为静默记录启动探针', b.infos.some((m) => m.includes('启动探针')), 'info 缺失');

// C. 带「自上次重载以来派发了几次 resize」：都为 5 → 0 次
const c = run({ bootsAgo: [2000, 1000], reflow: 5, prevReflow: 5 });
const cWarn = c.warns.find((m) => m.includes('15 秒内页面被重复加载'));
check('能区分「不是插件刷的」（reflowSincePrevBoot=0）', !!cWarn && cWarn.includes('"reflowSincePrevBoot":0'), cWarn);

// D. 插件确实派发过 resize → 计数可见
const d = run({ bootsAgo: [2000, 1000], reflow: 9, prevReflow: 5 });
const dWarn = d.warns.find((m) => m.includes('15 秒内页面被重复加载'));
check('插件派发过 resize 时计数为 4', !!dWarn && dWarn.includes('"reflowSincePrevBoot":4'), dWarn);

// E. 1.5 秒内的快速重载也报警（人手来不及）
const e = run({ bootsAgo: [900] });
check('1.5 秒内再次加载报警', e.warns.some((m) => m.includes('1.5 秒内被再次加载')), JSON.stringify(e.warns));

// F. 派发计数写进 sessionStorage（跨 reload 承接）
const f = run({});
f.window.dispatchEvent(new f.window.Event('resize'));
check('reflow 计数跨启动保留', f.window.sessionStorage.getItem('wre-reflow-count') !== null,
  f.window.sessionStorage.getItem('wre-reflow-count'));

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed ? 1 : 0);
