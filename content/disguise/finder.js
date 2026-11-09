/* 章节查找器（GitHub 的「Go to file」）
 * 顶栏那个假搜索框一直写着「Type / to search」，到这一版才真的能用：
 * 按 / 或 t 打开，输入章节名 → ↑↓ 选 → Enter 跳章。
 * 目录本身是几百章的长列表，翻侧栏找一章很费劲；这个浮层是伪装语义里
 * 唯一「越像 GitHub、越好用」的控件，所以它必须是真的。
 */

const GH_FINDER_MAX_ROWS = 50;

let ghFinderEl = null;

let ghFinderMatches = [];

let ghFinderIndex = 0;

let ghFinderGlobalBound = false;

let ghFinderCacheItems = null;

let ghFinderCacheSource = [];

// 几百个章节的映射只做一次：目录数组引用不变就复用（每敲一个键全量 map 没必要）
function ghFinderSource() {
  const items = ghCollectCatalogItems();
  if (items === ghFinderCacheItems) return ghFinderCacheSource;
  ghFinderCacheItems = items;
  ghFinderCacheSource = items
    .map((el, i) => ({ el, i, text: (el.textContent || '').trim() }))
    .filter((item) => item.text);
  return ghFinderCacheSource;
}

// 包含匹配优先（「第三章」直接命中），再补子序列匹配（「第3章」这种跳字），
// 两段都按目录原序，不做拼音（中文书名拼音库不值得为它引进来）。
function ghFinderFilter(all, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return all.slice();
  const direct = [];
  const loose = [];
  all.forEach((item) => {
    const text = item.text.toLowerCase();
    if (text.includes(q)) {
      direct.push(item);
      return;
    }
    let cursor = 0;
    for (const ch of text) {
      if (ch === q[cursor]) cursor += 1;
      if (cursor >= q.length) break;
    }
    if (cursor >= q.length) loose.push(item);
  });
  return direct.concat(loose);
}

function ghFinderScrollActiveIntoView() {
  const active = ghFinderEl?.querySelector('.wre-gh-finder-active');
  active?.scrollIntoView?.({ block: 'nearest' });
}

function ghRenderFinder(query) {
  const el = ghFinderEl;
  if (!el) return;
  const list = el.querySelector('#wre-gh-finder-list');
  const count = el.querySelector('#wre-gh-finder-count');
  if (!list) return;

  ghFinderMatches = ghFinderFilter(ghFinderSource(), query).slice(0, GH_FINDER_MAX_ROWS);
  ghFinderIndex = 0;

  list.innerHTML = ghFinderMatches.length
    ? ghFinderMatches.map((item, i) => `
      <div class="wre-gh-finder-row${i === 0 ? ' wre-gh-finder-active' : ''}" data-idx="${i}">
        ${WRE_SVG.file}
        <span class="wre-gh-finder-name">${ghEscapeHtml(ghChapterFileName(item.text))}</span>
        <span class="wre-gh-finder-path">docs</span>
      </div>`).join('')
    : '<div class="wre-gh-finder-empty">No matching files</div>';

  if (count) {
    const n = ghFinderMatches.length;
    count.textContent = n === 1 ? '1 result' : `${n} results`;
  }
  ghFinderScrollActiveIntoView();
}

function ghMoveFinderIndex(delta) {
  if (!ghFinderMatches.length) return;
  ghFinderIndex = (ghFinderIndex + delta + ghFinderMatches.length) % ghFinderMatches.length;
  const rows = ghFinderEl.querySelectorAll('.wre-gh-finder-row');
  rows.forEach((row, i) => row.classList.toggle('wre-gh-finder-active', i === ghFinderIndex));
  ghFinderScrollActiveIntoView();
}

async function ghOpenFinderChapter(item) {
  if (!item) return;
  ghCloseFinder();
  await ghJumpChapter(item.text, { index: item.i, source: '查找器' });
}

function ghActivateFinderIndex() {
  const item = ghFinderMatches[ghFinderIndex];
  if (item) ghOpenFinderChapter(item);
}

