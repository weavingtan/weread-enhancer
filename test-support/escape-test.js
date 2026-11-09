// 验证章节名拼进 innerHTML 前已转义
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const files = manifest.content_scripts[0].js;

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://weread.qq.com/web/reader/x', runScripts: 'outside-only' });
const { window } = dom;
const store = {};
window.chrome = {
  storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() }, onChanged: { addListener: () => {} } },
  runtime: { id: 't', getURL: (p) => p, sendMessage: () => {} },
};
window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });

window.eval(files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n'));

const raw = '<img src=x onerror=alert(1)> "引号" & 符号';
const out = window.ghEscapeHtml(raw);
const expect = '&lt;img src=x onerror=alert(1)&gt; &quot;引号&quot; &amp; 符号';
const ok = out === expect && !out.includes('<');
console.log('输入:', raw);
console.log('输出:', out);
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
