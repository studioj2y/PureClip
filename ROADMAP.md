# PureClip · 素笺 演进路线图 (Roadmap)

本文档规划 **PureClip · 素笺** 从「本地高可读剪藏归档工具」向「多端云盘与个人知识库无缝同步工具」演进的技术路线。所有云端同步能力均保持 **可选开启、零强制登录、端到端直连用户自有网盘（不经过任何第三方中转服务器）** 的隐私原则。

---

## Phase 1 — v1.0（已完成：本地优先与双端基础）

- [x] Chromium（Chrome / Edge）与 Firefox MV3 双端同源构建
- [x] 页内实时 DOM 提取（兼容登录态、展开全文、SPA 页面）
- [x] 智能正文 / 鼠标框选（多选与扩缩） / 涂黑选区三种模式
- [x] 懒加载图片还原与带 Cookie 防盗链离线内嵌
- [x] 三色荧光笔高亮、素笺备注、原文溯源头与极简排版控制栏
- [x] 单文件离线 HTML、Markdown（自动拆包 `assets/`）与矢量 PDF 打印导出
- [x] Chromium 任意本地总目录授权归档 + Firefox 下载目录子文件夹归档 + 另存为
- [x] URL 归一化查重（`已存` 角标）与本地历史检索库

---

## Phase 2 — v1.1（阅读与打印精细化）

- [ ] **全局快捷键支持**：通过 `commands` API 注册快捷键（如 `Alt+S` 一键进入素笺、`Alt+Shift+P` 快速框选）。
- [ ] **长文大纲跳转**：自动提取 `H1–H3` 生成可折叠悬浮目录（默认收起，保持阅读页清爽）。
- [ ] **增强表格与数学公式**：支持 KaTeX / MathML 公式提取为 LaTeX `$...$` Markdown 语法。

---

## Phase 3 — v1.2（Google Drive 原生直连同步）

- [ ] **双端 OAuth 认证架构**：
  - Chromium：优先支持 `chrome.identity.getAuthToken`（内置默认 Client ID 或用户自定义 Client ID）。
  - Firefox & 通用 PKCE：`launchWebAuthFlow` + OAuth2 PKCE，安全获取短期 Access Token。
- [ ] **Google Drive 分类目录映射**：
  - 在 Google Drive 根目录创建并定位 `PureClip_素笺/<分类名>/` 文件夹树。
  - 利用 Drive `files` Multipart Upload API 一键上传离线 HTML、Markdown 及 `assets/` 配图。
  - 支持「仅本地保存 / 仅传 Drive / 本地与 Drive 双备份」三种归档策略切换。

---

## Phase 4 — v1.3（主流网盘与通用协议扩展）

采用统一的 `StorageProvider` 抽象接口，让不同网盘插件化接入同一套归档队列与断点重试机制：

| 目标网盘 / 协议 | 认证方式 | 适用人群 | 规划重点 |
| :--- | :--- | :--- | :--- |
| **WebDAV** | 用户名 + 应用专用密码 | 坚果云、Nextcloud、OwnCloud、群晖/威联通 NAS | 零 OAuth 门槛、国内网络直连稳定、`MKCOL` 自动建分类目录 |
| **OneDrive** | Microsoft OAuth2 PKCE | Windows / Office 365 用户 | Graph API `/me/drive/root:/PureClip/...:/content` 直传与大文件分片 |
| **Dropbox** | Dropbox OAuth2 PKCE | 跨平台极简同步用户 | `/2/files/upload` 配合路径自动覆盖/重命名策略 |
| **S3 兼容存储** | AccessKey + 预签名本地构造 | Cloudflare R2、AWS S3、MinIO 自建 | 极低成本静态归档，支持直接生成可分享预览链接 |

---

## Phase 5 — v1.4（笔记软件与跨设备索引）

- [ ] **Obsidian 专属适配**：自动生成符合 Obsidian Properties 的 YAML Frontmatter（`source`, `author`, `tags`, `clipped`）与 `![[img-01.png]]` 附件引用风格。
- [ ] **Notion API 投递**：配置 Integration Token 与目标 Database ID，直接将提纯正文与高亮批注转换为 Notion Blocks。
- [ ] **剪藏历史增量同步**：利用网盘内的 `.pureclip-index.json` 在多台电脑间同步「已存」URL 查重记录，换设备浏览也能看到某篇文章此前已在另一台设备归档过。
