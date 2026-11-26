import { ext, getSessionStorage } from '../shared/ext-api.js';
import {
  addCategory,
  ensureInitializedStorage,
  findHistoryByUrl,
  getCategories,
  getPrefs,
  getRootDirHandle,
  recordHistory,
  savePrefs
} from '../shared/storage-db.js';
import {
  base64ToUint8,
  sanitizeCategoryPath,
  uint8ToBase64,
  utf8ToBase64
} from '../shared/utils.js';

const RESTRICTED_PREFIXES = [
  'chrome://',
  'edge://',
  'about:',
  'moz-extension://',
  'chrome-extension://',
  'view-source:',
  'https://chromewebstore.google.com',
  'https://chrome.google.com/webstore',
  'https://addons.mozilla.org'
];

function isRestrictedUrl(url) {
  if (!url) return true;
  return RESTRICTED_PREFIXES.some((prefix) => url.startsWith(prefix));
}

async function updateTabBadge(tabId, url) {
  if (!tabId || !url || isRestrictedUrl(url)) {
    try {
      await ext.action.setBadgeText({ tabId, text: '' });
    } catch {
      // Tab may already be closed
    }
    return;
  }

  try {
    const match = await findHistoryByUrl(url);
    if (match) {
      await ext.action.setBadgeText({ tabId, text: '已存' });
      await ext.action.setBadgeBackgroundColor({ tabId, color: '#0f766e' });
    } else {
      await ext.action.setBadgeText({ tabId, text: '' });
    }
  } catch {
    // Ignore transient tab query errors
  }
}

async function refreshAllActiveBadges() {
  try {
    const tabs = await ext.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && tab.url) {
        await updateTabBadge(tab.id, tab.url);
      }
    }
  } catch {
    // Ignore
  }
}

async function fetchImageAsDataUrl(url) {
  try {
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) return '';

    const rawType = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const mimeType = rawType.startsWith('image/') ? rawType : 'image/png';
    const buf = await resp.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > 12 * 1024 * 1024) {
      return '';
    }
    const b64 = uint8ToBase64(new Uint8Array(buf));
    return `data:${mimeType};base64,${b64}`;
  } catch {
    return '';
  }
}

async function downloadFileCompat(targetPath, file, { saveAs }) {
  const canBlobUrl = typeof URL?.createObjectURL === 'function';
  let downloadUrl = '';
  let createdBlobUrl = '';

  if (canBlobUrl) {
    const blobContent = file.base64Content
      ? base64ToUint8(file.base64Content)
      : file.textContent || '';
    const blob = new Blob([blobContent], { type: file.mimeType || 'application/octet-stream' });
    createdBlobUrl = URL.createObjectURL(blob);
    downloadUrl = createdBlobUrl;
  } else {
    const b64 = file.base64Content || utf8ToBase64(file.textContent || '');
    const mime = (file.mimeType || 'application/octet-stream').split(';')[0];
    downloadUrl = `data:${mime};base64,${b64}`;
  }

  const downloadId = await ext.downloads.download({
    url: downloadUrl,
    filename: targetPath,
    saveAs: Boolean(saveAs),
    conflictAction: 'uniquify'
  });

  if (createdBlobUrl && downloadId) {
    const session = getSessionStorage();
    const key = `pureclip_blob_${downloadId}`;
    await session.set({ [key]: createdBlobUrl });
  }
}

async function runDownloadsSave(job, prefs) {
  const rootName = sanitizeCategoryPath(prefs.archiveRootName || 'PureClip_素笺').replace(/\//g, '_');
  const category = sanitizeCategoryPath(job.category || '默认归档');

  for (let i = 0; i < job.files.length; i += 1) {
    const file = job.files[i];
    const isPrimary = i === 0;
    const targetPath =
      job.saveAs && isPrimary
        ? file.relativePath
        : `${rootName}/${category}/${file.relativePath}`;

    await downloadFileCompat(targetPath, file, { saveAs: job.saveAs && isPrimary });
  }

  await recordHistory(job.historyEntry);
  await refreshAllActiveBadges();

  return {
    ok: true,
    mode: 'downloads',
    message: job.saveAs
      ? `已唤起「另存为」保存 ${job.files[0]?.relativePath || ''}`
      : `已归档至下载目录「${rootName}/${category}/」`
  };
}

async function runFsBridgeSave(job) {
  const session = getSessionStorage();
  const jobId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const jobKey = `pureclip_write_job_${jobId}`;
  const resKey = `pureclip_write_result_${jobId}`;

  await session.set({ [jobKey]: job });

  const win = await ext.windows.create({
    url: ext.runtime.getURL(`ui/manager.html?mode=writeBridge&jobId=${jobId}`),
    type: 'popup',
    width: 480,
    height: 300
  });

  return await new Promise((resolve) => {
    let settled = false;

    const cleanup = async (result) => {
      if (settled) return;
      settled = true;
      ext.storage.onChanged.removeListener(onStorageChange);
      ext.windows.onRemoved.removeListener(onWinRemoved);
      await session.remove([jobKey, resKey]);
      resolve(result);
    };

    const onStorageChange = (changes) => {
      if (changes[resKey]?.newValue) {
        const res = changes[resKey].newValue;
        cleanup({
          ok: true,
          mode: res.mode,
          message:
            res.mode === 'fsHandle'
              ? `已直接归档至「${res.dirName}/${job.category}/」`
              : `已保存至下载目录「${job.category}/」`
        });
      }
    };

    const onWinRemoved = (removedWinId) => {
      if (win && removedWinId === win.id) {
        setTimeout(async () => {
          const check = await session.get(resKey);
          if (check?.[resKey]) {
            const res = check[resKey];
            await cleanup({
              ok: true,
              mode: res.mode,
              message: `已保存至「${job.category}/」`
            });
          } else {
            await cleanup({ ok: false, error: '已取消写入操作' });
          }
        }, 120);
      }
    };

    ext.storage.onChanged.addListener(onStorageChange);
    ext.windows.onRemoved.addListener(onWinRemoved);
  });
}

/* ---------- Extension Lifecycle & Listeners ---------- */

ext.runtime.onInstalled.addListener(async () => {
  await ensureInitializedStorage();
  try {
    await ext.contextMenus.removeAll();
    ext.contextMenus.create({
      id: 'pc-open-manager',
      title: '打开素笺历史与本地目录设置',
      contexts: ['action']
    });
  } catch {
    // Ignore if menu creation is unsupported
  }
});

ext.contextMenus?.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'pc-open-manager') {
    await ext.tabs.create({ url: ext.runtime.getURL('ui/manager.html') });
  }
});

