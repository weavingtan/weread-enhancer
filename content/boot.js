/* 启动：初始化与 SPA 路由接管（必须最后加载）
 * 由 content.js 拆分而来：语句顺序与原文件一致，跨文件共享同一全局作用域。
 */

if (document.body) {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init);
}
