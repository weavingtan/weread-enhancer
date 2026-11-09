# GitHub Reader - 微信读书摸鱼伪装插件

专为微信读书网页版（weread.qq.com）打造的**摸鱼伪装**浏览器扩展：把阅读页伪装成 GitHub 仓库浏览代码文件的样子，上班看书不露馅。纯本机运行，不上传任何数据，不依赖任何后台服务。

<p>
  <img src="https://img.shields.io/badge/许可-GPLv3-2F6BFF" alt="GPL-3.0 License">
  <img src="https://img.shields.io/badge/隐私-零上传-2F6BFF" alt="隐私声明">
</p>

## 功能

- **GitHub 伪装视图**：阅读页默认呈现 GitHub 仓库页样子——深色顶栏（logo / 假搜索框 / 通知）、面包屑（`dev-lab/书名` + Public 徽章 + Code/Issues 页签）、左侧伪文件树、文件头（章节名.md · N lines · Raw/Copy），微信读书正文重绘为 GitHub Markdown 文件卡片（1012px 白底圆角卡片居中）。打开设置走顶栏头像（GitHub 原生交互，零暴露）
- **两套伪装皮肤**：GitHub 代码仓库页 / Notion 团队文档页（白底、面包屑、左侧页面树），弹窗里一键切换，标题与图标同步更换
- **当前文件跟着真章节走**：窗口标题、顶栏文件 chip、Notion 面包屑都取当前章的文件名（`第二章 承.md at main · dev-lab/notes`），切章 / 切皮肤 / 进出伪装都会同步
- **正文背景色**：16 种预设（浅色 ≈ GitHub Light，深色 ≈ GitHub Dark），设置面板 ‹ › 循环
- **快捷键 G**：伪装 ↔ 微信读书原样 一键切换（输入框聚焦时不触发）
- **章节查找器**：伪装态按 `/` 或 `t`（也可点顶栏那个假搜索框）打开 GitHub 风格的 Go to file，输入章节名回车跳章；`j` / `k` 直接上下一章。几百章的书不用再翻侧栏
- **设置记忆**：伪装开关、背景色档位自动保存，刷新后恢复
- **两种阅读模式**：滚动模式正文重绘为 Markdown 卡片；双栏翻页模式（Canvas）整块内容做成文件卡片（Canvas 字体无法更改，翻页用 ← → 键）
- **设置入口**：插件工具栏弹窗（伪装开关 + 背景色），不依赖伪装态；伪装态内也可点顶栏假头像打开面板
- **安全降级**：正文未就绪保持原样（fail-safe），绝不出现半伪装破页面

## 安装方式（开发模式）

1. 打开浏览器，地址栏输入 `edge://extensions/`（Chrome 为 `chrome://extensions/`）
2. 开启「开发人员模式」
3. 点击「加载解压缩的扩展」
4. 选择本项目的根目录（包含 `manifest.json` 的文件夹）
5. 打开 https://weread.qq.com 用**滚动模式**打开一本书，即自动进入伪装视图；按 `G` 可切回原样

## 排查开关

URL 后面加两个 hash 就行，不占界面、不需要重新安装：

- `#wre-off`：强制关闭伪装（页面显示异常时的逃生口）
- `#wre-debug`：打开详细控制台日志（默认只输出 warn / error，info 级全静默）

如果控制台出现「15 秒内页面被重复加载」，看它带的 `reflowSincePrevBoot`：
大于 0 说明插件在上次重载前派发过 resize（要怀疑插件），等于 0 说明是微信读书自己刷新的页面。

## 项目结构

```
weread-enhancer/
│
├── manifest.json          # 扩展入口（按顺序声明 content/ 下各模块）
├── content/               # content script 模块（无构建，共享全局作用域，按 manifest 顺序加载）
│   ├── core.js            # 常量 / 状态 / 存储 / 日志 / 元素定位
│   ├── layout.js          # 样式表与屏占比（工具栏浮动、自绘滚动条）
│   ├── features/          # 沉浸模式、自动阅读、主题背景色、Canvas 自愈、快捷键
│   ├── ui.js              # 设置面板与事件绑定
│   ├── disguise/          # GitHub / Notion 伪装：骨架、目录跳章、标签页身份、伪分页、生命周期
│   └── boot.js            # init（状态→主题→面板→伪装→屏占比就绪轮询），必须最后加载
├── content.css            # 伪装样式（html.wre-disguise 总开关）+ 设置面板样式
├── popup.html / popup.js / popup.css   # 工具栏弹窗
├── icons/                 # 插件图标
├── _locales/              # 多语言包（zh_CN / en）
├── pack.py                # 一键打包上架 zip（按 manifest 自动收集运行文件）
└── README.md
```

没有 background service worker、没有主机权限、没有远程请求——伪装所需的 GitHub 样式全部内嵌手写 CSS，logo 为内联 SVG 占位。

## 打包

```bash
python3 pack.py
# 产物：release/weread-enhancer-v<版本号>.zip
```

## 隐私声明

本插件**不上传任何用户数据**：没有匿名统计、没有云端账户、没有任何后台服务、没有远程请求。全部设置只保存在浏览器本地存储（`chrome.storage.local`），卸载插件即彻底清除。
