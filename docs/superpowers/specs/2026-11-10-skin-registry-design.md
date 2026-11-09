# 设计文档：皮肤注册表（两套皮肤能力对等）

日期：2026-11-10
状态：已实现
版本：v0.42.0

## 一、问题

`skin` 是散在三个文件里的分支：

- `catalog.js`：`ghEnsureShell()` 里 `skin === 'notion' ? ghShellHtmlNotion() : ghShellHtmlGithub()`；
  `ghRenderCatalogTree()` 开头 `if (wreCurrentSkin() !== 'github') return`；
- `chrome.js`：`ghIdentityTarget()` / `ghSyncChapterIdentity()` 各写一遍 notion 的标题与面包屑；
- `content.css`：`html[data-wre-skin="notion"] …` 一堆覆盖。

后果是**能力不对等**：GitHub 皮肤的左侧树是真实章节、可点跳章；Notion 皮肤是 8 个静态假文档，
点不动、跳不了章 —— 同一个功能的两个版本，其中一个还是假的。

## 二、方案

新增 `content/disguise/skins.js`（排在 `catalog.js` 之后），一个皮肤 = 一个描述对象：

| 字段 | 作用 |
|---|---|
| `id` / `label` | 状态值 + 设置面板按钮文案 |
| `shellHtml()` | 骨架结构（GitHub 顶栏/仓库条 / Notion 顶栏/侧栏） |
| `treeSelector` / `fallbackTree()` | 侧栏目录落点 + 目录未就绪时的兜底树 |
| `treeItemHtml({index, chapter, active})` | 单行目录项（GitHub 是 `.md` + 文件图标，Notion 是页面名 + 灰方块） |
| `chipSelector` / `crumbSelector` | 「当前文件」显示在哪里 |
| `chapterText(label)` / `title(chapterText)` | 章名 → 显示名 → 窗口标题 |
| `favicon` | 标签页图标 |

调用方全部改成走 `wreSkinProfile()`：

- `ghEnsureShell()` 用 `profile.shellHtml()`；
- `ghRenderCatalogTree()` 用 `profile.treeSelector` / `treeItemHtml` / `fallbackTree`，
  并把 `profile.id` 加进渲染缓存签名（两套皮肤 DOM 结构不同，切皮肤必须重铺）；
- `ghIdentityTarget()` / `ghSyncChapterIdentity()` 用 `chapterText` / `title` / `chipSelector` / `crumbSelector`；
- 设置面板的皮肤按钮由 `wreSkinList()` 生成，加皮肤不用再改 HTML。

目录行的点击委托原来只认 `.wre-gh-tree-item[data-chapter]`，现在统一认
`.wre-tree-row[data-chapter]`（两套皮肤的目录行都带这个类）。

## 三、不变量

- 不新增权限 / 联网；CSS 的 `html[data-wre-skin="notion"]` 覆盖保留（皮肤外观仍由 CSS 管）。
- 目录采集、跳章、查找器、j/k 全部复用同一条链路，不为新皮肤另写一套。
- 目录为空时退回各自皮肤的兜底树（Notion 仍是那 9 个静态文档，只是不再是唯一形态）。

## 四、验收

1. GitHub 皮肤：左侧树是真实章节，当前章高亮，点击跳章。
2. 切到 Notion：左侧树**也是真实章节**，当前章高亮，点击同样跳章；标题/面包屑是页面名（不带 `.md`）。
3. 切回 GitHub：文件 chip 与标题恢复 `.md` 形态，树重新渲染。
4. 设置面板的 GitHub / Notion 按钮由注册表生成。
