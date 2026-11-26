# PureClip · 素笺

**PureClip（素笺）** 是一款零编译、注重隐私的开源网页剪藏与高可读性排版归档扩展，原生支持 **Chrome / Edge（Chromium MV3）** 与 **Firefox（WebExtensions MV3）**。

它从浏览器当前标签页**已渲染完成的实时 DOM** 提取内容，因此能够顺畅处理需要登录、验证交互、「展开全文」以及动态加载的网页；自动剔除广告、侧栏、推荐流与底层冗余脚本样式，将文章、表格、代码块与配图整理成如纸质书刊般干净的阅读与打印版式，并按分类直存到本地文件夹。

---

## 核心特性

- **无视登录墙的实时提取**：直接提取当前页面已完成渲染的 DOM（非服务端重新抓取），登录后台、论坛长帖与动态页面均可正常剪藏。
- **三种提取范围**：
  - **智能正文**：基于实时可见性（`getComputedStyle`）与语义密度评分提纯正文。
  - **框选区域**：鼠标悬停瞄准区块，支持 `Shift` 多选拼接及 `↑` / `↓` 扩大缩小范围。
  - **涂黑选区**：页面划选文字后点击插件直接仅剪藏选中片段，支持一键切回全文。
- **防裂图与代码净化**：唤醒 `data-src` / `srcset` 等懒加载图片，通过页面 Canvas 与后台带 Cookie 补抓将图片内嵌为离线数据；智能保留正文 `<pre><code>` 并剥离行号伪列，附带「显示配图 / 显示代码块 / 原文溯源头」一键开关。
- **高可读性排版与批注**：
  - 主题切换（纯白省墨 / 素笺护眼 / 夜间深色）、字体切换（黑体 / 宋体 / 楷体）、字号、行距、页边距调节。
  - 正文支持**三色荧光笔划词高亮**（琥珀黄 / 竹青绿 / 晴空蓝）与顶部**素笺个人备注**。
  - 针对 `@media print` 深度优化：自动解除多页截断、切换白底省墨配色、保留高亮底纹，并防止图片/表格/代码块跨页腰斩。
- **三格式导出与本地分类整理**：
  - **离线单文件 HTML**：内嵌完整排版与图片数据，断网永不裂图。
  - **Markdown (GFM)**：保存到本地分类目录时自动将配图拆分存至同级 `./assets/<文章短名>/`，正文保持轻量整洁。
  - **高清矢量 PDF**：自动同步清洗后的文件名，唤起浏览器原生分页打印预览。
  - **灵活归档路径**：Chromium 支持绑定任意本地总目录直存子文件夹；Firefox 支持下载目录分类子文件夹直存；双端均支持「另存为…」自由手选任意磁盘位置。
- **重复剪藏提醒与本地历史库**：自动归一化网址（剔除 `utm_*`、`spm` 等追踪参数），再次访问已剪藏页面时在插件图标展示 `已存` 绿色角标，并提供可搜索的历史记录面板。

---

## 安装与使用（双端免编译构建）

### 1. 获取源码与构建产物

项目采用零第三方依赖的 Python 构建脚本（需要 Python 3.10+ 与 `Pillow`）：

```bash
git clone https://github.com/studioj2y/PureClip.git
cd PureClip
python build.py
```

执行后会在 `dist/` 下生成：
- `dist/chromium/` 与 `dist/pureclip-chromium.zip`
- `dist/firefox/` 与 `dist/pureclip-firefox.zip`

### 2. 在 Chrome / Edge 加载

1. 打开 `chrome://extensions`（或 Edge 中的 `edge://extensions`）。
2. 开启右上角 **开发者模式**。
3. 点击 **加载已解压的扩展程序**，选择 `dist/chromium` 目录。
4. （可选）右键点击浏览器右上角的 **素笺** 图标 -> **打开素笺历史与本地目录设置**，绑定你的本地总归档文件夹（如 `D:\阅读归档`）。

### 3. 在 Firefox 加载

1. 打开 Firefox，地址栏输入 `about:debugging#/runtime/this-firefox`。
2. 点击 **临时载入附加组件...**。
3. 选择 `dist/firefox/manifest.json`（或直接选择打包好的 `dist/pureclip-firefox.zip`）。
4. （推荐）进入扩展管理页点击「授权全站防盗链图片补抓」，以在微信公众号/知乎等防盗链站点获得最佳离线图片效果。

---

## 目录结构

```text
PureClip/
├── build.py                     # 双端构建与 ZIP 打包脚本（含图标生成）
├── src/
│   ├── background/
│   │   └── service-worker.js    # 后台入口：图标点击、URL查重角标、防盗链图片补抓、下载路由
│   ├── content/
│   │   ├── extractor.js         # 实时 DOM 提纯、懒加载唤醒与代码块清洗引擎
│   │   ├── picker.js            # 交互式鼠标框选区域工具
│   │   └── host-overlay.js      # Shadow DOM 页内全屏隔离容器与消息桥
│   ├── shared/
│   │   ├── ext-api.js           # Chromium / Firefox WebExtension API 兼容层
│   │   ├── utils.js             # URL 归一化、安全文件名、分块 Base64 工具
│   │   ├── storage-db.js        # 偏好/分类/历史存储 & IndexedDB 本地目录句柄管理
│   │   └── exporters.js         # 离线 HTML 与 Markdown（含本地配图拆包）导出器
│   └── ui/
│       ├── reader.{html,css,js} # 素笺阅读排版、荧光笔高亮与打印视图
│       └── manager.{html,css,js}# 本地总目录绑定桥、分类管理与历史检索页
└── tests/
    └── test_pureclip.py         # 构建产物、MV3 CSP 合规性及打包完整性验证测试
```

---

## 演进路线（Roadmap）

PureClip 坚持「本地优先（Local-First）」原则，下一步将逐步引入主流网盘与知识库直连同步（详见 [ROADMAP.md](ROADMAP.md)）：

- **v1.1 — 浏览器辅助增强**：键盘全局快捷键、`@media print` 手动分页微调选项、多标签页批量剪藏。
- **v1.2 — Google Drive 云端直连**：支持 `chrome.identity` / OAuth2 PKCE 授权，在归档时直接将 HTML / Markdown（含 `assets/`）与 PDF 上传至指定 Google Drive 文件夹并维护分类目录映射。
- **v1.3 — 主流网盘与开放协议同步**：
  - **OneDrive**（Microsoft Graph API 分块上传）
  - **Dropbox**（Content API 增量同步）
  - **WebDAV**（原生支持 **坚果云 / Nextcloud / 群晖 NAS** 等私有云，配置账户与应用密码即可直传）
  - **S3 兼容对象存储**（Cloudflare R2 / MinIO / AWS S3，适合长期静态归档）
- **v1.4 — 笔记生态互通**：Obsidian Vault 双向链接格式模板、Notion API 区块直投、剪藏历史跨设备索引同步。

---

## 开源协议

基于 [MIT License](LICENSE) 开源，欢迎在 [GitHub Issues](https://github.com/studioj2y/PureClip/issues) 提交建议与问题，或提交 Pull Request！
