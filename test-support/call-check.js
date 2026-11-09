// 静态审查：调用了但没有任何模块定义的函数（拆分/搬运后最容易漏的就是这种）
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const files = manifest.content_scripts[0].js;

const BROWSER_GLOBALS = new Set([
  'window', 'document', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask', 'fetch', 'structuredClone',
  'getComputedStyle', 'matchMedia', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
  'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'Event', 'CustomEvent', 'NodeFilter', 'Node',
  'Element', 'HTMLElement', 'Range', 'DOMParser', 'XMLHttpRequest', 'URL', 'URLSearchParams',
  'Blob', 'FileReader', 'Image', 'Audio', 'Number', 'String', 'Boolean', 'Array', 'Object', 'Math',
  'JSON', 'Date', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'RegExp', 'Error',
  'TypeError', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'alert', 'confirm', 'prompt', 'chrome', 'performance', 'sessionStorage', 'localStorage', 'atob', 'btoa',
  'CSS', 'Intl', 'Proxy', 'Reflect', 'BigInt', 'Uint8ClampedArray', 'Uint8Array', 'Float32Array',
  'DeviceOrientationEvent', 'IntersectionObserverEntry', 'gesture', 'webkitRequestAnimationFrame',
]);

function walk(node, cb) {
  if (!node || typeof node.type !== 'string') return;
  cb(node);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, cb));
    else if (v && typeof v.type === 'string') walk(v, cb);
  }
}

const declared = new Set();
const calls = new Map(); // name -> [file:line]

const asts = files.map((f) => {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  return { file: f, ast: acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', locations: true }) };
});

// 先收集所有声明（含函数内声明，宽松一点，减少误报）
asts.forEach(({ ast }) => {
  walk(ast, (n) => {
    if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') {
      if (n.id) declared.add(n.id.name);
      (n.params || []).forEach((p) => { if (p.type === 'Identifier') declared.add(p.name); });
    }
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier') declared.add(n.id.name);
    if (n.type === 'ClassDeclaration' && n.id) declared.add(n.id.name);
    if (n.type === 'CatchClause' && n.param && n.param.type === 'Identifier') declared.add(n.param.name);
  });
});

// 再找调用点
asts.forEach(({ file, ast }) => {
  walk(ast, (n) => {
    if (n.type !== 'CallExpression') return;
    const callee = n.callee;
    if (callee.type !== 'Identifier') return;
    const name = callee.name;
    if (!calls.has(name)) calls.set(name, []);
    calls.get(name).push(`${file}:${n.loc.start.line}`);
  });
});

const missing = [];
for (const [name, where] of calls) {
  if (declared.has(name) || BROWSER_GLOBALS.has(name)) continue;
  missing.push({ name, where });
}

console.log(`扫描 ${files.length} 个文件；声明 ${declared.size} 个标识符；调用点涉及 ${calls.size} 个函数名`);
console.log(`\n调用了但找不到定义: ${missing.length}`);
missing.forEach((m) => console.log(`  - ${m.name}  ← ${m.where.slice(0, 4).join(', ')}`));
