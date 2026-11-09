# 设计文档：当前文件身份跟随真章节

日期：2026-11-10
状态：已实现
版本：v0.41.0

## 一、问题

伪装的身份是写死的：`WRE_GH_FILE = 'README.md'`、标题恒为 `README.md at main · dev-lab/notes`、
file chip 恒为 `README.md`。而侧栏文件树用的是**真实章节**。

结果自相矛盾：翻到第十二章，侧栏高亮 `第十二章.md`，顶部和标签页还写着 README.md。
熟 GitHub 的人一眼就能看出「这个仓库永远只有一个 README.md，树里却全是别的文件」。

## 二、方案

只改「身份」这一层，**不加任何新行、不动正文布局**：

1. `ghCurrentChapterLabel()`：当前章 = 目录里的高亮项（`.readerCatalog_list_item_selected`），
   退而求其次用 `ghCatalogActiveIndex()` 命中的项；都拿不到就返回空串。
   微信读书顶栏没有章名，只能从目录取。
2. 文件名沿用已有的 `ghChapterFileName()`（>26 字符截断 + 补 `.md`）。
3. 三处同步（`ghSyncChapterIdentity()`，改章节才写 DOM）：
   - GitHub：file chip 换成 `<文件图标> 第二章 承.md`；
   - 窗口标题：`第二章 承.md at main · dev-lab/notes`；
   - Notion：面包屑末段与标题换成章名（不带 `.md`）。
4. 拿不到章节时全部退回 `README.md` / `需求评审记录`，行为与改造前一致。
5. 进出伪装、切换皮肤、骨架重建都会重置 memo（`ghLastChapterFile`），保证新 DOM 被重写一遍。

## 三、刻意没做的事

- **不加 GitHub 的文件头行（`N lines · Raw · Copy · Blame`）**：原生顶栏只是 `opacity: 0` 占位，
  正文位置与原生完全一致；在 repobar 下再叠 44px 会把正文顶部盖住。
  要做就得改正文偏移，属于另一个量级的改动（且违背「不动正文布局」的不变量）。
- **不按书名重命名 repo**：收益只是好看一点，Chinese slug 反而可能显出「这不是 GitHub」。

## 四、验收

1. 打开阅读页：标题与 file chip 是当前章文件名（带 `.md`）。
2. 切章后两者同步变化；切到 Notion 皮肤后标题为「章名 · Acme 团队」、面包屑末段为章名。
3. 退出伪装标题还原为微信读书原生；重新进入恢复章名。
4. 目录未加载时退回 `README.md`，不出现空标题。
