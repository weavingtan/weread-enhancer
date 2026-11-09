/* 侧栏书籍目录、跳章、诊断
 * 由 content.js 拆分而来：语句顺序与原文件一致，跨文件共享同一全局作用域。
 */

// 章节名来自页面/书源，拼进 innerHTML 前必须转义（否则「书名里带标签」会直接执行）
function ghEscapeHtml(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const GH_CATALOG_SCOPES = [
  '.readerCatalog',
  '[class*="readerCatalog"]',
  '[class*="catalogPanel"]',
  '[class*="catalog"]',
];

// 从微信读书目录 DOM 里取章节项；取不到返回空数组，调用方回退静态假树。
// 章节名固定是 .readerCatalog_list_item_title_text（a.html 实测每章一个），
// 直接按它取最稳：笼统按 li/[class*=item] 取会把行内 meta（「当前读到 40%」「书签」）也算成章节。
function ghCollectCatalogItems() {
  for (const sel of GH_CATALOG_SCOPES) {
    const root = document.querySelector(sel);
    if (!root) continue;
    const titled = Array.from(root.querySelectorAll('[class*="list_item_title_text"]'))
      .filter((el) => (el.textContent || '').trim().length > 0);
    if (titled.length >= 3) return titled;
    const raw = Array.from(root.querySelectorAll('li, [class*="item"], [class*="Item"]'));
    if (raw.length < 3) continue;
    const items = raw.filter((el) => {
      if (el.querySelector('li, [class*="item"], [class*="Item"]')) return false; // 只看叶子项
      const text = (el.textContent || '').trim();
      return text.length > 0 && text.length <= 80;
    });
    if (items.length >= 3) return items;
  }
  return [];
}

function ghCatalogActiveIndex(items) {
  return items.findIndex((el) => {
    const row = el.closest?.('.readerCatalog_list_item') || el;
    return /active|current|selected/i.test(`${el.className || ''} ${row.className || ''}`);
  });
}

function ghChapterFileName(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return WRE_GH_FILE;
  const base = clean.length > 26 ? `${clean.slice(0, 26)}…` : clean;
  return /\.\w{1,5}$/.test(base) ? base : `${base}.md`;
}

let ghCatalogSignature = '';

let ghLastCatalogScan = 0;

let ghCatalogRefs = [];

const GH_CATALOG_REVEAL_PROPS = [
  'display', 'visibility', 'opacity', 'pointer-events',
  'position', 'left', 'top', 'width', 'max-height', 'overflow', 'z-index',
];

function ghRevealCatalogRoot() {
  const root = document.querySelector('.readerCatalog') || document.querySelector('[class*="catalog"]');
  if (!root) return null;
  const rect = root.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) return null; // 本来就开着
  const saved = GH_CATALOG_REVEAL_PROPS.map((prop) => [
    prop, root.style.getPropertyValue(prop), root.style.getPropertyPriority(prop),
  ]);
  const set = (prop, value) => root.style.setProperty(prop, value, 'important');
  set('display', 'block');
  set('visibility', 'visible');
  set('opacity', '1');
  set('pointer-events', 'auto');
  set('position', 'fixed');
  set('left', '0');
  set('top', '0');
  set('width', '320px');
  set('max-height', '80vh');
  set('overflow', 'auto');
  set('z-index', '2147483647');
  return () => {
    saved.forEach(([prop, value, priority]) => {
      if (value) root.style.setProperty(prop, value, priority);
      else root.style.removeProperty(prop);
    });
  };
}