function ghBindFinderGlobal() {
  if (ghFinderGlobalBound) return;
  ghFinderGlobalBound = true;
  // 点浮层外面关闭：捕获阶段先判断，避免被骨架自己的点击处理吃掉
  document.addEventListener('mousedown', (event) => {
    if (!ghFinderIsOpen()) return;
    if (ghFinderEl.contains(event.target)) return;
    ghCloseFinder();
  }, true);
}

function ghEnsureFinder() {
  if (ghFinderEl && ghFinderEl.isConnected) return ghFinderEl;
  const shell = document.getElementById('wre-gh-shell');
  if (!shell) return null; // 只有伪装态才有骨架

  const el = document.createElement('div');
  el.id = 'wre-gh-finder';
  el.innerHTML = `
    <div class="wre-gh-finder-box">
      <div class="wre-gh-finder-head">
        ${WRE_SVG.search}
        <input id="wre-gh-finder-input" type="text" placeholder="Go to file"
          spellcheck="false" autocomplete="off" aria-label="Go to file">
        <kbd>esc</kbd>
      </div>
      <div class="wre-gh-finder-list" id="wre-gh-finder-list"></div>
      <div class="wre-gh-finder-foot">
        <span id="wre-gh-finder-count">0 results</span>
        <span>↑↓ 选择 · Enter 打开</span>
      </div>
    </div>`;
  shell.appendChild(el);

  const input = el.querySelector('#wre-gh-finder-input');
  input.addEventListener('input', () => ghRenderFinder(input.value));
  input.addEventListener('keydown', (event) => {
    // 输入框内的键不冒泡给全局快捷键（全局那份会因 activeElement 是 input 直接返回，
    // 但 Esc / 方向键得在这里自己处理）
    if (event.key === 'Escape') {
      event.preventDefault();
      ghCloseFinder();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      ghMoveFinderIndex(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      ghActivateFinderIndex();
    }
  });

  el.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.target === el) {
      ghCloseFinder();
      return;
    }
    const row = event.target.closest?.('.wre-gh-finder-row');
    if (!row) return;
    const idx = Number(row.dataset.idx);
    if (Number.isFinite(idx)) ghOpenFinderChapter(ghFinderMatches[idx]);
  });

  ghBindFinderGlobal();
  ghFinderEl = el;
  return el;
}

function ghFinderIsOpen() {
  return !!ghFinderEl && ghFinderEl.isConnected && ghFinderEl.classList.contains('wre-visible');
}

function ghOpenFinder() {
  if (!WRE_STATE.disguise) return false;
  const el = ghEnsureFinder();
  if (!el) return false;
  const input = el.querySelector('#wre-gh-finder-input');
  el.classList.add('wre-visible');
  ghRenderFinder('');
  if (input) {
    input.value = '';
    try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
  }
  log('info', '打开章节查找器', { chapters: ghFinderMatches.length });
  return true;
}

function ghCloseFinder() {
  if (!ghFinderEl) return;
  ghFinderEl.classList.remove('wre-visible');
  ghFinderEl.querySelector('#wre-gh-finder-input')?.blur?.();
}

// j / k：伪装态按目录顺序跳到上/下一章。
// 定位不到当前章就不猜（宁可提示，也不跳到错误的地方）。
async function ghStepChapter(dir) {
  if (!WRE_STATE.disguise) return false;
  const items = ghCollectCatalogItems();
  if (!items.length) {
    ghToast('目录还没加载好，稍后再试');
    return false;
  }
  const idx = ghCurrentChapterIndex(items); // 与侧栏高亮、窗口标题同一判据
  if (idx < 0) {
    ghToast('定位不到当前章节，可先按 / 搜索');
    return false;
  }
  const target = idx + dir;
  if (target < 0 || target >= items.length) {
    ghToast(dir < 0 ? '已经是第一章' : '已经是最后一章');
    return false;
  }
  const label = (items[target].textContent || '').trim();
  const result = await ghJumpChapter(label, { index: target, source: 'j/k 翻章' });
  return result.ok;
}