ext.action.onClicked.addListener(async (tab) => {
  if (!tab?.id || isRestrictedUrl(tab.url)) {
    await ext.tabs.create({ url: ext.runtime.getURL('ui/manager.html') });
    return;
  }

  try {
    await ext.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/extractor.js', 'content/picker.js', 'content/host-overlay.js']
    });
    await ext.tabs.sendMessage(tab.id, { type: 'PC_OPEN_CLIPPER', mode: 'auto' });
  } catch (err) {
    console.warn('PureClip injection failed:', err?.message || err);
    await ext.tabs.create({ url: ext.runtime.getURL('ui/manager.html') });
  }
});

ext.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab?.url) {
    updateTabBadge(tabId, tab.url);
  }
});

ext.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await ext.tabs.get(tabId);
    if (tab?.url) {
      await updateTabBadge(tabId, tab.url);
    }
  } catch {
    // Ignore closed tab
  }
});

ext.downloads?.onChanged.addListener(async (delta) => {
  if (!delta?.state?.current) return;
  if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
    const session = getSessionStorage();
    const key = `pureclip_blob_${delta.id}`;
    const data = await session.get(key);
    const blobUrl = data?.[key];
    if (blobUrl && typeof URL?.revokeObjectURL === 'function') {
      URL.revokeObjectURL(blobUrl);
    }
    await session.remove(key);
  }
});

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  (async () => {
    try {
      switch (message.type) {
        case 'PC_FETCH_IMAGES': {
          const urls = Array.isArray(message.urls) ? message.urls : [];
          const entries = await Promise.all(
            urls.map(async (u) => [u, await fetchImageAsDataUrl(u)])
          );
          sendResponse({ results: Object.fromEntries(entries) });
          break;
        }
        case 'PC_GET_READER_BOOT': {
          await ensureInitializedStorage();
          const [prefs, categories, duplicateMatch] = await Promise.all([
            getPrefs(),
            getCategories(),
            findHistoryByUrl(message.url || sender?.tab?.url || '')
          ]);
          sendResponse({ prefs, categories, duplicateMatch });
          break;
        }
        case 'PC_SAVE_PREFS': {
          const prefs = await savePrefs(message.patch || {});
          sendResponse({ prefs });
          break;
        }
        case 'PC_ADD_CATEGORY': {
          const res = await addCategory(message.category);
          sendResponse(res);
          break;
        }
        case 'PC_RECORD_HISTORY_ONLY': {
          const record = await recordHistory(message.entry);
          await refreshAllActiveBadges();
          sendResponse({ ok: true, record });
          break;
        }
        case 'PC_ARCHIVE_SAVE': {
          const prefs = await getPrefs();
          const job = message.job;
          const rootHandle = !job.saveAs && prefs.preferFsHandle ? await getRootDirHandle() : null;
          if (rootHandle) {
            const res = await runFsBridgeSave(job);
            sendResponse(res);
          } else {
            const res = await runDownloadsSave(job, prefs);
            sendResponse(res);
          }
          break;
        }
        case 'PC_FORCE_DOWNLOAD_JOB': {
          const prefs = await getPrefs();
          const res = await runDownloadsSave(message.job, prefs);
          sendResponse(res);
          break;
        }
        case 'PC_OPEN_MANAGER': {
          await ext.tabs.create({ url: ext.runtime.getURL('ui/manager.html') });
          sendResponse({ ok: true });
          break;
        }
        case 'PC_OPEN_STANDALONE_PRINT': {
          await ext.tabs.create({
            url: ext.runtime.getURL('ui/reader.html?standalonePrint=1')
          });
          sendResponse({ ok: true });
          break;
        }
        case 'PC_REFRESH_ACTIVE_BADGES': {
          await refreshAllActiveBadges();
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, error: `Unknown message: ${message.type}` });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();

  return true;
});
