(function () {
  const ns = (globalThis.__PureClip = globalThis.__PureClip || {});
  if (ns.overlayLoaded) return;
  ns.overlayLoaded = true;

  const ext = globalThis.browser ?? globalThis.chrome;
  const HOST_ID = 'pureclip-root-host';

  let overlayState = null;

  function generateToken() {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function closeOverlay() {
    if (!overlayState) return;
    window.removeEventListener('message', overlayState.onMessage);
    document.removeEventListener('keydown', overlayState.onKeyDown, true);
    document.documentElement.style.overflow = overlayState.prevDocOverflow;
    if (document.body) {
      document.body.style.overflow = overlayState.prevBodyOverflow;
    }
    overlayState.host.remove();
    overlayState = null;
  }

  async function mountOverlay(initialArticle) {
    if (overlayState) {
      overlayState.article = initialArticle;
      overlayState.iframe.contentWindow?.postMessage(
        {
          type: 'PC_ARTICLE_READY',
          token: overlayState.token,
          article: initialArticle
        },
        '*'
      );
      return;
    }

    const token = generateToken();
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText =
      'all: initial; position: fixed; inset: 0; z-index: 2147483647; width: 100vw; height: 100vh;';

    const shadow = host.attachShadow({ mode: 'open' });
    const iframe = document.createElement('iframe');
    iframe.src = `${ext.runtime.getURL('ui/reader.html')}#token=${token}`;
    iframe.style.cssText =
      'width: 100%; height: 100%; border: 0; display: block; background: rgba(15, 23, 42, 0.55);';
    shadow.appendChild(iframe);

    const prevDocOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body ? document.body.style.overflow : '';
    document.documentElement.style.overflow = 'hidden';
    if (document.body) document.body.style.overflow = 'hidden';

    document.documentElement.appendChild(host);

    const state = {
      host,
      iframe,
      token,
      article: initialArticle,
      prevDocOverflow,
      prevBodyOverflow,
      onMessage: null,
      onKeyDown: null
    };

    state.onKeyDown = (e) => {
      if (e.key === 'Escape' && overlayState) {
        closeOverlay();
      }
    };

    state.onMessage = async (event) => {
      if (!overlayState || event.source !== iframe.contentWindow) return;
      const msg = event.data;
      if (!msg || msg.token !== token) return;

      const reply = (payload) => {
        iframe.contentWindow?.postMessage({ ...payload, token }, '*');
      };

      switch (msg.type) {
        case 'PC_READER_READY': {
          const boot = await ext.runtime.sendMessage({
            type: 'PC_GET_READER_BOOT',
            url: state.article.url
          });
          reply({
            type: 'PC_BOOT_DATA',
            article: state.article,
            boot
          });
          break;
        }
        case 'PC_SWITCH_MODE': {
          if (msg.mode === 'picker') {
            host.style.display = 'none';
            document.documentElement.style.overflow = prevDocOverflow;
            if (document.body) document.body.style.overflow = prevBodyOverflow;

            ns.picker.startPicker({
              onConfirm: async (elements) => {
                host.style.display = 'block';
                document.documentElement.style.overflow = 'hidden';
                if (document.body) document.body.style.overflow = 'hidden';
                const nextArticle = await ns.extractor.extract({ mode: 'picker', elements });
                state.article = nextArticle;
                reply({ type: 'PC_ARTICLE_READY', article: nextArticle });
              },
              onCancel: () => {
                host.style.display = 'block';
                document.documentElement.style.overflow = 'hidden';
                if (document.body) document.body.style.overflow = 'hidden';
              }
            });
          } else {
            const nextArticle = await ns.extractor.extract({ mode: msg.mode });
            if (nextArticle?.emptySelection) {
              reply({
                type: 'PC_TOAST',
                level: 'warn',
                text: '当前网页未检测到涂黑选中的内容，请先用鼠标涂黑一段文字，或切换为「框选区域」。'
              });
            } else {
              state.article = nextArticle;
              reply({ type: 'PC_ARTICLE_READY', article: nextArticle });
            }
          }
          break;
        }
        case 'PC_BRIDGE_BACKGROUND': {
          try {
            const result = await ext.runtime.sendMessage(msg.payload);
            reply({
              type: 'PC_BRIDGE_RESULT',
              requestId: msg.requestId,
              ok: true,
              result
            });
          } catch (err) {
            reply({
              type: 'PC_BRIDGE_RESULT',
              requestId: msg.requestId,
              ok: false,
              error: err?.message || String(err)
            });
          }
          break;
        }
        case 'PC_CLOSE_OVERLAY': {
          closeOverlay();
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener('message', state.onMessage);
    document.addEventListener('keydown', state.onKeyDown, true);
    overlayState = state;
  }

  ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'PC_OPEN_CLIPPER') return;
    (async () => {
      if (overlayState) {
        closeOverlay();
        sendResponse({ toggled: 'closed' });
        return;
      }
      const article = await ns.extractor.extract({ mode: message.mode || 'auto' });
      await mountOverlay(article);
      sendResponse({ toggled: 'opened' });
    })();
    return true;
  });
})();