function ghDispatchClick(node) {
  if (!node) return;
  // 带真实坐标与 detail=1：有些处理器会读 event.detail / clientX / offsetX 做判定
  const rect = node.getBoundingClientRect();
  const base = {
    bubbles: true,
    cancelable: true,
    view: window,
    detail: 1,
    button: 0,
    clientX: Math.round(rect.left + rect.width / 2),
    clientY: Math.round(rect.top + rect.height / 2),
  };
  ['mouseover', 'mouseenter', 'mousemove'].forEach((type) => {
    node.dispatchEvent(new MouseEvent(type, { ...base, bubbles: type !== 'mouseenter' }));
  });
  try {
    node.dispatchEvent(new PointerEvent('pointerdown', {
      ...base, pointerType: 'mouse', isPrimary: true, pointerId: 1,
    }));
  } catch (e) { /* 不支持 PointerEvent 就只发鼠标事件 */ }
  try { node.focus?.({ preventScroll: true }); } catch (e) { /* 不可聚焦就跳过 */ }
  node.dispatchEvent(new MouseEvent('mousedown', base));
  try { node.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1 })); } catch (e) { /* 同上 */ }
  node.dispatchEvent(new MouseEvent('mouseup', base));
  // 只派发一次 click：再补 node.click() 会让同一个处理器跑两遍（章节会被跳两次）
  node.dispatchEvent(new MouseEvent('click', base));
}

function ghActivateCatalogItem(el, { reveal = true } = {}) {
  if (!el) return;
  // 点目录按钮本身不要展开面板：那会把「打开面板」这件正事搅乱
  const restore = reveal ? ghRevealCatalogRoot() : null;
  try {
    ghDispatchClick(el);
  } finally {
    restore?.();
  }
}

const ghSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ghChapterTitleText() {
  const scope = document.querySelector('.readerChapterContent') || document.querySelector('.app_content');
  const text = String(scope?.innerText || '').replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 60);
  const items = ghCollectCatalogItems();
  const idx = ghCatalogActiveIndex(items);
  if (idx >= 0) return (items[idx].textContent || '').trim();
  const bar = document.querySelector('.readerTopBar_title_chapter');
  return (bar?.textContent || '').trim();
}

function ghCatalogRoot() {
  return document.querySelector('.readerCatalog') || document.querySelector('[class*="catalog"]');
}

function ghCatalogRootSize() {
  const root = ghCatalogRoot();
  if (!root) return '(无面板)';
  const rect = root.getBoundingClientRect();
  return `${Math.round(rect.width)}x${Math.round(rect.height)}`;
}

function ghCatalogPanelOpen() {
  const rect = ghCatalogRoot()?.getBoundingClientRect();
  return !!rect && rect.width > 0 && rect.height > 0;
}

function ghCatalogTrigger() {
  return document.querySelector('.readerControls_item.catalog')
    || Array.from(document.querySelectorAll('.readerControls_item'))
      .find((el) => /catalog|目录/i.test(String(el.className || '')))
    || null;
}

async function ghOpenCatalogPanel() {
  if (ghCatalogPanelOpen()) return true;
  const trigger = ghCatalogTrigger();
  if (!trigger) return false;
  ghActivateCatalogItem(trigger, { reveal: false });
  for (let waited = 0; waited < 800; waited += 100) {
    await ghSleep(100);
    if (ghCatalogPanelOpen()) return true;
  }
  return false;
}

function ghCloseCatalogPanel() {
  if (!ghCatalogPanelOpen()) return;
  const trigger = ghCatalogTrigger();
  if (trigger) ghActivateCatalogItem(trigger, { reveal: false });
}

function ghCatalogSelectedLabel() {
  const row = document.querySelector('.readerCatalog_list_item_selected');
  if (!row) return '';
  const title = row.querySelector('[class*="list_item_title_text"]') || row;
  return (title.textContent || '').trim();
}

async function ghWaitChapterChange(before, label, timeout) {
  for (let waited = 0; waited < timeout; waited += 100) {
    await ghSleep(100);
    if (label && ghCatalogSelectedLabel() === label) return true;
    const now = ghChapterTitleText();
    if (now && now !== before) return true;
  }
  return false;
}

