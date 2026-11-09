/* GitHub / Notion 伪装骨架与双栏判定
 * 由 content.js 拆分而来：语句顺序与原文件一致，跨文件共享同一全局作用域。
 */

const WRE_GH_OWNER = 'dev-lab';

const WRE_GH_REPO = 'notes';

const WRE_GH_FILE = 'README.md';

/* 这两个状态在 catalog.js（本文件之后加载）里就会被写，所以声明必须放在最早加载的文件里，
 * 否则一旦调用顺序变化就是 TDZ 报错（全局作用域共享的代价：声明位置也是契约）。 */
let ghLastChapterFile = ''; // 已写入 DOM 的「当前文件」身份

let ghFilebarFitKey = ''; // 文件头可用空白的测量缓存键

const WRE_GH_FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#1f2328" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>'
);

const WRE_NB_TEAM = 'Acme 团队';

const WRE_NB_SPACE = '产品空间';

const WRE_NB_PAGE = '需求评审记录';

const WRE_NB_FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#1f2328"/><text x="8" y="11.6" font-family="Helvetica,Arial,sans-serif" font-size="10.5" font-weight="700" fill="#ffffff" text-anchor="middle">N</text></svg>'
);

function wreCurrentSkin() {
  return WRE_STATE.skin === 'notion' ? 'notion' : 'github';
}

// 伪装开关 / 皮肤在设置面板里的按钮态。面板是伪装态下唯一的设置入口（顶栏头像打开），
// popup 改完状态后也要回写这里，否则会出现「popup 切了皮肤、面板还亮着旧的」。
function updateDisguiseUI() {
  if (!wreRoot) return;
  const btn = wreRoot.querySelector('#wre-disguise-toggle');
  const text = wreRoot.querySelector('#wre-disguise-toggle-text');
  const on = !!WRE_STATE.disguise;
  if (text) text.textContent = on ? '伪装已开启 · 点击退出' : '伪装已关闭 · 点击进入';
  if (btn) btn.classList.toggle('wre-toggle-on', on);
}

function updateSkinUI() {
  if (!wreRoot) return;
  const skin = wreCurrentSkin();
  wreRoot.querySelectorAll('#wre-skin-toggle button[data-skin]').forEach((btn) => {
    btn.classList.toggle('wre-theme-active', btn.getAttribute('data-skin') === skin);
  });
}

function setDisguiseSkin(skin) {
  const next = skin === 'notion' ? 'notion' : 'github';
  if (next === wreCurrentSkin()) return;
  WRE_STATE.skin = next;
  saveState();
  // 皮肤描述的是骨架结构，必须整体重建（侧栏树、面包屑文案、图标全都换）
  ghEnsureShell(true);
  if (WRE_STATE.disguise) {
    ghApplyPageIdentity();
    ghSyncChrome(true);
  }
  updateSkinUI();
  log('info', '伪装皮肤已切换', { skin: next });
}

const WRE_SVG = {
  logo: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="26" height="26" aria-hidden="true"><path fill="#fff" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>',
  search: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z"/></svg>',
  bell: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 16a2 2 0 0 0 1.985-1.75c.017-.137-.097-.25-.235-.25h-3.5c-.138 0-.252.113-.235.25A2 2 0 0 0 8 16ZM3 5a5 5 0 0 1 10 0v2.947c0 .05.015.098.042.139l1.703 2.555A1.519 1.519 0 0 1 13.482 13H2.518a1.516 1.516 0 0 1-1.263-2.36l1.703-2.554A.255.255 0 0 0 3 7.947Z"/></svg>',
  plus: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"/></svg>',
  repo: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z"/></svg>',
  code: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="m11.28 3.22 4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L13.94 8l-3.72-3.72a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215Zm-6.56 0a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L2.06 8l3.72 3.72a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L.47 8.53a.75.75 0 0 1 0-1.06Z"/></svg>',
  issue: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><path fill="currentColor" d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"/></svg>',
  pr: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/></svg>',
  actions: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M0 1.75C0 .784.784 0 1.75 0h3.5C6.216 0 7 .784 7 1.75v3.5A1.75 1.75 0 0 1 5.25 7H4v4a1 1 0 0 0 1 1h4v-1.25C9 9.784 9.784 9 10.75 9h3.5c.966 0 1.75.784 1.75 1.75v3.5A1.75 1.75 0 0 1 14.25 16h-3.5A1.75 1.75 0 0 1 9 14.25v-.75H5A2.5 2.5 0 0 1 2.5 11V7H1.75A1.75 1.75 0 0 1 0 5.25Zm1.75-.25a.25.25 0 0 0-.25.25v3.5c0 .138.112.25.25.25h3.5a.25.25 0 0 0 .25-.25v-3.5a.25.25 0 0 0-.25-.25Zm9 9a.25.25 0 0 0-.25.25v3.5c0 .138.112.25.25.25h3.5a.25.25 0 0 0 .25-.25v-3.5a.25.25 0 0 0-.25-.25Z"/></svg>',
  dir: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="#54aeff" d="M1.75 1h5c.55 0 1.07.26 1.4.7l.9 1.2c.04.06.11.1.19.1h4.01c.97 0 1.75.78 1.75 1.75v8.5c0 .97-.78 1.75-1.75 1.75H1.75C.78 15 0 14.22 0 13.25V2.75C0 1.78.78 1 1.75 1Z"/></svg>',
  file: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z"/></svg>',
  book: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M0 1.75A.75.75 0 0 1 .75 1h4.253c1.227 0 2.317.59 3 1.501A3.743 3.743 0 0 1 11.006 1h4.245a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-4.507a2.25 2.25 0 0 0-1.591.659l-.622.621a.75.75 0 0 1-1.06 0l-.622-.621A2.25 2.25 0 0 0 5.258 13H.75a.75.75 0 0 1-.75-.75Zm7.251 10.324.004-5.073-.002-2.253A2.25 2.25 0 0 0 5.003 2.5H1.5v9h3.757a3.75 3.75 0 0 1 1.994.574ZM8.755 4.75l-.004 7.322a3.752 3.752 0 0 1 1.992-.572H14.5v-9h-3.495a2.25 2.25 0 0 0-2.25 2.25Z"/></svg>',
  branch: '<svg class="wre-gh-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.492 2.492 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/></svg>',
};

let ghLastKnownDouble = false;

function ghIsDoubleColumn() {
  const canvas = document.querySelector('.wr_canvasContainer canvas');
  if (!canvas) {
    ghLastKnownDouble = false;
    return false;
  }
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return ghLastKnownDouble; // 正在重渲染，别翻
  ghLastKnownDouble = true;
  return true;
}

function ghFallbackTreeHtml() {
  return [
    { type: 'dir', name: 'src' },
    { type: 'dir', name: 'docs' },
    { type: 'dir', name: 'public' },
    { type: 'file', name: WRE_GH_FILE, active: true },
    { type: 'file', name: 'package.json' },
    { type: 'file', name: 'LICENSE' },
    { type: 'file', name: '.gitignore' },
  ].map((item) => `
    <div class="wre-gh-tree-item${item.active ? ' wre-gh-tree-active' : ''}">
      ${item.type === 'dir' ? WRE_SVG.dir : WRE_SVG.file}
      <span>${item.name}</span>
    </div>`).join('');
}
