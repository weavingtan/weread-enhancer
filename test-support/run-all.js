#!/usr/bin/env node
/* 跑 test-support 下全部断言脚本
 *
 * 每个脚本独立进程：jsdom 的全局（window / sessionStorage / ResizeObserver 打桩）互不干扰。
 * 脚本约定：失败时以非 0 退出码结束，或在输出里带 "FAIL" / "发现 N 条错误"。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const SKIP = new Set(['run-all.js']);

const ORDER = [
  'smoke-load.js',      // 按 manifest 顺序加载全部模块
  'call-check.js',      // 调用了但没定义的函数
  'escape-test.js',     // 章节名转义
  'ink-test.js',        // Canvas 墨迹左边界
  'pager-test.js',      // 分页条对齐兜底
  'sidebar-test.js',    // 侧栏留白测量
  'catalog-cache-test.js', // 目录采集缓存 / 原生翻页按钮隐藏
  'entry-test.js',      // 伪装态设置入口
  'finder-test.js',     // 章节查找器 / j k
  'identity-test.js',   // 当前文件身份
  'skin-test.js',       // 皮肤注册表
  'filebar-test.js',    // 文件头（自适应显示 / Copy）
  'bookmark-test.js',   // 侧栏树书签 ⭐
  'layout-observer-test.js', // 布局观察器
  'log-gate-test.js',   // 日志闸门
  'boot-probe-test.js', // 重载探针
];

const files = fs.readdirSync(DIR)
  .filter((f) => f.endsWith('.js') && !SKIP.has(f))
  .sort((a, b) => {
    const ia = ORDER.indexOf(a);
    const ib = ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });

let failed = 0;
const lines = [];

files.forEach((file) => {
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join(DIR, file)], {
    encoding: 'utf8',
    env: process.env,
  });
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  const badLines = out.split('\n').filter((l) => /^\s*FAIL/.test(l) || /发现 \d+ 条错误/.test(l));
  const ok = result.status === 0 && badLines.length === 0;
  const cost = `${Date.now() - started}ms`;
  lines.push(`${ok ? '✓' : '✗'} ${file.padEnd(26)} ${cost}`);
  if (!ok) {
    failed += 1;
    lines.push(out.split('\n').slice(-16).map((l) => `    ${l}`).join('\n'));
  }
});

console.log(lines.join('\n'));
console.log(`\n${files.length - failed}/${files.length} 个脚本通过`);
process.exit(failed ? 1 : 0);