async function ghJumpToCatalogEntry(node, label) {
  const report = [];
  const before = ghChapterTitleText();
  const beforeSelected = ghCatalogSelectedLabel();
  ghTraceCatalogClicks();
  const attempt = async (target, tag) => {
    if (!target) return false;
    ghActivateCatalogItem(target);
    const ok = await ghWaitChapterChange(before, label, 700);
    report.push(`${tag}${ok ? '成功' : '无效'}`);
    return ok;
  };

  const opened = await ghOpenCatalogPanel();
  if (!opened) report.push('目录按钮没打开面板');

  // 面板一打开微信读书可能整块重渲染，侧栏缓存的节点会失效 → 优先用重新取到的节点
  const items = ghCollectCatalogItems();
  const fresh = items.find((el) => (el.textContent || '').trim() === label);
  const rowOf = (el) => el?.closest?.('.readerCatalog_list_item') || null;
  const row = rowOf(fresh || node);
  const inner = row?.querySelector('.readerCatalog_list_item_inner') || null;
  const ok = (fresh && await attempt(fresh, '点章节名'))
    || (inner && await attempt(inner, '点内层'))
    || (node && node !== fresh && await attempt(node, '点侧栏节点'))
    || (row && await attempt(row, '点整行'));

  if (opened) ghCloseCatalogPanel();
  if (ok) return { ok: true, report };

  const afterSelected = ghCatalogSelectedLabel();
  report.push(`选中${beforeSelected.slice(0, 10) || '(空)'}→${afterSelected.slice(0, 10) || '(空)'}`);
  report.push(`面板${ghCatalogRootSize()}·${items.length}项`);
  return { ok: false, report };
}

function ghRenderCatalogTree(force) {
  if (wreCurrentSkin() !== 'github') return;
  // 目录可能有几百章，正文滚动时观察器会频繁触发同步：1.5s 内不重复全量扫描
  const now = Date.now();
  if (!force && now - ghLastCatalogScan < 1500) return;
  ghLastCatalogScan = now;

  const tree = document.querySelector('.wre-gh-tree');
  if (!tree) return;

  const items = ghCollectCatalogItems();
  const activeIdx = ghCatalogActiveIndex(items);
  // 章节列表或当前章节变了才重建，避免每次同步都重写 DOM
  const signature = `${items.map((el) => (el.textContent || '').trim()).join('|')}#${activeIdx}`;
  // 微信读书重渲染过目录（节点被换掉）时，缓存的引用全部失效 → 强制重铺一遍
  const refsStale = ghCatalogRefs.length > 0 && ghCatalogRefs.some((el) => !el.isConnected);
  if (!refsStale && signature === ghCatalogSignature) return;
  ghCatalogSignature = signature;

  if (items.length === 0) {
    tree.innerHTML = ghFallbackTreeHtml();
    return;
  }

  tree.innerHTML = items.map((el, i) => {
    const chapter = (el.textContent || '').trim();
    return `
   <div class="wre-gh-tree-item${i === activeIdx ? ' wre-gh-tree-active' : ''}"
     data-catalog="${i}" data-chapter="${ghEscapeHtml(chapter)}">
     ${WRE_SVG.file}
     <span>${ghEscapeHtml(ghChapterFileName(el.textContent))}</span>
   </div>`;
  }).join('');

  // 渲染时把原始节点存下来：页面重渲染后索引会错位，引用也可能失效，
  // 所以点击时还要按 data-chapter 的章节名兜底匹配。
  // 点击事件走 document 上的委托（见 ghBindCatalogDelegation），不在这里逐个绑：
  // 侧栏 DOM 可能被重建，逐个绑的监听会一起消失，表现就是「点了毫无反应」。
  ghCatalogRefs = items.slice();
}

let ghCatalogDelegationBound = false;

