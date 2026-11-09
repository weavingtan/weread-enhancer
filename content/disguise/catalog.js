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

// 目录采集结果缓存：几百章时「全量 querySelectorAll + 逐项读 textContent」不便宜，
// 而观察器每次同步都会调到这里。用「目录面板脏标记」代替重复采集：
// 面板结构变化或行 class（当前章高亮）变化时置脏，下次再重新采。
let ghCatalogCache = { items: [], root: null, dirty: true };

let ghCatalogWatch = null;

function ghCatalogInvalidate() {
  ghCatalogCache.dirty = true;
}

function ghWatchCatalogRoot(root) {
  if (!root) return;
  if (ghCatalogCache.root === root && ghCatalogWatch) return;
  if (ghCatalogWatch) ghCatalogWatch.disconnect();
  ghCatalogWatch = new MutationObserver(ghCatalogInvalidate);
  ghCatalogWatch.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  ghCatalogCache.root = root;
}

function ghCacheCatalogItems(root, items) {
  ghCatalogCache.items = items;
  ghCatalogCache.dirty = false;
  ghWatchCatalogRoot(root);
  return items;
}

// 从微信读书目录 DOM 里取章节项；取不到返回空数组，调用方回退静态假树。
// 章节名固定是 .readerCatalog_list_item_title_text（a.html 实测每章一个），
// 直接按它取最稳：笼统按 li/[class*=item] 取会把行内 meta（「当前读到 40%」「书签」）也算成章节。
function ghCollectCatalogItems() {
  if (!ghCatalogCache.dirty && ghCatalogCache.root && ghCatalogCache.root.isConnected) {
    return ghCatalogCache.items;
  }
  for (const sel of GH_CATALOG_SCOPES) {
    const root = document.querySelector(sel);
    if (!root) continue;
    const titled = Array.from(root.querySelectorAll('[class*="list_item_title_text"]'))
      .filter((el) => (el.textContent || '').trim().length > 0);
    if (titled.length >= 3) return ghCacheCatalogItems(root, titled);
    const raw = Array.from(root.querySelectorAll('li, [class*="item"], [class*="Item"]'));
    if (raw.length < 3) continue;
    const items = raw.filter((el) => {
      if (el.querySelector('li, [class*="item"], [class*="Item"]')) return false; // 只看叶子项
      const text = (el.textContent || '').trim();
      return text.length > 0 && text.length <= 80;
    });
    if (items.length >= 3) return ghCacheCatalogItems(root, items);
  }
  // 目录还没渲染（书城页 / 阅读器刚起来）：不缓存，下次重查
  ghCatalogCache.items = [];
  ghCatalogCache.dirty = true;
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

// 目录行的 meta 里混着「当前读到 40%」「书签」。书签是可依赖的事实（用户自己加的），
// 侧栏树用 ⭐ 标出来。检测时把「行文本 − 章节名」再匹配，避免章节名本身带「书签」二字误判。
// 注：网页版没有可靠的「每章已读/未读」标记，所以不做置灰（猜错比不猜更糟）。
function ghCatalogBookmarks(items) {
  return items.map((el) => {
    const row = el.closest?.('.readerCatalog_list_item') || el;
    // 主路径：el 是 _title_text 节点，行文本减掉标题就是 meta；
    // 兜底路径：el 就是整行（目录项 <3 时 ghCollectCatalogItems 退回叶子节点），
    // 没法做差集，只能找行内某个子节点文本恰好是「书签」。
    if (el !== row) {
      const rest = (row.textContent || '').replace((el.textContent || '').trim(), '');
      return /书签/.test(rest);
    }
    return Array.from(row.querySelectorAll?.('*') || [])
      .some((node) => (node.textContent || '').trim() === '书签');
  });
}

// 当前章的唯一判据（顶栏没有章名，只能从目录拿）：先认 .selected 标签，
// 再退回目录行上的高亮类。身份显示、j/k 翻章、目录高亮都走这里，避免两套顺序各自漂移。
function ghCurrentChapterIndex(items) {
  const list = items || ghCollectCatalogItems();
  const selected = ghCatalogSelectedLabel();
  if (selected) {
    const hit = list.findIndex((el) => (el.textContent || '').trim() === selected);
    if (hit >= 0) return hit;
  }
  return ghCatalogActiveIndex(list);
}

// 目录还没渲染过就返回空串，调用方退回 README.md ——「当前文件」在各处必须一致，
// 否则侧栏高亮第十二章、窗口标题还写着 README.md，一眼就穿帮。
// 这里刻意不依赖「目录至少 3 项」的采集门槛（ghCollectCatalogItems 的门槛用于避免
// 把普通列表误认成目录）：单章 / 两章的短篇也要能显示正确的文件名。
function ghCurrentChapterLabel() {
  const selected = ghCatalogSelectedLabel();
  if (selected) return selected;
  const items = ghCollectCatalogItems();
  const idx = ghCatalogActiveIndex(items);
  if (idx >= 0) return (items[idx].textContent || '').trim();
  return '';
}

// 上次渲染用的采集结果（同一数组引用）与当前章索引：都没变就不必重铺 DOM，
// 也不再需要把每章名字 join 成字符串签名（几百章时那次 join 本身就是开销）。
let ghCatalogRenderItems = null;

let ghCatalogRenderActive = -2;

let ghCatalogRenderSkin = '';

function ghResetCatalogRender() {
  ghCatalogRenderItems = null;
  ghCatalogRenderActive = -2;
  ghCatalogRenderSkin = '';
}

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
  const profile = wreSkinProfile();
  const tree = document.querySelector(profile.treeSelector);
  if (!tree) return;

  const items = ghCollectCatalogItems();
  const activeIdx = ghCurrentChapterIndex(items); // 与窗口标题 / file chip 同一判据
  // 微信读书重渲染过目录（节点被换掉）时，缓存的引用全部失效 → 强制重铺一遍
  const refsStale = ghCatalogRefs.length > 0 && ghCatalogRefs.some((el) => !el.isConnected);
  const skinChanged = profile.id !== ghCatalogRenderSkin;
  // items 是缓存数组：引用不变 + 当前章没变 + 皮肤没变 ＝ 目录没动，直接跳过
  // （皮肤要进签名：两套皮肤的条目 DOM 结构不同，切皮肤必须重铺）
  if (!force && !refsStale && !skinChanged
    && items === ghCatalogRenderItems
    && activeIdx === ghCatalogRenderActive) return;

  // 目录内容可能在频繁抖动（目录面板滚动）：1.5s 内不重复全量重铺几百行。
  // 但「当前章变了」和「切了皮肤」必须立刻生效 —— 以前节流排在最前面，
  // 导致点完目录后侧栏高亮要等最多 1.5s 才跟上。
  const now = Date.now();
  if (!force && !refsStale && !skinChanged
    && activeIdx === ghCatalogRenderActive
    && now - ghLastCatalogScan < 1500) return;
  ghLastCatalogScan = now;
  ghCatalogRenderItems = items;
  ghCatalogRenderActive = activeIdx;
  ghCatalogRenderSkin = profile.id;

  if (items.length === 0) {
    tree.innerHTML = profile.fallbackTree();
    return;
  }

  const bookmarks = ghCatalogBookmarks(items);
  tree.innerHTML = items.map((el, i) => profile.treeItemHtml({
    index: i,
    chapter: (el.textContent || '').trim(),
    active: i === activeIdx,
    bookmarked: bookmarks[i],
  })).join('');

  // 渲染时把原始节点存下来：页面重渲染后索引会错位，引用也可能失效，
  // 所以点击时还要按 data-chapter 的章节名兜底匹配。
  // 点击事件走 document 上的委托（见 ghBindCatalogDelegation），不在这里逐个绑：
  // 侧栏 DOM 可能被重建，逐个绑的监听会一起消失，表现就是「点了毫无反应」。
  ghCatalogRefs = items.slice();
}

