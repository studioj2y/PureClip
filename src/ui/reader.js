import { ext, getSessionStorage, isFirefox } from '../shared/ext-api.js';
import { buildMarkdownBundle, buildStandaloneHtml } from '../shared/exporters.js';
import { formatDate, formatDateTime, sanitizeCategoryPath, sanitizeFilename, uint8ToBase64 } from '../shared/utils.js';

const params = new URLSearchParams(location.search);
const isStandalonePrint = params.get('standalonePrint') === '1';
const channelToken = new URLSearchParams(location.hash.slice(1)).get('token') || '';

const MARGIN_MM = { compact: '10mm', normal: '16mm', wide: '24mm' };

let state = {
  article: null,
  prefs: null,
  categories: [],
  activeMarkEl: null,
  savedRange: null
};

const pendingBridge = new Map();
let bridgeSeq = 0;

function el(id) {
  return document.getElementById(id);
}

function showToast(text, level = 'info') {
  const bar = el('toast-bar');
  bar.textContent = text;
  bar.className = `toast-bar no-print ${level === 'warn' ? 'warn' : level === 'error' ? 'error' : ''}`;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => bar.classList.add('hidden'), 4200);
}

function postToHost(payload) {
  window.parent.postMessage({ ...payload, token: channelToken }, '*');
}

function callBackground(payload) {
  if (isStandalonePrint || window.parent === window) {
    return ext.runtime.sendMessage(payload);
  }
  const requestId = `req_${++bridgeSeq}`;
  return new Promise((resolve, reject) => {
    pendingBridge.set(requestId, { resolve, reject });
    postToHost({ type: 'PC_BRIDGE_BACKGROUND', requestId, payload });
  });
}

function applyPrefsToDom(prefs) {
  document.body.setAttribute('data-theme', prefs.theme || 'paper');
  document.body.setAttribute('data-font', prefs.fontFamily || 'serif');
  document.documentElement.style.setProperty('--pc-font-size', `${prefs.fontSize || 18}px`);
  document.documentElement.style.setProperty('--pc-line-height', String(prefs.lineHeight || 1.8));

  const sheet = el('paper-sheet');
  sheet.setAttribute('data-margin', prefs.pageMargin || 'normal');
  el('pc-print-page-rule').textContent = `@page { margin: ${MARGIN_MM[prefs.pageMargin] || '16mm'}; }`;

  const body = el('article-body');
  body.classList.toggle('hide-images', !prefs.showImages);
  body.classList.toggle('hide-code', !prefs.showCodeBlocks);
  el('meta-header').classList.toggle('hidden', !prefs.showMetaHeader);

  // Sync control states
  el('val-font-size').textContent = `${prefs.fontSize || 18}px`;
  el('val-line-height').textContent = Number(prefs.lineHeight || 1.8).toFixed(1);
  el('opt-images').checked = Boolean(prefs.showImages);
  el('opt-code').checked = Boolean(prefs.showCodeBlocks);
  el('opt-meta').checked = Boolean(prefs.showMetaHeader);
  el('format-select').value = prefs.exportFormat || 'html';

  document.querySelectorAll('#theme-group .seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === prefs.theme);
  });
  document.querySelectorAll('#font-group .seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.font === prefs.fontFamily);
  });
  document.querySelectorAll('#margin-group .seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.margin === prefs.pageMargin);
  });
}

function renderCategories(categories, selected) {
  const select = el('category-select');
  select.innerHTML = '';
  for (const cat of categories) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    if (cat === selected) opt.selected = true;
    select.appendChild(opt);
  }
}

function renderArticle(article) {
  state.article = article;
  el('article-title').textContent = article.title || '未命名素笺';

  const datePrefix = formatDate(article.clippedAt);
  el('filename-input').value = sanitizeFilename(article.title, datePrefix);

  const metaParts = [];
  if (article.siteName) metaParts.push(`<span><strong>来源：</strong>${escapeText(article.siteName)}</span>`);
  if (article.author) metaParts.push(`<span><strong>作者：</strong>${escapeText(article.author)}</span>`);
  metaParts.push(`<span><strong>时间：</strong>${escapeText(formatDateTime(article.clippedAt))}</span>`);
  el('meta-line').innerHTML = metaParts.join('');

  const urlLine = el('meta-url-line');
  urlLine.innerHTML = '';
  if (article.url) {
    const strong = document.createElement('strong');
    strong.textContent = '原文链接：';
    const a = document.createElement('a');
    a.href = article.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = article.url;
    urlLine.append(strong, a);
  }

  el('article-body').innerHTML = article.bodyHtml || '<p>未提取到正文内容，可尝试顶部「框选区域」。</p>';

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === article.activeMode);
  });
}

