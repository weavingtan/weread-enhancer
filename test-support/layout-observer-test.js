// 断言：1s 轮询已删（无 1000ms interval）；ResizeObserver 接管；canvas 出现后探针自停；关伪装时观察器断开
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const files = manifest.content_scripts[0].js;

const html = [
  '<!doctype html><html><head><title>t</title></head><body>',
  '<div class="readerTopBar"></div>',
  '<div class="readerContent"><div class="app_content">',
  '<div class="readerChapterContent_container"><div class="readerChapterContent"><p>正文第一段</p></div></div>',
  '</div></div>',
  '<div class="readerControls"><button class="readerControls_item catalog"></button></div>',
  '</body></html>',
].join('');

const dom = new JSDOM(html, {
  pretendToBeVisual: true,
  url: 'https://weread.qq.com/web/reader/a3032ab0813ab8f89g01328ek341323f021e34173cb3824c',
  runScripts: 'outside-only',
});
const { window } = dom;
const doc = window.document;

// chrome stub
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

// ResizeObserver 打桩
const roInstances = [];
class FakeRO {
  constructor(cb) {
    this.cb = cb;
    this.targets = new Set();
    this.disconnected = false;
    roInstances.push(this);
  }
  observe(el) { this.targets.add(el); }
  unobserve(el) { this.targets.delete(el); }
  disconnect() { this.disconnected = true; this.targets.clear(); }
}
window.ResizeObserver = FakeRO;

// interval 打桩：记录毫秒数与回调，供手动触发
const timers = [];
window.setInterval = (fn, ms) => {
  const id = 1000 + timers.length;
  timers.push({ id, ms, fn });
  return id;
};
window.clearInterval = (id) => {
  const t = timers.find((x) => x.id === id);
  if (t) t.cleared = true;
};

const errors = [];
window.addEventListener('error', (e) => errors.push(e.message));
window.console.error = (...a) => errors.push('console.error: ' + a.map(String).join(' ').slice(0, 160));
window.console.log = () => {};

const code = files.map((f) => `\n/* ==== ${f} ==== */\n` + fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
window.eval(code);

const results = [];
const check = (name, ok, extra) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

setTimeout(() => {
  const ro = roInstances[0];
  check('创建了 ResizeObserver', roInstances.length === 1, `count=${roInstances.length}`);
  check('观察目标 ≥ 3（html / 正文 / app_content）', !!ro && ro.targets.size >= 3, `targets=${ro && ro.targets.size}`);
  check('观察了 documentElement', !!ro && ro.targets.has(doc.documentElement));
  check('观察了正文 .readerChapterContent', !!ro && ro.targets.has(doc.querySelector('.readerChapterContent')));

  const delays = timers.map((t) => t.ms);
  check('没有 1s 轮询', !delays.includes(1000), `delays=[${delays.join(',')}]`);
  check('有 2s canvas 探针', delays.includes(2000), `delays=[${delays.join(',')}]`);

  // 模拟切双栏：canvas 出现 → 探针应挂上观察并自停
  const holder = doc.createElement('div');
  holder.className = 'wr_canvasContainer';
  const canvas = doc.createElement('canvas');
  holder.appendChild(canvas);
  doc.body.appendChild(holder);
  const probe = timers.filter((t) => t.ms === 2000 && !t.cleared);
  probe.forEach((t) => t.fn());
  check('canvas 出现后被观察', ro.targets.has(canvas), `targets=${ro.targets.size}`);
  check('观察到 canvas 后探针停表', timers.filter((t) => t.ms === 2000).every((t) => t.cleared),
    JSON.stringify(timers.filter((t) => t.ms === 2000).map((t) => !!t.cleared)));

  // 关伪装 → 观察器断开
  window.eval('ghToggle()');
  check('退出伪装后观察器断开', ro.disconnected === true, `disconnected=${ro.disconnected}`);

  if (errors.length) {
    console.log('运行期错误:');
    [...new Set(errors)].slice(0, 6).forEach((e) => console.log('  -', e));
  }
  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} 通过${errors.length ? '，' + new Set(errors).size + ' 条错误' : ''}`);
  process.exit(failed || errors.length ? 1 : 0);
}, 1600);