async function ghHandleCatalogClick(node) {
  const idx = Number(node.dataset.catalog);
  const chapter = node.dataset.chapter || '';
  const target = ghFindCatalogItem(idx, chapter);
  if (!target) {
    ghToast(`目录里找不到「${chapter.slice(0, 12)}」`);
    return;
  }
  log('info', '侧栏目录跳章', { idx, chapter });
  const result = await ghJumpToCatalogEntry(target, chapter);
  if (result.ok) return;
  ghToast(`跳章失败：${result.report.join(' · ')}（诊断已复制）`);
  ghCopyDiagnostics(target, result.report);
}

function ghDumpVisibleLeaves(scope, limit) {
  if (!scope) return '(none)';
  const rows = [];
  for (const el of Array.from(scope.querySelectorAll('*'))) {
    if (el.tagName.toLowerCase() === 'svg' || el.closest('svg')) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (Array.from(el.children).some((child) => child.tagName.toLowerCase() !== 'svg')) continue; // 只看叶子
    const label = el.getAttribute('aria-label') || el.getAttribute('title') || el.dataset?.id || '';
    // 修饰类（showBookReviews / fontSizeButton / dark / 目录）挂在按钮上而不是图标上，
    // 所以叶子节点旁边要带上父层类名，否则只看到一排一模一样的 span.icon
    const parent = el.parentElement;
    const parentCls = parent && parent !== scope ? `${parent.tagName.toLowerCase()}.${String(parent.className || '').trim()}` : '';
    rows.push(`${el.tagName.toLowerCase()}.${String(el.className || '').trim()}｜${(el.textContent || '').trim().slice(0, 8)}｜${label}｜${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}｜⇧${parentCls}`);
    if (rows.length >= limit) break;
  }
  return rows.join('\n') || '(empty)';
}

const ghCatalogClickTrace = [];

let ghCatalogTraced = false;

function ghTraceCatalogClicks() {
  const root = ghCatalogRoot();
  if (!root || ghCatalogTraced) return;
  ghCatalogTraced = true;
  ['pointerdown', 'click'].forEach((type) => {
    root.addEventListener(type, (event) => {
      const el = event.target;
      ghCatalogClickTrace.push(`${type}:${el?.tagName?.toLowerCase()}.${String(el?.className || '').split(' ')[0]}${event.isTrusted ? '(trusted)' : ''}`);
      if (ghCatalogClickTrace.length > 10) ghCatalogClickTrace.shift();
    }, true);
  });
}

function ghCatalogSnapshot() {
  const root = ghCatalogRoot();
  const trigger = ghCatalogTrigger();
  const trect = trigger?.getBoundingClientRect();
  return [
    `panel: style=${root?.getAttribute('style') || '(no style)'}｜rect=${ghCatalogRootSize()}`,
    `rows: li=${document.querySelectorAll('.readerCatalog_list_item').length}｜items=${ghCollectCatalogItems().length}｜selected=${JSON.stringify(ghCatalogSelectedLabel())}`,
    `trigger: ${trigger ? `${trigger.tagName.toLowerCase()}.${String(trigger.className)} ${trect ? `${Math.round(trect.width)}x${Math.round(trect.height)}` : ''}` : '(none)'}`,
    `clickTrace: ${ghCatalogClickTrace.join(' > ') || '(空：合成 click 没进到目录树)'}`,
  ].join('\n');
}

function ghCopyDiagnostics(target, report) {
  const controls = document.querySelector('.readerControls') || document.querySelector('[class*="readerControls"]');
  const topbar = document.querySelector('.readerTopBar') || document.querySelector('[class*="readerTopBar"]');
  const text = [
    `URL: ${location.href}`,
    `lastJump: ${(report || []).join(' · ') || '(无)'}`,
    `item: ${target?.outerHTML?.slice(0, 300) || '(null)'}`,
    `catalog:\n${ghCatalogSnapshot()}`,
    `controls:\n${ghDumpVisibleLeaves(controls, 24)}`,
    `topbar:\n${ghDumpVisibleLeaves(topbar, 24)}`,
  ].join('\n\n');
  log('info', '目录诊断', { text });
  try {
    navigator.clipboard?.writeText(text).catch(() => { /* 剪贴板不可用就只留 console */ });
  } catch (e) { /* 忽略 */ }
}