function escapeText(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function updateDupBadge(match) {
  const badge = el('dup-badge');
  if (match) {
    badge.textContent = `已藏 · ${match.category}`;
    badge.title = `上次保存于 ${formatDateTime(match.clippedAt)}（${match.format.toUpperCase()}）`;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

async function updatePref(patch) {
  state.prefs = { ...state.prefs, ...patch };
  applyPrefsToDom(state.prefs);
  try {
    await callBackground({ type: 'PC_SAVE_PREFS', patch });
  } catch {
    // Ignore transient save error
  }
}

/* ---------- 3-Color Highlighter ---------- */

function hideHighlightToolbar() {
  el('hl-toolbar').classList.add('hidden');
  state.activeMarkEl = null;
}

function positionHighlightToolbar(rect) {
  const bar = el('hl-toolbar');
  bar.classList.remove('hidden');
  const top = Math.max(8, rect.top - 42);
  const left = Math.min(window.innerWidth - 180, Math.max(12, rect.left + rect.width / 2 - 75));
  bar.style.top = `${top}px`;
  bar.style.left = `${left}px`;
}

function applyHighlightToRange(range, color) {
  if (!range || range.collapsed) return;
  const body = el('article-body');
  if (!body.contains(range.commonAncestorContainer)) return;

  const walker = document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest('pre, code')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const textNodes = [];
  if (range.commonAncestorContainer.nodeType === 3) {
    textNodes.push(range.commonAncestorContainer);
  } else {
    let cur;
    while ((cur = walker.nextNode())) {
      textNodes.push(cur);
    }
  }

  for (const tNode of textNodes) {
    const start = tNode === range.startContainer ? range.startOffset : 0;
    const end = tNode === range.endContainer ? range.endOffset : tNode.nodeValue.length;
    if (end <= start) continue;

    const existingMark = tNode.parentElement?.closest('mark.pc-mark');
    if (existingMark && start === 0 && end === tNode.nodeValue.length) {
      existingMark.setAttribute('data-color', color);
      continue;
    }

    const sliceRange = document.createRange();
    sliceRange.setStart(tNode, start);
    sliceRange.setEnd(tNode, end);

    const mark = document.createElement('mark');
    mark.className = 'pc-mark';
    mark.setAttribute('data-color', color);
    try {
      sliceRange.surroundContents(mark);
    } catch {
      // Skip partial boundary edge cases cleanly
    }
  }
  window.getSelection()?.removeAllRanges();
}

function unwrapMark(markEl) {
  if (!markEl || !markEl.parentNode) return;
  const parent = markEl.parentNode;
  while (markEl.firstChild) {
    parent.insertBefore(markEl.firstChild, markEl);
  }
  parent.removeChild(markEl);
  parent.normalize();
}

function setupHighlighter() {
  const body = el('article-body');

  body.addEventListener('mouseup', () => {
    setTimeout(() => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
        const range = sel.getRangeAt(0);
        if (body.contains(range.commonAncestorContainer)) {
          state.savedRange = range.cloneRange();
          state.activeMarkEl = null;
          positionHighlightToolbar(range.getBoundingClientRect());
          return;
        }
      }
    }, 10);
  });

  body.addEventListener('click', (e) => {
    const mark = e.target.closest('mark.pc-mark');
    if (mark) {
      state.activeMarkEl = mark;
      state.savedRange = null;
      positionHighlightToolbar(mark.getBoundingClientRect());
    } else if (!window.getSelection()?.toString().trim()) {
      hideHighlightToolbar();
    }
  });

  document.querySelectorAll('#hl-toolbar .hl-dot').forEach((dot) => {
    dot.addEventListener('click', () => {
      const color = dot.dataset.color;
      if (state.activeMarkEl) {
        state.activeMarkEl.setAttribute('data-color', color);
      } else if (state.savedRange) {
        applyHighlightToRange(state.savedRange, color);
        state.savedRange = null;
      }
      hideHighlightToolbar();
    });
  });

  el('hl-clear').addEventListener('click', () => {
    if (state.activeMarkEl) {
      unwrapMark(state.activeMarkEl);
    } else if (state.savedRange) {
      const frag = state.savedRange.commonAncestorContainer;
      if (frag.nodeType === 1) {
        frag.querySelectorAll('mark.pc-mark').forEach((m) => {
          if (state.savedRange.intersectsNode(m)) unwrapMark(m);
        });
      }
    }
    hideHighlightToolbar();
  });
}

/* ---------- Saving & Printing ---------- */

function collectRenderState() {
  return {
    title: el('article-title').textContent.trim() || state.article?.title || '未命名素笺',
    noteText: el('note-input').value,
    bodyHtml: el('article-body').innerHTML,
    prefs: { ...state.prefs }
  };
}

async function handleSaveOrPrint({ saveAs = false } = {}) {
  if (!state.article) return;

  const format = el('format-select').value;
  const category = sanitizeCategoryPath(el('category-select').value || '默认归档');
  const rawName = el('filename-input').value || state.article.title;
  const filenameStem = sanitizeFilename(rawName);
  const renderState = collectRenderState();

  if (format === 'pdf') {
    await callBackground({
      type: 'PC_RECORD_HISTORY_ONLY',
      entry: {
        url: state.article.url,
        title: renderState.title,
        siteName: state.article.siteName,
        category,
        format: 'pdf',
        filename: `${filenameStem}.pdf`,
        noteExcerpt: renderState.noteText
      }
    });
    updateDupBadge({ category, clippedAt: Date.now(), format: 'pdf' });

    if (isFirefox && !isStandalonePrint) {
      // Open clean top-level extension tab for full multi-page PDF printing on Firefox
      const storage = getSessionStorage();
      await storage.set({
        pureclip_print_snapshot: {
          article: state.article,
          renderState,
          filenameStem
        }
      });
      await callBackground({ type: 'PC_OPEN_STANDALONE_PRINT' });
      return;
    }

    const prevTitle = document.title;
    document.title = filenameStem;
    window.print();
    setTimeout(() => {
      document.title = prevTitle;
    }, 800);
    return;
  }

  let files = [];
  if (format === 'html') {
    const htmlStr = buildStandaloneHtml(state.article, renderState);
    files = [
      {
        relativePath: `${filenameStem}.html`,
        mimeType: 'text/html;charset=utf-8',
        textContent: htmlStr
      }
    ];
  } else if (format === 'md') {
    const extractLocalAssets = !saveAs;
    const bundle = buildMarkdownBundle(state.article, renderState, {
      extractLocalAssets,
      assetSlug: filenameStem
    });
    files = [
      {
        relativePath: `${filenameStem}.md`,
        mimeType: 'text/markdown;charset=utf-8',
        textContent: bundle.markdown
      },
      ...bundle.assets.map((asset) => ({
        relativePath: asset.relativePath,
        mimeType: asset.mimeType,
        base64Content: uint8ToBase64(asset.bytes)
      }))
    ];
  }

  showToast('正在归档保存…');
  const res = await callBackground({
    type: 'PC_ARCHIVE_SAVE',
    job: {
      saveAs,
      category,
      format,
      filenameStem,
      files,
      historyEntry: {
        url: state.article.url,
        title: renderState.title,
        siteName: state.article.siteName,
        category,
        format,
        filename: `${filenameStem}.${format}`,
        noteExcerpt: renderState.noteText
      }
    }
  });

  if (res?.ok) {
    updateDupBadge({ category, clippedAt: Date.now(), format });
    showToast(res.message || `已保存至「${category}」`);
  } else {
    showToast(res?.error || '保存失败，请重试', 'error');
  }
}

/* ---------- Events & Initialization ---------- */

function bindEvents() {
  // Extraction mode buttons
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      postToHost({ type: 'PC_SWITCH_MODE', mode: btn.dataset.mode });
    });
  });

  // Popover toggle
  const styleBtn = el('btn-style-toggle');
  const stylePop = el('style-popover');
  styleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    stylePop.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!stylePop.contains(e.target) && e.target !== styleBtn) {
      stylePop.classList.add('hidden');
    }
  });

  // Theme / Font / Margin
  document.querySelectorAll('#theme-group .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => updatePref({ theme: btn.dataset.theme }));
  });
  document.querySelectorAll('#font-group .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => updatePref({ fontFamily: btn.dataset.font }));
  });
  document.querySelectorAll('#margin-group .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => updatePref({ pageMargin: btn.dataset.margin }));
  });

  el('btn-font-dec').addEventListener('click', () =>
    updatePref({ fontSize: Math.max(14, (state.prefs.fontSize || 18) - 1) })
  );
  el('btn-font-inc').addEventListener('click', () =>
    updatePref({ fontSize: Math.min(26, (state.prefs.fontSize || 18) + 1) })
  );
  el('btn-lh-dec').addEventListener('click', () =>
    updatePref({ lineHeight: Math.max(1.3, Number(((state.prefs.lineHeight || 1.8) - 0.1).toFixed(1))) })
  );
  el('btn-lh-inc').addEventListener('click', () =>
    updatePref({ lineHeight: Math.min(2.4, Number(((state.prefs.lineHeight || 1.8) + 0.1).toFixed(1))) })
  );

  el('opt-images').addEventListener('change', (e) => updatePref({ showImages: e.target.checked }));
  el('opt-code').addEventListener('change', (e) => updatePref({ showCodeBlocks: e.target.checked }));
  el('opt-meta').addEventListener('change', (e) => updatePref({ showMetaHeader: e.target.checked }));

  el('format-select').addEventListener('change', (e) => updatePref({ exportFormat: e.target.value }));
  el('category-select').addEventListener('change', (e) =>
    updatePref({ selectedCategory: e.target.value })
  );

  // New Category Dialog
  const dialog = el('new-cat-dialog');
  el('btn-new-cat').addEventListener('click', () => {
    el('new-cat-input').value = '';
    dialog.showModal();
  });
  el('new-cat-cancel').addEventListener('click', () => dialog.close());
  el('new-cat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = el('new-cat-input').value.trim();
    if (!raw) return;
    const res = await callBackground({ type: 'PC_ADD_CATEGORY', category: raw });
    if (res?.categories) {
      state.categories = res.categories;
      renderCategories(res.categories, res.category);
      await updatePref({ selectedCategory: res.category });
    }
    dialog.close();
  });

  // Note auto-resize & print mirror
  const noteInput = el('note-input');
  const noteWrap = el('note-wrapper');
  const noteMirror = el('note-print-mirror');
  noteInput.addEventListener('input', () => {
    noteInput.style.height = 'auto';
    noteInput.style.height = `${noteInput.scrollHeight}px`;
    const val = noteInput.value;
    noteWrap.classList.toggle('is-empty-note', val.trim().length === 0);
    noteMirror.textContent = val;
  });

  el('btn-save').addEventListener('click', () => handleSaveOrPrint({ saveAs: false }));
  el('btn-save-as').addEventListener('click', () => handleSaveOrPrint({ saveAs: true }));
  el('btn-manager').addEventListener('click', () => callBackground({ type: 'PC_OPEN_MANAGER' }));
  el('btn-close').addEventListener('click', () => postToHost({ type: 'PC_CLOSE_OVERLAY' }));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dialog.open) {
      postToHost({ type: 'PC_CLOSE_OVERLAY' });
    }
  });

  setupHighlighter();
}

