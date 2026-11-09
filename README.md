# GitHub Reader - 微信读书摸鱼伪装插件

专为微信读书网页版（weread.qq.com）打造的**摸鱼伪装**浏览器扩展：把阅读页伪装成 GitHub 仓库浏览代码文件的样子，上班看书不露馅。纯本机运行，不上传任何数据，不依赖任何后台服务。

<p>
  <img src="https://img.shields.io/badge/许可-GPLv3-2F6BFF" alt="GPL-3.0 License">
  <img src="https://img.shields.io/badge/隐私-零上传-2F6BFF" alt="隐私声明">
</p>

## 功能

- **GitHub 伪装视图**：阅读页默认呈现 GitHub 仓库页样子——深色顶栏（logo / 假搜索框 / 通知）、面包屑（`dev-lab/书名` + Public 徽章 + Code/Issues 页签）、左侧伪文件树、文件头（章节名.md · N lines · Raw/Copy），微信读书正文重绘为 GitHub Markdown 文件卡片（1012px 白底圆角卡片居中）。打开设置走顶栏头像（GitHub 原生交互，零暴露）
- **两套伪装皮肤**：GitHub 代码仓库页 / Notion 团队文档页（白底、面包屑、左侧页面树），弹窗里一键切换，标题与图标同步更换
- **正文背景色**：16 种预设（浅色 ≈ GitHub Light，深色 ≈ GitHub Dark），设置面板 ‹ › 循环
- **快捷键 G**：伪装 ↔ 微信读书原样 一键切换（输入框聚焦时不触发）
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

## 项目结构

```
weread-enhancer/
│
├── manifest.json          # 扩展入口
├── content.js             # 全部逻辑：伪装骨架 / 背景色 / 快捷键 / 状态存储
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
