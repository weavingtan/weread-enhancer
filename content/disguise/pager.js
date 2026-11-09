/* 伪分页条与原生翻章点击
 * 由 content.js 拆分而来：语句顺序与原文件一致，跨文件共享同一全局作用域。
 */

function ghDispatchPageKey(dir) {
  const forward = dir > 0;
  document.dispatchEvent(new KeyboardEvent('keydown', {
    key: forward ? 'ArrowRight' : 'ArrowLeft',
    code: forward ? 'ArrowRight' : 'ArrowLeft',
    keyCode: forward ? 39 : 37,
    which: forward ? 39 : 37,
    bubbles: true,
    cancelable: true,
  }));
}

function ghClickChapterNav(dir) {
  const forward = dir > 0;
  const words = forward ? ['下一章', '下一节', '下一卷', '下一页'] : ['上一章', '上一节', '上一卷', '上一页'];
  const clsRe = forward ? /(next|forward)/i : /(prev|back)/i;
  const clsExclude = forward ? /(prev|back)/i : /(next|forward)/i;
  const clicked = new Set();
  const tryClick = (el, tag) => {
    if (!el || clicked.has(el)) return false;
    // 命中的可能是 svg 图标（有 aria-label 但没有 click()），只能派发事件
    if (typeof el.dispatchEvent !== 'function' || typeof el.getBoundingClientRect !== 'function') return false;
    clicked.add(el);
    ghDispatchClick(el);
    log('info', '已通过伪分页条翻章', { dir, tag });
    return true;
  };

  const items = Array.from(document.querySelectorAll('.readerControls_item, [class*="readerControls"] [class*="item"]'));
  for (const el of items) {
    const cls = String(el.className || '');
    if (clsRe.test(cls) && !clsExclude.test(cls) && tryClick(el, `class:${cls}`)) return true;
  }

  for (const el of Array.from(document.querySelectorAll('[aria-label], [title]'))) {
    const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`;
    if (words.some((w) => label.includes(w)) && tryClick(el, `aria:${label.trim()}`)) return true;
  }

  const scopes = [
    document.querySelector('.readerFooter'),
    document.querySelector('[class*="readerFooter"]'),
    document.querySelector('.readerControls'),
    document.querySelector('[class*="readerBottom"]'),
  ].filter(Boolean);
  for (const scope of scopes) {
    for (const el of Array.from(scope.querySelectorAll('button, [role="button"], [class*="button"], span, div, a'))) {
      const text = (el.textContent || '').trim();
      if (!words.includes(text)) continue;
      if (el.querySelector('button, span, div, a')) continue;
      if (tryClick(el, `text:${text}`)) return true;
    }
  }

  const bottom = document.querySelector('[class*="readerBottom"], .readerFooter, [class*="readerFooter"]');
  if (bottom) {
    const btns = Array.from(bottom.querySelectorAll('button, [role="button"], [class*="button"]'))
      .filter((el) => !el.querySelector('button, [class*="button"]'));
    const target = forward ? btns[btns.length - 1] : btns[0];
    if (target && tryClick(target, 'bottom-first-last')) return true;
  }

  // 目录兜底：面板没开时行是 0 尺寸，先点底栏目录按钮把面板打开，点完再收回
  if (ghCatalogTrigger()) {
    log('info', '翻章走目录兜底', { dir });
    (async () => {
      const opened = await ghOpenCatalogPanel();
      if (opened) {
        const list = ghCollectCatalogItems();
        const idx = ghCatalogActiveIndex(list);
        const next = idx >= 0 ? list[idx + (forward ? 1 : -1)] : null;
        if (next) {
          ghActivateCatalogItem(next);
          await ghSleep(600);
        }
        ghCloseCatalogPanel();
        if (next) return;
      }
      ghDispatchPageKey(dir); // 目录里定位不到当前章，退回按键翻页
    })();
    return true;
  }

  ghDispatchPageKey(dir);
  return false;
}

let ghPagerRaf = null;

// 分页条贴着正文卡片的左右边缘，而不是贴视口边缘：
// Previous 的左边缘对齐卡片左边、Next 的右边缘对齐卡片右边（大屏卡片居中时才不会「Next 飘在灰色空地里」）。
function ghAlignPagerToCard(pager) {
  const card = document.querySelector('.readerChapterContent');
  const vw = document.documentElement.clientWidth || window.innerWidth;
  if (!card) {
    pager.style.left = '';
    pager.style.right = '';
    return;
  }
  const rect = card.getBoundingClientRect();
  if (!rect || rect.width <= 0) return;
  pager.style.left = `${Math.max(8, Math.round(rect.left))}px`;
  pager.style.right = `${Math.max(8, Math.round(vw - rect.right))}px`;
}

function ghUpdatePager() {
  ghPagerRaf = null;
  const pager = document.querySelector('.wre-gh-pager');
  if (!pager) return;
  if (!document.documentElement.classList.contains('wre-disguise')) {
    pager.classList.remove('wre-pager-visible');
    return;
  }
  ghAlignPagerToCard(pager);
  if (ghIsDoubleColumn()) {
    pager.classList.add('wre-pager-visible');
    return;
  }
  const content = document.querySelector('.readerChapterContent');
  let scroller = null;
  let node = content?.parentElement;
  while (node && node !== document.body) {
    const overflowY = getComputedStyle(node).overflowY;
    if (/(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight + 10) {
      scroller = node;
      break;
    }
    node = node.parentElement;
  }
  const top = scroller ? scroller.scrollTop : window.scrollY;
  const viewport = scroller ? scroller.clientHeight : window.innerHeight;
  const total = scroller ? scroller.scrollHeight : (document.scrollingElement || document.documentElement).scrollHeight;
  pager.classList.toggle('wre-pager-visible', top + viewport >= total - 260);
}

function ghOnPagerScroll() {
  if (!ghPagerRaf) ghPagerRaf = requestAnimationFrame(ghUpdatePager);
}
