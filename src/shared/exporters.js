/**
 * Exporters for PureClip:
 *  - Standalone self-contained offline HTML (with embedded typography & print CSS)
 *  - GitHub-Flavored Markdown (with optional local asset extraction to ./assets/<slug>/)
 */

import { dataUrlToParts, escapeHtml, formatDateTime, sanitizeFilename } from './utils.js';

export const HIGHLIGHT_COLORS = {
  amber: { bg: '#fef08a', label: '琥珀黄' },
  mint: { bg: '#bbf7d0', label: '竹青绿' },
  sky: { bg: '#bae6fd', label: '晴空蓝' }
};

const THEME_VARS = {
  white: {
    pageBg: '#f3f4f6',
    paperBg: '#ffffff',
    text: '#111827',
    muted: '#4b5563',
    border: '#e5e7eb',
    codeBg: '#f8fafc',
    quoteBg: '#f9fafb',
    accent: '#0f766e'
  },
  paper: {
    pageBg: '#ece7da',
    paperBg: '#faf7ef',
    text: '#292524',
    muted: '#57534e',
    border: '#e2dac8',
    codeBg: '#f2ece0',
    quoteBg: '#f4efe4',
    accent: '#0f766e'
  },
  dark: {
    pageBg: '#09090b',
    paperBg: '#18181b',
    text: '#e4e4e7',
    muted: '#a1a1aa',
    border: '#27272a',
    codeBg: '#27272a',
    quoteBg: '#202024',
    accent: '#2dd4bf'
  }
};

const FONT_STACKS = {
  sans: '"PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, -apple-system, sans-serif',
  serif: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", Georgia, serif',
  kai: '"LXGW WenKai", "Kaiti SC", "KaiTi", "STKaiti", Georgia, serif'
};

const MARGIN_MAP = {
  compact: { pad: '28px 36px', printMm: '10mm' },
  normal: { pad: '48px 56px', printMm: '16mm' },
  wide: { pad: '64px 76px', printMm: '24mm' }
};

/**
 * Applies user visibility toggles (images, code blocks) onto a cloned DOM container.
 * @param {string} bodyHtml
 * @param {object} prefs
 * @returns {Document}
 */