async function initStandalonePrint() {
  const storage = getSessionStorage();
  const data = await storage.get('pureclip_print_snapshot');
  const snap = data?.pureclip_print_snapshot;
  if (!snap) {
    el('article-title').textContent = '未找到待打印的素笺快照';
    return;
  }

  state.prefs = snap.renderState.prefs;
  applyPrefsToDom(state.prefs);
  renderArticle({ ...snap.article, bodyHtml: snap.renderState.bodyHtml });
  el('article-title').textContent = snap.renderState.title;

  const noteVal = snap.renderState.noteText || '';
  el('note-input').value = noteVal;
  el('note-print-mirror').textContent = noteVal;
  el('note-wrapper').classList.toggle('is-empty-note', noteVal.trim().length === 0);

  document.title = snap.filenameStem || 'PureClip';
  await storage.remove('pureclip_print_snapshot');

  const imgs = Array.from(el('article-body').querySelectorAll('img'));
  await Promise.all(
    imgs.map((img) =>
      img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; })
    )
  );
  setTimeout(() => window.print(), 180);
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || msg.token !== channelToken) return;

  if (msg.type === 'PC_BOOT_DATA') {
    state.prefs = msg.boot.prefs;
    state.categories = msg.boot.categories || ['默认归档'];
    applyPrefsToDom(state.prefs);
    renderCategories(state.categories, state.prefs.selectedCategory);
    updateDupBadge(msg.boot.duplicateMatch);
    renderArticle(msg.article);
  } else if (msg.type === 'PC_ARTICLE_READY') {
    renderArticle(msg.article);
  } else if (msg.type === 'PC_TOAST') {
    showToast(msg.text, msg.level);
  } else if (msg.type === 'PC_BRIDGE_RESULT') {
    const pending = pendingBridge.get(msg.requestId);
    if (pending) {
      pendingBridge.delete(msg.requestId);
      if (msg.ok) pending.resolve(msg.result);
      else pending.reject(new Error(msg.error));
    }
  }
});

bindEvents();
if (isStandalonePrint) {
  initStandalonePrint();
} else {
  postToHost({ type: 'PC_READER_READY' });
}
