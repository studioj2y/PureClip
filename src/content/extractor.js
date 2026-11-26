(function () {
  const ns = (globalThis.__PureClip = globalThis.__PureClip || {});
  if (ns.extractorLoaded) return;
  ns.extractorLoaded = true;

  const ext = globalThis.browser ?? globalThis.chrome;

  // Strictly word-bounded noise token regex so "header", "thead", "read", "markdown-body", "download" are never matched.
  const NOISE_TOKEN_RE =
    /(^|[-_\s])(ad|ads|advert|advertisement|adbox|adsense|sponsor|sponsored|promo|promotion|comment|comments|comment-list|recommend|recommended|related-posts|share-bar|social-share|breadcrumb|breadcrumbs|pagination|pager|sidebar|toc-sidebar|cookie-banner|newsletter|popup-modal|paywall-banner)($|[-_\s])/i;

  const HARD_DROP_SELECTOR = [
    'script',
    'style',
    'noscript',
    'template',
    'iframe',
    'svg',
    'canvas',
    'video',
    'audio',
    'form',
    'button',
    'input',
    'select',
    'textarea',
    'nav',
    'aside',
    'footer',
    'dialog',
    '[role="navigation"]',
    '[role="banner"]',
    '[role="complementary"]',
    '[role="search"]',
    '[role="dialog"]',
    '#pureclip-root-host',
    '#pureclip-picker-host'
  ].join(',');

  const ARTICLE_SELECTORS = [
    'article',
    '[role="main"] article',
    'main article',
    '#js_content', // WeChat Official Accounts
    '.RichContent-inner', // Zhihu
    '.Post-RichTextContainer',
    '.article-content',
    '.post-content',
    '.entry-content',
    '.markdown-body',
    'article .content',
    'main',
    '[role="main"]'
  ];

  const ALLOWED_TAGS = new Set([
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'P',
    'BR',
    'HR',
    'BLOCKQUOTE',
    'UL',
    'OL',
    'LI',
    'PRE',
    'CODE',
    'TABLE',
    'THEAD',
    'TBODY',
    'TFOOT',
    'TR',
    'TH',
    'TD',
    'CAPTION',
    'FIGURE',
    'FIGCAPTION',
    'IMG',
    'A',
    'STRONG',
    'B',
    'EM',
    'I',
    'U',
    'S',
    'DEL',
    'SUP',
    'SUB',
    'MARK'
  ]);

  const BLOCK_UNWRAP_TAGS = new Set([
    'DIV',
    'SECTION',
    'ARTICLE',
    'MAIN',
    'HEADER',
    'CENTER',
    'DD',
    'DT',
    'DL'
  ]);

  function isNoiseElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const id = el.id || '';
    const cls = typeof el.className === 'string' ? el.className : '';
    return NOISE_TOKEN_RE.test(id) || NOISE_TOKEN_RE.test(cls);
  }

  function resolveUrl(raw) {
    if (!raw || typeof raw !== 'string') return '';
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('javascript:')) return '';
    if (trimmed.startsWith('data:image/')) return trimmed;
    try {
      const u = new URL(trimmed, document.baseURI);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        return u.toString();
      }
    } catch {
      return '';
    }
    return '';
  }

  function pickSrcsetBest(srcset) {
    if (!srcset) return '';
    const candidates = srcset
      .split(',')
      .map((entry) => {
        const parts = entry.trim().split(/\s+/);
        const url = parts[0];
        const desc = parts[1] || '';
        const score = desc.endsWith('w')
          ? parseFloat(desc)
          : desc.endsWith('x')
          ? parseFloat(desc) * 1000
          : 1;
        return { url, score: Number.isFinite(score) ? score : 1 };
      })
      .filter((c) => c.url);
    if (candidates.length === 0) return '';
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].url;
  }

  function resolveLiveImageUrl(img) {
    const attrCandidates = [
      img.getAttribute('data-src'),
      img.getAttribute('data-original'),
      img.getAttribute('data-actualsrc'),
      img.getAttribute('data-lazy-src'),
      img.getAttribute('data-url'),
      img.getAttribute('data-echo'),
      pickSrcsetBest(img.getAttribute('data-srcset') || img.getAttribute('srcset')),
      img.currentSrc,
      img.getAttribute('src')
    ];

    for (const candidate of attrCandidates) {
      const resolved = resolveUrl(candidate);
      if (!resolved) continue;
      // Skip obvious 1x1 gif/svg lazy placeholders when a real attribute exists
      if (resolved.startsWith('data:image/gif;base64,R0lGOD') && attrCandidates.some((x) => x && x.startsWith('http'))) {
        continue;
      }
      if (resolved.startsWith('data:image/svg+xml') && attrCandidates.some((x) => x && x.startsWith('http'))) {
        continue;
      }
      return resolved;
    }
    return '';
  }

  function tryLiveCanvasDataUrl(img, resolvedUrl) {
    if (!img.complete || img.naturalWidth <= 3 || img.naturalHeight <= 3) return '';
    if (!resolvedUrl || resolvedUrl.startsWith('data:')) return resolvedUrl;
    if (/\.gif(\?|$)/i.test(resolvedUrl) || /\.svg(\?|$)/i.test(resolvedUrl)) return '';
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL('image/png');
    } catch {
      return '';
    }
  }

  function computeLinkDensity(el) {
    const totalLen = (el.textContent || '').trim().length;
    if (totalLen === 0) return 1;
    let linkLen = 0;
    const links = el.querySelectorAll('a');
    for (const a of links) {
      linkLen += (a.textContent || '').trim().length;
    }
    return linkLen / totalLen;
  }

  function scoreCandidate(el) {
    if (!el || el.nodeType !== 1) return -1;
    if (el.matches(HARD_DROP_SELECTOR) || isNoiseElement(el)) return -1;

    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return -1;

    const text = (el.textContent || '').trim();
    if (text.length < 120) return -1;

    const linkDensity = computeLinkDensity(el);
    if (linkDensity > 0.55) return -1;

    const paragraphs = el.querySelectorAll('p, li, pre, blockquote');
    let score = 0;
    for (const p of paragraphs) {
      const t = (p.textContent || '').trim();
      if (t.length < 15) continue;
      const punctMatches = t.match(/[，。！？；、,.!?;]/g);
      score += Math.min(t.length, 400) * 0.15 + (punctMatches ? punctMatches.length * 4 : 0);
    }

    // Bonus for rich content images & code blocks
    const imgs = el.querySelectorAll('img').length;
    const codes = el.querySelectorAll('pre').length;
    score += Math.min(imgs, 12) * 12 + Math.min(codes, 8) * 18;

    // Bonus for semantic article containers
    if (/^(ARTICLE|MAIN)$/i.test(el.tagName)) score *= 1.35;
    if (/(article|post|entry|content|markdown|rich)/i.test(el.className || el.id || '')) {
      score *= 1.25;
    }

    return score * (1 - linkDensity * 0.7);
  }

  function findMainArticleElement() {
    let bestEl = null;
    let bestScore = -1;

    for (const selector of ARTICLE_SELECTORS) {
      const nodes = document.querySelectorAll(selector);
      for (const el of nodes) {
        const s = scoreCandidate(el);
        if (s > bestScore) {
          bestScore = s;
          bestEl = el;
        }
      }
    }

    if (bestScore > 80 && bestEl) {
      return bestEl;
    }

    // Fallback: scan common block containers
    const candidates = document.querySelectorAll('div, section, article, main');
    for (const el of candidates) {
      const s = scoreCandidate(el);
      if (s > bestScore) {
        bestScore = s;
        bestEl = el;
      }
    }

    return bestEl || document.body;
  }

  function cloneWithLiveVisibilityAndImages(liveRoot) {
    const cloneRoot = liveRoot.cloneNode(true);
    const liveWalker = document.createTreeWalker(liveRoot, NodeFilter.SHOW_ELEMENT);
    const cloneWalker = document.createTreeWalker(cloneRoot, NodeFilter.SHOW_ELEMENT);

    const imageJobs = [];
    let liveNode = liveWalker.currentNode;
    let cloneNode = cloneWalker.currentNode;

    while (liveNode && cloneNode) {
      if (liveNode !== liveRoot) {
        const tag = liveNode.tagName;
        const isImg = tag === 'IMG';
        let drop = false;

        if (liveNode.matches(HARD_DROP_SELECTOR) || isNoiseElement(liveNode)) {
          drop = true;
        } else if (!isImg) {
          const cs = getComputedStyle(liveNode);
          if (
            liveNode.hidden ||
            liveNode.getAttribute('aria-hidden') === 'true' ||
            cs.display === 'none' ||
            cs.visibility === 'hidden' ||
            cs.opacity === '0'
          ) {
            drop = true;
          }
        }

        if (drop) {
          cloneNode.setAttribute('data-pc-drop', '1');
        } else if (isImg) {
          if (liveNode.complete && liveNode.naturalWidth > 0 && liveNode.naturalWidth <= 3 && liveNode.naturalHeight <= 3) {
            cloneNode.setAttribute('data-pc-drop', '1');
          } else {
            const resolvedUrl = resolveLiveImageUrl(liveNode);
            if (!resolvedUrl) {
              cloneNode.setAttribute('data-pc-drop', '1');
            } else {
              cloneNode.setAttribute('data-original-src', resolvedUrl);
              const quickDataUrl = tryLiveCanvasDataUrl(liveNode, resolvedUrl);
              if (quickDataUrl) {
                cloneNode.setAttribute('src', quickDataUrl);
              } else {
                cloneNode.setAttribute('src', resolvedUrl);
                if (resolvedUrl.startsWith('http://') || resolvedUrl.startsWith('https://')) {
                  imageJobs.push({ cloneImg: cloneNode, url: resolvedUrl });
                }
              }
            }
          }
        }
      }

      liveNode = liveWalker.nextNode();
      cloneNode = cloneWalker.nextNode();
    }

    cloneRoot.querySelectorAll('[data-pc-drop="1"]').forEach((el) => el.remove());
    return { cloneRoot, imageJobs };
  }

  function normalizeCodeBlocks(root) {
    const pres = Array.from(root.querySelectorAll('pre'));
    for (const pre of pres) {
      // Remove line number columns injected by highlighters (CSDN/Prism/WeChat)
      pre
        .querySelectorAll(
          '.line-numbers-rows, .pre-numbering, .hljs-ln-numbers, [class*="line-number"], [class*="gutter"]'
        )
        .forEach((n) => n.remove());

      const codeEl = pre.querySelector('code') || pre;
      const cls = `${pre.className || ''} ${codeEl.className || ''}`;
      const langMatch = cls.match(/(?:language-|lang-)([a-zA-Z0-9_+#-]+)/i);
      const lang = langMatch ? langMatch[1].toLowerCase() : '';

      // Preserve line breaks from <br> or block lines inside <pre>
      const working = codeEl.cloneNode(true);
      working.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
      working.querySelectorAll('div, p, li').forEach((blk) => {
        if (blk.nextSibling) {
          blk.append('\n');
        }
      });

      const codeText = (working.textContent || '').replace(/\u00a0/g, ' ').replace(/\n+$/, '');
      const cleanPre = document.createElement('pre');
      const cleanCode = document.createElement('code');
      if (lang) {
        cleanCode.setAttribute('data-lang', lang);
      }
      cleanCode.textContent = codeText;
      cleanPre.appendChild(cleanCode);
      pre.replaceWith(cleanPre);
    }
  }

  function sanitizeSemanticTree(root) {
    normalizeCodeBlocks(root);

    function cleanNode(node) {
      if (node.nodeType === 3) {
        return document.createTextNode(node.nodeValue);
      }
      if (node.nodeType !== 1) return null;

      const tag = node.tagName.toUpperCase();
      if (node.matches(HARD_DROP_SELECTOR) || isNoiseElement(node)) {
        return null;
      }

      if (!ALLOWED_TAGS.has(tag)) {
        const frag = document.createDocumentFragment();
        const isBlock = BLOCK_UNWRAP_TAGS.has(tag);
        for (const child of Array.from(node.childNodes)) {
          const cleaned = cleanNode(child);
          if (cleaned) frag.appendChild(cleaned);
        }
        if (isBlock && frag.childNodes.length > 0 && !node.closest('pre')) {
          // Wrap loose inline text inside unwrapped block divs into <p> when top-level
          const onlyInline = Array.from(frag.childNodes).every(
            (n) => n.nodeType === 3 || (n.nodeType === 1 && !/^(P|H[1-6]|UL|OL|PRE|BLOCKQUOTE|TABLE|FIGURE|HR)$/.test(n.tagName))
          );
          if (onlyInline && frag.textContent.trim()) {
            const p = document.createElement('p');
            p.appendChild(frag);
            return p;
          }
        }
        return frag;
      }

      const cleanEl = document.createElement(tag.toLowerCase());

      if (tag === 'A') {
        const href = resolveUrl(node.getAttribute('href'));
        if (href) {
          cleanEl.setAttribute('href', href);
          cleanEl.setAttribute('target', '_blank');
          cleanEl.setAttribute('rel', 'noopener noreferrer');
        }
      } else if (tag === 'IMG') {
        const src = node.getAttribute('src') || '';
        const orig = node.getAttribute('data-original-src') || '';
        if (!src && !orig) return null;
        cleanEl.setAttribute('src', src || orig);
        if (orig) cleanEl.setAttribute('data-original-src', orig);
        const alt = node.getAttribute('alt');
        if (alt) cleanEl.setAttribute('alt', alt);
        return cleanEl;
      } else if (tag === 'TD' || tag === 'TH') {
        const colspan = parseInt(node.getAttribute('colspan') || '', 10);
        const rowspan = parseInt(node.getAttribute('rowspan') || '', 10);
        if (colspan > 1) cleanEl.setAttribute('colspan', String(colspan));
        if (rowspan > 1) cleanEl.setAttribute('rowspan', String(rowspan));
      } else if (tag === 'CODE') {
        const lang = node.getAttribute('data-lang');
        if (lang) cleanEl.setAttribute('data-lang', lang);
      } else if (tag === 'MARK') {
        cleanEl.className = 'pc-mark';
        cleanEl.setAttribute('data-color', node.getAttribute('data-color') || 'amber');
      }

      for (const child of Array.from(node.childNodes)) {
        const cleaned = cleanNode(child);
        if (cleaned) cleanEl.appendChild(cleaned);
      }

      // Drop empty non-void blocks
      if (
        tag !== 'BR' &&
        tag !== 'HR' &&
        tag !== 'TD' &&
        tag !== 'TH' &&
        cleanEl.childNodes.length === 0
      ) {
        return null;
      }
      if (tag === 'P' && !cleanEl.textContent.trim() && !cleanEl.querySelector('img')) {
        return null;
      }

      return cleanEl;
    }

    const wrapper = document.createElement('div');
    for (const child of Array.from(root.childNodes)) {
      const cleaned = cleanNode(child);
      if (cleaned) wrapper.appendChild(cleaned);
    }

    // Remove leading H1 if it duplicates extracted document title
    return wrapper;
  }

  async function hydrateRemoteImages(imageJobs) {
    if (!imageJobs.length) return;
    const uniqueUrls = Array.from(new Set(imageJobs.map((j) => j.url))).slice(0, 80);
    const urlToData = new Map();

    const BATCH = 6;
    for (let i = 0; i < uniqueUrls.length; i += BATCH) {
      const slice = uniqueUrls.slice(i, i + BATCH);
      try {
        const resp = await ext.runtime.sendMessage({
          type: 'PC_FETCH_IMAGES',
          urls: slice
        });
        if (resp && resp.results) {
          for (const [u, dataUrl] of Object.entries(resp.results)) {
            if (dataUrl) urlToData.set(u, dataUrl);
          }
        }
      } catch {
        // Keep original URL fallback if background fetch is unavailable
      }
    }

    for (const job of imageJobs) {
      const dataUrl = urlToData.get(job.url);
      if (dataUrl) {
        job.cloneImg.setAttribute('src', dataUrl);
      }
    }
  }

  function extractMetadata(mainRoot) {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim();
    const h1Text = (mainRoot?.querySelector('h1')?.textContent || document.querySelector('h1')?.textContent || '').trim();
    let title = ogTitle || h1Text || document.title || '未命名素笺';
    if (!ogTitle && !h1Text && document.title) {
      title = document.title.replace(/\s*[-_|–—·]\s*[^-_|\n]{2,30}$/, '').trim() || document.title;
    }

    const authorMeta =
      document.querySelector('meta[name="author"]')?.getAttribute('content') ||
      document.querySelector('#js_name')?.textContent ||
      document.querySelector('[rel="author"], .author-name, .AuthorInfo-name')?.textContent ||
      '';

    const siteName =
      document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim() ||
      location.hostname.replace(/^www\./, '');

    return {
      title: title.trim(),
      author: authorMeta.trim().slice(0, 60),
      siteName,
      url: location.href,
      clippedAt: Date.now()
    };
  }

  function hasUsableSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
    const text = sel.toString().trim();
    if (text.length >= 15) return true;
    const frag = sel.getRangeAt(0).cloneContents();
    return Boolean(frag.querySelector('img, pre, table'));
  }

  function cloneSelectionContainer() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

    const container = document.createElement('div');
    const imageJobs = [];

    for (let i = 0; i < sel.rangeCount; i += 1) {
      const range = sel.getRangeAt(i);
      const frag = range.cloneContents();

      // Resolve lazy/canvas images relative to matching URLs on page
      frag.querySelectorAll('img').forEach((cloneImg) => {
        const resolved = resolveLiveImageUrl(cloneImg);
        if (!resolved) {
          cloneImg.remove();
          return;
        }
        cloneImg.setAttribute('data-original-src', resolved);
        cloneImg.setAttribute('src', resolved);
        if (resolved.startsWith('http://') || resolved.startsWith('https://')) {
          imageJobs.push({ cloneImg, url: resolved });
        }
      });

      container.appendChild(frag);
    }

    return { cloneRoot: container, imageJobs };
  }

  async function extract(options = {}) {
    const requestedMode = options.mode || 'auto';
    const selectedElements = Array.isArray(options.elements) ? options.elements : null;

    let activeMode = 'article';
    let cloneRoot;
    let imageJobs = [];
    let metaRoot = document.body;

    if (requestedMode === 'picker' && selectedElements && selectedElements.length > 0) {
      activeMode = 'picker';
      cloneRoot = document.createElement('div');
      for (const el of selectedElements) {
        const cloned = cloneWithLiveVisibilityAndImages(el);
        cloneRoot.appendChild(cloned.cloneRoot);
        imageJobs.push(...cloned.imageJobs);
      }
      metaRoot = selectedElements[0];
    } else if (requestedMode === 'selection' || (requestedMode === 'auto' && hasUsableSelection())) {
      const selResult = cloneSelectionContainer();
      if (!selResult || (!selResult.cloneRoot.textContent.trim() && !selResult.cloneRoot.querySelector('img'))) {
        if (requestedMode === 'selection') {
          return { emptySelection: true };
        }
      } else {
        activeMode = 'selection';
        cloneRoot = selResult.cloneRoot;
        imageJobs = selResult.imageJobs;
      }
    }

    if (!cloneRoot) {
      activeMode = 'article';
      const mainEl = findMainArticleElement();
      metaRoot = mainEl;
      const cloned = cloneWithLiveVisibilityAndImages(mainEl);
      cloneRoot = cloned.cloneRoot;
      imageJobs = cloned.imageJobs;
    }

    await hydrateRemoteImages(imageJobs);
    const cleanWrapper = sanitizeSemanticTree(cloneRoot);
    const meta = extractMetadata(metaRoot);

    // Avoid duplicating title if the first element inside body is an identical H1
    const firstEl = cleanWrapper.firstElementChild;
    if (firstEl && firstEl.tagName === 'H1' && firstEl.textContent.trim() === meta.title) {
      firstEl.remove();
    }

    return {
      ...meta,
      activeMode,
      hasSelectionAvailable: hasUsableSelection(),
      bodyHtml: cleanWrapper.innerHTML
    };
  }

  ns.extractor = {
    extract,
    hasUsableSelection
  };
})();
