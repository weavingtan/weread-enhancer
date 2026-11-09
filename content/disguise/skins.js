/* 伪装皮肤注册表
 *
 * 一套皮肤 = 骨架 HTML + 侧栏目录渲染 + 「当前文件」身份（窗口标题 / 文件 chip / 面包屑）。
 * 以前这三件事散在 catalog.js 与 chrome.js 里按 skin 写死分支，后果是 Notion 皮肤的
 * 目录是假的（静态 8 个文档、点不动、不能跳章）。收进注册表后：
 *   - 两套皮肤走同一条目录 / 跳章 / 身份链路，能力对等；
 *   - 加第三套（GitLab / Confluence / 内部工单系统）只需要在这里加一项。
 *
 * 注意：本文件必须排在 catalog.js 之后 —— 它引用了那里的骨架与兜底树构造函数。
 */

const WRE_SKINS = {
  github: {
    id: 'github',
    label: 'GitHub',
    shellHtml: () => ghShellHtmlGithub(),
    fallbackTree: () => ghFallbackTreeHtml(),
    treeSelector: '.wre-gh-tree',
    // 「当前文件」在界面上的落点：GitHub 是仓库条右侧的文件 chip
    chipSelector: '.wre-gh-file-chip-label',
    crumbSelector: null,
    // 章的文本 → 显示名（GitHub 用 .md 文件名）
    chapterText: (label) => (label ? ghChapterFileName(label) : WRE_GH_FILE),
    title: (chapterText) => `${chapterText} at main · ${WRE_GH_OWNER}/${WRE_GH_REPO}`,
    favicon: WRE_GH_FAVICON,
    treeItemHtml: ({ index, chapter, active }) => `
   <div class="wre-gh-tree-item wre-tree-row${active ? ' wre-gh-tree-active' : ''}"
     data-catalog="${index}" data-chapter="${ghEscapeHtml(chapter)}">
     ${WRE_SVG.file}
     <span>${ghEscapeHtml(ghChapterFileName(chapter))}</span>
   </div>`,
  },

  notion: {
    id: 'notion',
    label: 'Notion',
    shellHtml: () => ghShellHtmlNotion(),
    fallbackTree: () => ghFallbackNotionTreeHtml(),
    treeSelector: '.wre-nb-tree',
    // Notion 首页没有文件 chip，当前页名落在面包屑最后一段
    chipSelector: null,
    crumbSelector: '.wre-nb-crumb',
    // Notion 的页面名不带扩展名
    chapterText: (label) => label || WRE_NB_PAGE,
    title: (chapterText) => `${chapterText} · ${WRE_NB_TEAM}`,
    favicon: WRE_NB_FAVICON,
    treeItemHtml: ({ index, chapter, active }) => `
    <div class="wre-nb-tree-item wre-tree-row${active ? ' wre-nb-tree-active' : ''}"
      style="padding-left:10px" data-catalog="${index}" data-chapter="${ghEscapeHtml(chapter)}">
      <span class="wre-nb-doc"></span><span>${ghEscapeHtml(chapter)}</span>
    </div>`,
  },
};

function wreSkinList() {
  return Object.values(WRE_SKINS);
}

function wreSkinProfile() {
  return WRE_SKINS[wreCurrentSkin()] || WRE_SKINS.github;
}