function parseAndFilterBody(bodyHtml, prefs) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div id="pc-root">${bodyHtml || ''}</div>`, 'text/html');
  const root = doc.getElementById('pc-root');

  if (!prefs.showImages) {
    root.querySelectorAll('img, picture').forEach((el) => el.remove());
    root.querySelectorAll('figure').forEach((fig) => {
      if (!fig.textContent.trim()) fig.remove();
    });
  }

  if (!prefs.showCodeBlocks) {
    root.querySelectorAll('pre').forEach((el) => el.remove());
  }

  // Strip any transient UI classes while preserving highlight color data.
  root.querySelectorAll('mark.pc-mark').forEach((mark) => {
    const color = mark.getAttribute('data-color') || 'amber';
    if (!HIGHLIGHT_COLORS[color]) {
      mark.setAttribute('data-color', 'amber');
    }
  });

  return { doc, root };
}

/**
 * Generates a complete, offline-ready HTML5 file mirroring the reader's typography and print rules.
 * @param {object} article
 * @param {object} renderState
 * @returns {string}
 */
export function buildStandaloneHtml(article, renderState) {
  const prefs = renderState.prefs;
  const theme = THEME_VARS[prefs.theme] || THEME_VARS.paper;
  const font = FONT_STACKS[prefs.fontFamily] || FONT_STACKS.serif;
  const margin = MARGIN_MAP[prefs.pageMargin] || MARGIN_MAP.normal;
  const { root } = parseAndFilterBody(renderState.bodyHtml, prefs);

  const title = renderState.title?.trim() || article.title || '未命名素笺';
  const noteText = String(renderState.noteText || '').trim();
  const clippedStr = formatDateTime(article.clippedAt);

  const metaSection = prefs.showMetaHeader
    ? `<header class="pc-meta">
        <div class="pc-meta-row">
          ${article.siteName ? `<span><strong>来源：</strong>${escapeHtml(article.siteName)}</span>` : ''}
          ${article.author ? `<span><strong>作者：</strong>${escapeHtml(article.author)}</span>` : ''}
          <span><strong>剪藏时间：</strong>${escapeHtml(clippedStr)}</span>
        </div>
        ${
          article.url
            ? `<div class="pc-meta-url"><strong>原文链接：</strong><a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.url)}</a></div>`
            : ''
        }
      </header>`
    : '';

  const noteSection = noteText
    ? `<aside class="pc-note">
        <div class="pc-note-title">素笺备注</div>
        <div class="pc-note-body">${escapeHtml(noteText).replace(/\n/g, '<br>')}</div>
      </aside>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="generator" content="PureClip · 素笺">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --pc-page-bg: ${theme.pageBg};
      --pc-paper-bg: ${theme.paperBg};
      --pc-text: ${theme.text};
      --pc-muted: ${theme.muted};
      --pc-border: ${theme.border};
      --pc-code-bg: ${theme.codeBg};
      --pc-quote-bg: ${theme.quoteBg};
      --pc-accent: ${theme.accent};
      --pc-font: ${font};
      --pc-size: ${Number(prefs.fontSize) || 18}px;
      --pc-lh: ${Number(prefs.lineHeight) || 1.8};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px 16px;
      background: var(--pc-page-bg);
      color: var(--pc-text);
      font-family: var(--pc-font);
      font-size: var(--pc-size);
      line-height: var(--pc-lh);
      -webkit-font-smoothing: antialiased;
    }
    .pc-sheet {
      max-width: 820px;
      margin: 0 auto;
      padding: ${margin.pad};
      background: var(--pc-paper-bg);
      border: 1px solid var(--pc-border);
      border-radius: 10px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.06);
    }
    h1.pc-title {
      margin: 0 0 18px;
      font-size: 1.75em;
      line-height: 1.32;
      font-weight: 700;
    }
    .pc-meta {
      padding: 12px 16px;
      margin-bottom: 22px;
      background: var(--pc-quote-bg);
      border-left: 3px solid var(--pc-accent);
      border-radius: 6px;
      font-size: 0.82em;
      line-height: 1.6;
      color: var(--pc-muted);
    }
    .pc-meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 20px;
    }
    .pc-meta-url {
      margin-top: 4px;
      word-break: break-all;
    }
    .pc-meta a { color: var(--pc-accent); text-decoration: none; }
    .pc-note {
      padding: 14px 18px;
      margin-bottom: 24px;
      background: rgba(254, 240, 138, 0.25);
      border: 1px solid rgba(202, 138, 4, 0.35);
      border-radius: 8px;
      font-size: 0.92em;
    }
    .pc-note-title {
      font-weight: 700;
      font-size: 0.85em;
      margin-bottom: 6px;
      color: var(--pc-accent);
    }
    .pc-body h1, .pc-body h2, .pc-body h3, .pc-body h4 {
      margin: 1.4em 0 0.6em;
      line-height: 1.35;
      break-after: avoid;
      page-break-after: avoid;
    }
    .pc-body p { margin: 0 0 1em; }
    .pc-body a { color: var(--pc-accent); text-underline-offset: 3px; }
    .pc-body img {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 1.2em auto;
      border-radius: 6px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .pc-body figure {
      margin: 1.2em 0;
      text-align: center;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .pc-body figcaption {
      margin-top: 6px;
      font-size: 0.84em;
      color: var(--pc-muted);
    }
    .pc-body blockquote {
      margin: 1.2em 0;
      padding: 10px 16px;
      background: var(--pc-quote-bg);
      border-left: 3px solid var(--pc-border);
      color: var(--pc-muted);
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .pc-body pre {
      margin: 1.2em 0;
      padding: 14px 16px;
      background: var(--pc-code-bg);
      border: 1px solid var(--pc-border);
      border-radius: 8px;
      overflow-x: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.82em;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .pc-body code {
      padding: 0.12em 0.35em;
      background: var(--pc-code-bg);
      border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.88em;
    }
    .pc-body pre code { padding: 0; background: transparent; font-size: 1em; }
    .pc-body table {
      width: 100%;
      border-collapse: collapse;
      margin: 1.2em 0;
      font-size: 0.86em;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .pc-body th, .pc-body td {
      border: 1px solid var(--pc-border);
      padding: 8px 10px;
      text-align: left;
      word-break: break-word;
    }
    .pc-body th { background: var(--pc-quote-bg); font-weight: 600; }
    mark.pc-mark {
      padding: 0.05em 0.18em;
      border-radius: 3px;
      color: #111827;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    mark.pc-mark[data-color="amber"] { background: #fef08a; }
    mark.pc-mark[data-color="mint"] { background: #bbf7d0; }
    mark.pc-mark[data-color="sky"] { background: #bae6fd; }
    @page { margin: ${margin.printMm}; }
    @media print {
      body { background: #ffffff !important; color: #111827 !important; padding: 0 !important; }
      .pc-sheet {
        max-width: none !important;
        padding: 0 !important;
        border: none !important;
        box-shadow: none !important;
        background: #ffffff !important;
      }
      .pc-meta, .pc-body blockquote, .pc-body pre, .pc-body th {
        background: #f8fafc !important;
        color: #1f2937 !important;
        border-color: #d1d5db !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  </style>
</head>
<body>
  <article class="pc-sheet">
    <h1 class="pc-title">${escapeHtml(title)}</h1>
    ${metaSection}
    ${noteSection}
    <main class="pc-body">${root.innerHTML}</main>
  </article>
</body>
</html>`;
}

/**
 * Converts clean semantic HTML inside reader into GitHub-Flavored Markdown.
 * When extractLocalAssets is true, embedded data:image/* pictures are exported
 * as binary assets into ./assets/<assetSlug>/img-XX.ext.
 *
 * @param {object} article
 * @param {object} renderState
 * @param {{ extractLocalAssets?: boolean, assetSlug?: string }} [options]
 * @returns {{ markdown: string, assets: Array<{ relativePath: string, bytes: Uint8Array, mimeType: string }> }}
 */
export function buildMarkdownBundle(article, renderState, options = {}) {
  const { extractLocalAssets = true, assetSlug = 'clip' } = options;
  const prefs = renderState.prefs;
  const { root } = parseAndFilterBody(renderState.bodyHtml, prefs);

  const title = renderState.title?.trim() || article.title || '未命名素笺';
  const noteText = String(renderState.noteText || '').trim();
  const safeSlug = sanitizeFilename(assetSlug).slice(0, 48).replace(/\s+/g, '_');

  const assets = [];
  let imageCounter = 0;

  function inlineText(node) {
    if (node.nodeType === 3) {
      return node.nodeValue.replace(/\s+/g, ' ');
    }
    if (node.nodeType !== 1) return '';

    const tag = node.tagName.toLowerCase();
    if (tag === 'br') return '  \n';

    if (tag === 'img') {
      const alt = (node.getAttribute('alt') || '').replace(/[\[\]\n]/g, ' ').trim();
      const rawSrc = node.getAttribute('src') || '';
      const origSrc = node.getAttribute('data-original-src') || '';
      let targetUrl = rawSrc;

      if (rawSrc.startsWith('data:image/')) {
        if (extractLocalAssets) {
          const parsed = dataUrlToParts(rawSrc);
          if (parsed) {
            imageCounter += 1;
            const seq = String(imageCounter).padStart(2, '0');
            const relPath = `assets/${safeSlug}/img-${seq}.${parsed.ext}`;
            assets.push({
              relativePath: relPath,
              bytes: parsed.bytes,
              mimeType: parsed.mimeType
            });
            targetUrl = `./${relPath}`;
          }
        } else if (origSrc) {
          targetUrl = origSrc;
        }
      }
      return targetUrl ? `![${alt}](${targetUrl})` : '';
    }

    const inner = Array.from(node.childNodes).map(inlineText).join('');

    switch (tag) {
      case 'strong':
      case 'b':
        return inner.trim() ? `**${inner.trim()}**` : '';
      case 'em':
      case 'i':
        return inner.trim() ? `*${inner.trim()}*` : '';
      case 'del':
      case 's':
        return inner.trim() ? `~~${inner.trim()}~~` : '';
      case 'code':
        return inner.trim() ? `\`${inner.replace(/`/g, '\\`').trim()}\`` : '';
      case 'mark': {
        const colorKey = node.getAttribute('data-color') || 'amber';
        const bg = (HIGHLIGHT_COLORS[colorKey] || HIGHLIGHT_COLORS.amber).bg;
        return `<mark style="background:${bg}">${inner.trim()}</mark>`;
      }
      case 'a': {
        const href = node.getAttribute('href') || '';
        const label = inner.trim() || href;
        return href ? `[${label}](${href})` : label;
      }
      default:
        return inner;
    }
  }

  function convertTable(tableEl) {
    const rows = Array.from(tableEl.querySelectorAll('tr'));
    if (rows.length === 0) return '';

    const matrix = rows.map((tr) =>
      Array.from(tr.children)
        .filter((cell) => cell.tagName === 'TH' || cell.tagName === 'TD')
        .map((cell) =>
          Array.from(cell.childNodes)
            .map(inlineText)
            .join('')
            .replace(/\|/g, '\\|')
            .replace(/\n+/g, ' ')
            .trim()
        )
    );

    const colCount = Math.max(...matrix.map((r) => r.length), 1);
    const padRow = (r) => {
      const copy = [...r];
      while (copy.length < colCount) copy.push('');
      return `| ${copy.join(' | ')} |`;
    };

    const header = padRow(matrix[0]);
    const divider = `| ${Array(colCount).fill('---').join(' | ')} |`;
    const body = matrix.slice(1).map(padRow);
    return [header, divider, ...body].join('\n') + '\n\n';
  }

  function convertList(listEl, depth = 0) {
    const ordered = listEl.tagName.toLowerCase() === 'ol';
    const indent = '  '.repeat(depth);
    let idx = 1;
    let out = '';

    for (const child of listEl.children) {
      if (child.tagName.toLowerCase() !== 'li') continue;
      const prefix = ordered ? `${idx}. ` : '- ';
      idx += 1;

      const inlineParts = [];
      const subLists = [];
      for (const node of child.childNodes) {
        if (
          node.nodeType === 1 &&
          (node.tagName.toLowerCase() === 'ul' || node.tagName.toLowerCase() === 'ol')
        ) {
          subLists.push(convertList(node, depth + 1));
        } else {
          inlineParts.push(inlineText(node));
        }
      }

      const line = inlineParts.join('').replace(/\n+/g, ' ').trim();
      out += `${indent}${prefix}${line}\n`;
      if (subLists.length > 0) {
        out += subLists.join('');
      }
    }
    return depth === 0 ? `${out}\n` : out;
  }

  function blockNode(node) {
    if (node.nodeType === 3) {
      const txt = node.nodeValue.trim();
      return txt ? `${txt}\n\n` : '';
    }
    if (node.nodeType !== 1) return '';

    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      const text = Array.from(node.childNodes).map(inlineText).join('').trim();
      return text ? `${'#'.repeat(level)} ${text}\n\n` : '';
    }

    switch (tag) {
      case 'hr':
        return '---\n\n';
      case 'pre': {
        const codeEl = node.querySelector('code');
        const lang = (codeEl?.getAttribute('data-lang') || '').trim();
        const rawCode = (codeEl || node).textContent.replace(/\n+$/, '');
        return `\`\`\`${lang}\n${rawCode}\n\`\`\`\n\n`;
      }
      case 'blockquote': {
        const inner = Array.from(node.childNodes).map(blockNode).join('').trim();
        if (!inner) return '';
        return (
          inner
            .split('\n')
            .map((line) => (line ? `> ${line}` : '>'))
            .join('\n') + '\n\n'
        );
      }
      case 'ul':
      case 'ol':
        return convertList(node, 0);
      case 'table':
        return convertTable(node);
      case 'figure': {
        const img = node.querySelector('img');
        const cap = node.querySelector('figcaption');
        const imgMd = img ? inlineText(img) : '';
        const capMd = cap ? Array.from(cap.childNodes).map(inlineText).join('').trim() : '';
        let res = '';
        if (imgMd) res += `${imgMd}\n`;
        if (capMd) res += `*${capMd}*\n`;
        return res ? `${res}\n` : '';
      }
      case 'img': {
        const md = inlineText(node);
        return md ? `${md}\n\n` : '';
      }
      case 'p': {
        const md = Array.from(node.childNodes).map(inlineText).join('').trim();
        return md ? `${md}\n\n` : '';
      }
      default: {
        const hasBlockChildren = Array.from(node.children).some((c) =>
          /^(p|h[1-6]|pre|blockquote|ul|ol|table|figure|div|section|hr)$/i.test(c.tagName)
        );
        if (hasBlockChildren) {
          return Array.from(node.childNodes).map(blockNode).join('');
        }
        const md = Array.from(node.childNodes).map(inlineText).join('').trim();
        return md ? `${md}\n\n` : '';
      }
    }
  }

  const parts = [];
  parts.push(`# ${title}\n`);

  if (prefs.showMetaHeader) {
    const metaLines = [];
    if (article.siteName) metaLines.push(`> **来源**：${article.siteName}`);
    if (article.author) metaLines.push(`> **作者**：${article.author}`);
    metaLines.push(`> **剪藏时间**：${formatDateTime(article.clippedAt)}`);
    if (article.url) metaLines.push(`> **原文链接**：<${article.url}>`);
    parts.push(metaLines.join('\n') + '\n');
  }

  if (noteText) {
    const quotedNote = noteText
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    parts.push(`> **素笺备注**\n>\n${quotedNote}\n`);
  }

  const bodyMd = Array.from(root.childNodes).map(blockNode).join('').replace(/\n{3,}/g, '\n\n').trim();
  parts.push(bodyMd);

  return {
    markdown: parts.filter(Boolean).join('\n') + '\n',
    assets
  };
}