let ghCatalogDelegationBound = false;

// 侧栏点击 / 章节查找器 / j k 翻章，都是「定位目录节点 → 跳章 → 失败提示」，
// 差别只在来源文案与要不要复制诊断。统一在这里，省得三份各自演化出不同行为。
async function ghJumpChapter(chapter, options = {}) {
  const label = String(chapter || '').trim();
  const target = ghFindCatalogItem(Number(options.index), label);
  if (!target) {
    ghToast(`目录里找不到「${label.slice(0, 12)}」`);
    return { ok: false, report: ['node-missing'] };
  }
  log('info', `${options.source || '目录'}跳章`, { chapter: label });
  const result = await ghJumpToCatalogEntry(target, label);
  if (result.ok) return result;
  ghToast(`跳章失败：${result.report.join(' · ')}${options.diagnostics ? '（诊断已复制）' : ''}`);
  if (options.diagnostics) ghCopyDiagnostics(target, result.report);
  return result;
}

async function ghHandleCatalogClick(node) {
  await ghJumpChapter(node.dataset.chapter || '', {
    index: node.dataset.catalog,
    source: '侧栏目录',
    diagnostics: true,
  });
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
    // 两套皮肤的目录行共用 .wre-tree-row 作为可点击标记
    const node = event.target?.closest?.('.wre-tree-row[data-chapter]');
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
        <span class="wre-gh-file-chip">${WRE_SVG.file}<span class="wre-gh-file-chip-label">${WRE_GH_FILE}</span></span>
      </div>
    </div>

    <!-- 文件头：GitHub 文件视图在仓库条下面还有一行「路径 + 行数 + Copy」。
         它是 fixed 覆盖层，不推正文；只有当正文上方真有这么多空白时才显示
         （见 ghUpdateFilebarFit，宁可没有也不压字）。 -->
    <div class="wre-gh-filebar">
      <div class="wre-gh-filebar-inner">
        <span class="wre-gh-filepath">
          ${WRE_SVG.dir}<span>docs</span>
          <span class="wre-gh-crumb-slash">/</span>
          ${WRE_SVG.file}<span class="wre-gh-filebar-name">${WRE_GH_FILE}</span>
        </span>
        <div class="wre-gh-file-actions">
          <span class="wre-gh-filebar-meta">—</span>
          <button class="wre-gh-filebtn" data-copy="1">Copy</button>
        </div>
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

// Notion 皮肤的兜底树：目录还没采集到（书城页 / 阅读器刚起来）时用它撑住页面形状。
// 采集到真目录后会被 ghRenderCatalogTree 整块替换成真实章节。
function ghFallbackNotionTreeHtml() {
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
  return pages.map((item) => `
          <div class="wre-nb-tree-item${item.active ? ' wre-nb-tree-active' : ''}${item.type === 'space' ? ' wre-nb-tree-space' : ''}"
            style="padding-left:${10 + item.depth * 14}px">
            <span class="wre-nb-doc"></span><span>${item.name}</span>
          </div>`).join('');
}

function ghShellHtmlNotion() {
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
        ${ghFallbackNotionTreeHtml()}
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
  // 顶栏头像 = 伪装态下唯一的设置入口（真 GitHub 的头像菜单也是点开个人项，
  // 只是我们直接给插件设置面板；悬浮球在伪装态被隐藏，不接这条线就无入口）
  shell.querySelectorAll('.wre-gh-avatar').forEach((avatar) => {
    avatar.addEventListener('click', (event) => {
      event.stopPropagation();
      openModal('#wre-read-settings-modal');
      updateDisguiseUI();
      updateSkinUI();
    });
  });

  // 文件头的 Copy：真复制本章正文（GitHub 的 Copy 也是复制文件内容）
  shell.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const text = ghContentText();
      if (!text) {
        ghToast('没读到正文，稍后再试');
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        ghToast(`已复制本章正文（${text.length} 字）`);
      } catch (e) {
        ghToast('复制失败：浏览器拒绝了剪贴板权限');
      }
    });
  });

  // 顶栏假搜索框：文案写着 Type / to search，就必须真能搜（章节查找器）
  shell.querySelectorAll('.wre-gh-search, .wre-nb-search').forEach((box) => {
    box.addEventListener('click', (event) => {
      event.stopPropagation();
      ghOpenFinder();
    });
  });

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
  const profile = wreSkinProfile();
  const skin = profile.id;
  const existing = document.getElementById('wre-gh-shell');
  if (existing && !force && existing.dataset.skin === skin) return existing;
  if (existing) existing.remove();

  const shell = document.createElement('div');
  shell.id = 'wre-gh-shell';
  shell.dataset.skin = skin;
  shell.innerHTML = profile.shellHtml();
  document.body.appendChild(shell);
  document.documentElement.dataset.wreSkin = skin;
  ghBindShell(shell);
  ghResetCatalogRender(); // 骨架重建后目录要重新铺一遍
  ghLastChapterFile = ''; // 骨架里的 file chip / 标题都是新 DOM，必须重写一遍
  ghFilebarFitKey = ''; // 新骨架 = 新的文件头，空白要重新量
  ghRenderCatalogTree(true);
  return shell;
}