function ghBindCatalogDelegation() {
  if (ghCatalogDelegationBound) return;
  ghCatalogDelegationBound = true;
  document.addEventListener('click', (event) => {
    if (!document.documentElement.classList.contains('wre-disguise')) return;
    const node = event.target?.closest?.('.wre-gh-tree-item[data-chapter]');
    if (node) {
      event.preventDefault();
      ghHandleCatalogClick(node);
      return;
    }
    const sidebar = document.querySelector('.wre-gh-sidebar');
    if (!sidebar || !sidebar.offsetParent) return;
    const rect = sidebar.getBoundingClientRect();
    const { clientX: x, clientY: y } = event;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;
    const hit = document.elementFromPoint(x, y);
    if (!hit || sidebar.contains(hit)) return;
    ghToast(`点击被 ${hit.tagName.toLowerCase()}.${String(hit.className || '').split(' ')[0]} 挡住`);
  }, true);
}

function ghFindCatalogItem(idx, chapter) {
  const ref = ghCatalogRefs[idx];
  if (ref && ref.isConnected && (!chapter || (ref.textContent || '').trim() === chapter)) return ref;
  const items = ghCollectCatalogItems();
  if (chapter) {
    const hit = items.find((el) => (el.textContent || '').trim() === chapter);
    if (hit) return hit;
  }
  return items[idx] || null;
}

function ghShellHtmlGithub() {
  return `
    <div class="wre-gh-topbar">
      <div class="wre-gh-topbar-inner">
        ${WRE_SVG.logo}
        <span class="wre-gh-topbar-sep"></span>
        <div class="wre-gh-search">${WRE_SVG.search}<span>Type <kbd>/</kbd> to search</span></div>
        <nav class="wre-gh-topnav"><span>Pull requests</span><span>Issues</span><span>Marketplace</span><span>Explore</span></nav>
        <div class="wre-gh-topbar-right">
          ${WRE_SVG.bell}
          ${WRE_SVG.plus}
          <span class="wre-gh-avatar" id="wre-gh-avatar" title="Settings"></span>
        </div>
      </div>
    </div>

    <div class="wre-gh-repobar">
      <div class="wre-gh-repobar-inner">
        <div class="wre-gh-crumb">
          ${WRE_SVG.repo}
          <span class="wre-gh-crumb-owner">${WRE_GH_OWNER}</span>
          <span class="wre-gh-crumb-slash">/</span>
          <span class="wre-gh-crumb-repo">${WRE_GH_REPO}</span>
          <span class="wre-gh-badge">Public</span>
        </div>
        <nav class="wre-gh-tabs">
          <span class="wre-gh-tab wre-gh-tab-active">${WRE_SVG.code}Code</span>
          <span class="wre-gh-tab">${WRE_SVG.issue}Issues</span>
          <span class="wre-gh-tab">${WRE_SVG.pr}Pull requests</span>
          <span class="wre-gh-tab">${WRE_SVG.actions}Actions</span>
        </nav>
        <span class="wre-gh-file-chip">${WRE_GH_FILE}</span>
      </div>
    </div>

    <aside class="wre-gh-sidebar">
      <div class="wre-gh-side-repo">
        <span class="wre-gh-side-avatar"></span>
        <div class="wre-gh-side-repo-text">
          <b>${WRE_GH_REPO}</b>
          <i>Public</i>
        </div>
      </div>
      <div class="wre-gh-side-branch">${WRE_SVG.branch}<span>main</span></div>
      <div class="wre-gh-side-search">${WRE_SVG.search}<span>Go to file</span><kbd>t</kbd></div>
      <div class="wre-gh-tree">
        ${ghFallbackTreeHtml()}
      </div>
    </aside>

    <div class="wre-gh-pager">
      <button class="wre-gh-pager-btn" data-dir="-1">‹ Previous</button>
      <button class="wre-gh-pager-btn" data-dir="1">Next ›</button>
    </div>

    <div id="wre-gh-toast"></div>
  `;
}

