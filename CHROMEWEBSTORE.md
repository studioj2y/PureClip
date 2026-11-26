# Chrome Web Store Listing — PureClip · 素笺

> Last Updated: 2026-11-26

## Store Listing

**Extension Name** [REQUIRED]
PureClip · 素笺

**Short Description** [REQUIRED]
纯净网页剪藏与高可读性排版归档工具：实时提取正文、剔除广告杂质、划词高亮备注，并按分类保存为离线 HTML、Markdown 或高清 PDF。

**Detailed Description** [REQUIRED]
PureClip · 素笺是一款注重本地隐私与阅读美感的网页剪藏扩展，帮助你将值得留存的网页文章转化为干净、可长期保存的离线资料。

核心功能：
• 实时页面提纯：在当前网页直接提取已完成渲染的正文内容（支持登录后与展开后的页面），自动过滤广告、推荐栏、评论区与干扰脚本。
• 三种截取方式：智能识别正文、鼠标悬停框选页面区块（支持多选拼接与扩大/缩小选区），以及仅剪藏鼠标涂黑选中的内容。
• 高可读性排版：内置纯白省墨、素笺护眼、夜间深色主题，自由切换字体、字号、行距、页边距，并可一键开关图片、代码块与原文溯源信息头。
• 重点高亮与备注：在阅读视图中直接用三色荧光笔划重点，或在顶部写下个人备注，随文一并归档或打印。
• 三种格式与分类保存：支持单文件离线 HTML（图片内嵌永不裂图）、Markdown（自动整理配图文件夹）与高清矢量 PDF 打印导出；可绑定本地总目录按分类子文件夹一键归档。
• 重复剪藏提醒：再次打开已剪藏过的网页时在图标显示「已存」提示，支持搜索与筛选本地剪藏历史。

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
Extract clean readable content from web pages, format it with highlights and notes, and archive it locally in organized categories.

**Primary Language** [REQUIRED]
Chinese (Simplified)

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `src/icons/icon-128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 or 640×400 | ⬜ Not created | |
| Screenshot 2 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not created | |

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `activeTab` | permissions | Grants temporary access to the active tab when the user clicks the extension icon to extract article text and images from the current page. |
| `tabs` | permissions | Reads the active tab URL to check whether the current webpage has already been clipped in local history and displays the "已存" badge, and opens the local history/settings manager tab. |
| `scripting` | permissions | Injects the on-demand article extractor, interactive block picker, and isolated reading overlay into the current webpage when activated by the user. |
| `storage` | permissions | Stores user typography preferences, custom category folder names, and local clip history entries on the user's device. |
| `downloads` | permissions | Saves exported offline HTML, Markdown, and image assets into organized category subfolders or prompts a "Save As" file dialog. |
| `contextMenus` | permissions | Adds an entry on the extension toolbar icon's right-click menu to open the clip history and local folder settings page. |
| `<all_urls>` | host_permissions | Allows fetching cross-origin or hotlink-protected article images inside the extension background context with user credentials so saved offline files display images reliably, and enables checking tab URLs against local clip history for duplicate reminders. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

All extracted webpage content, highlights, notes, preferences, and clip history remain strictly local on the user's device (`chrome.storage.local` and user-chosen local folders). No data is transmitted to developer servers or third parties.

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL** [REQUIRED]
https://github.com/studioj2y/PureClip/blob/main/PRIVACY.md

## Distribution

**Visibility**: Public
**Regions**: All regions

## Developer Info

**Support URL / Email** [RECOMMENDED]
https://github.com/studioj2y/PureClip/issues

**Homepage URL** [RECOMMENDED]
https://github.com/studioj2y/PureClip

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.0.0 | 2026-11-26 | Initial release with Chromium & Firefox MV3 support | Draft |