function ghShellHtmlNotion() {
  const pages = [
    { name: '产品空间', depth: 0, type: 'space' },
    { name: WRE_NB_PAGE, depth: 1, type: 'doc', active: true },
    { name: '竞品分析', depth: 1, type: 'doc' },
    { name: '数据看板', depth: 1, type: 'doc' },
    { name: '用户访谈纪要', depth: 1, type: 'doc' },
    { name: '团队空间', depth: 0, type: 'space' },
    { name: '排期表', depth: 1, type: 'doc' },
    { name: '线上问题跟踪', depth: 1, type: 'doc' },
    { name: '技术方案', depth: 1, type: 'doc' },
  ];
  return `
    <div class="wre-nb-topbar">
      <div class="wre-nb-topbar-inner">
        <span class="wre-nb-logo">A</span>
        <div class="wre-nb-crumbs">
          <span class="wre-nb-crumb-muted">${WRE_NB_TEAM}</span>
          <span class="wre-nb-slash">/</span>
          <span class="wre-nb-crumb-muted">${WRE_NB_SPACE}</span>
          <span class="wre-nb-slash">/</span>
          <span class="wre-nb-crumb">${WRE_NB_PAGE}</span>
        </div>
        <div class="wre-nb-right">
          <span class="wre-nb-share">Share</span>
          <span class="wre-nb-dots">···</span>
          <span class="wre-gh-avatar" id="wre-gh-avatar" title="Settings"></span>
        </div>
      </div>
    </div>

    <aside class="wre-gh-sidebar wre-nb-side">
      <div class="wre-nb-workspace">
        <span class="wre-nb-ws-avatar">A</span>
        <b>${WRE_NB_TEAM}</b>
      </div>
      <div class="wre-nb-search">${WRE_SVG.search}<span>Search</span></div>
      <div class="wre-nb-tree">
        ${pages.map((item) => `
          <div class="wre-nb-tree-item${item.active ? ' wre-nb-tree-active' : ''}${item.type === 'space' ? ' wre-nb-tree-space' : ''}"
            style="padding-left:${10 + item.depth * 14}px">
            <span class="wre-nb-doc"></span><span>${item.name}</span>
          </div>`).join('')}
      </div>
    </aside>

    <div class="wre-gh-pager wre-nb-pager">
      <button class="wre-gh-pager-btn" data-dir="-1" aria-label="上一页">‹</button>
      <button class="wre-gh-pager-btn" data-dir="1" aria-label="下一页">›</button>
    </div>

    <div id="wre-gh-toast"></div>
  `;
}

function ghBindShell(shell) {
  shell.querySelectorAll('.wre-gh-pager-btn').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const dir = Number(btn.getAttribute('data-dir')) || 1;
      if (ghIsDoubleColumn()) {
        ghDispatchPageKey(dir);
      } else if (!ghClickChapterNav(dir)) {
        ghToast('没找到微信读书的翻章按钮，可先按 G 切回原版');
      }
    });
  });
}

function ghEnsureShell(force) {
  const skin = wreCurrentSkin();
  const existing = document.getElementById('wre-gh-shell');
  if (existing && !force && existing.dataset.skin === skin) return existing;
  if (existing) existing.remove();

  const shell = document.createElement('div');
  shell.id = 'wre-gh-shell';
  shell.dataset.skin = skin;
  shell.innerHTML = skin === 'notion' ? ghShellHtmlNotion() : ghShellHtmlGithub();
  document.body.appendChild(shell);
  document.documentElement.dataset.wreSkin = skin;
  ghBindShell(shell);
  ghCatalogSignature = ''; // 骨架重建后目录要重新铺一遍
  ghRenderCatalogTree(true);
  return shell;
}
