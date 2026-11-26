/**
 * Persistent storage helpers for PureClip preferences, categories, clip history,
 * and IndexedDB FileSystemDirectoryHandle persistence (Chromium).
 */

import { ext } from './ext-api.js';
import { normalizeUrl, sanitizeCategoryPath } from './utils.js';

export const DEFAULT_PREFS = {
  theme: 'paper', // 'white' | 'paper' | 'dark'
  fontFamily: 'serif', // 'sans' | 'serif' | 'kai'
  fontSize: 18,
  lineHeight: 1.8,
  pageMargin: 'normal', // 'compact' | 'normal' | 'wide'
  showImages: true,
  showCodeBlocks: true,
  showMetaHeader: true,
  exportFormat: 'html', // 'html' | 'md' | 'pdf'
  selectedCategory: '默认归档',
  archiveRootName: 'PureClip_素笺',
  preferFsHandle: true
};

export const DEFAULT_CATEGORIES = [
  '默认归档',
  '技术研发',
  '深度长文',
  '资讯剪报',
  '待读清单'
];

const STORAGE_KEYS = {
  PREFS: 'pureclip_prefs',
  CATEGORIES: 'pureclip_categories',
  HISTORY: 'pureclip_history'
};

const MAX_HISTORY_ITEMS = 2000;
const IDB_NAME = 'PureClipFS';
const IDB_STORE = 'handles';
const IDB_ROOT_KEY = 'rootDir';

/**
 * Ensures initial storage keys exist on install.
 */
export async function ensureInitializedStorage() {
  const data = await ext.storage.local.get([
    STORAGE_KEYS.PREFS,
    STORAGE_KEYS.CATEGORIES,
    STORAGE_KEYS.HISTORY
  ]);
  const patch = {};
  if (!data[STORAGE_KEYS.PREFS]) {
    patch[STORAGE_KEYS.PREFS] = { ...DEFAULT_PREFS };
  }
  if (!Array.isArray(data[STORAGE_KEYS.CATEGORIES])) {
    patch[STORAGE_KEYS.CATEGORIES] = [...DEFAULT_CATEGORIES];
  }
  if (!Array.isArray(data[STORAGE_KEYS.HISTORY])) {
    patch[STORAGE_KEYS.HISTORY] = [];
  }
  if (Object.keys(patch).length > 0) {
    await ext.storage.local.set(patch);
  }
}

export async function getPrefs() {
  const res = await ext.storage.local.get(STORAGE_KEYS.PREFS);
  return { ...DEFAULT_PREFS, ...(res[STORAGE_KEYS.PREFS] || {}) };
}

export async function savePrefs(patch) {
  const current = await getPrefs();
  const next = { ...current, ...patch };
  await ext.storage.local.set({ [STORAGE_KEYS.PREFS]: next });
  return next;
}

export async function getCategories() {
  const res = await ext.storage.local.get(STORAGE_KEYS.CATEGORIES);
  const list = Array.isArray(res[STORAGE_KEYS.CATEGORIES])
    ? res[STORAGE_KEYS.CATEGORIES]
    : [...DEFAULT_CATEGORIES];
  if (!list.includes('默认归档')) {
    list.unshift('默认归档');
  }
  return list;
}

export async function addCategory(rawCategory) {
  const clean = sanitizeCategoryPath(rawCategory);
  const list = await getCategories();
  if (!list.includes(clean)) {
    list.push(clean);
    await ext.storage.local.set({ [STORAGE_KEYS.CATEGORIES]: list });
  }
  return { category: clean, categories: list };
}

export async function deleteCategory(category) {
  if (category === '默认归档') return await getCategories();
  const list = await getCategories();
  const next = list.filter((c) => c !== category);
  await ext.storage.local.set({ [STORAGE_KEYS.CATEGORIES]: next });
  return next;
}

export async function mergeDiscoveredCategories(discovered) {
  if (!Array.isArray(discovered) || discovered.length === 0) {
    return await getCategories();
  }
  const list = await getCategories();
  let changed = false;
  for (const item of discovered) {
    const clean = sanitizeCategoryPath(item);
    if (!list.includes(clean)) {
      list.push(clean);
      changed = true;
    }
  }
  if (changed) {
    await ext.storage.local.set({ [STORAGE_KEYS.CATEGORIES]: list });
  }
  return list;
}

export async function getHistory() {
  const res = await ext.storage.local.get(STORAGE_KEYS.HISTORY);
  return Array.isArray(res[STORAGE_KEYS.HISTORY]) ? res[STORAGE_KEYS.HISTORY] : [];
}

export async function findHistoryByUrl(rawUrl) {
  const norm = normalizeUrl(rawUrl);
  if (!norm) return null;
  const history = await getHistory();
  return history.find((item) => item.normalizedUrl === norm) || null;
}

export async function recordHistory(entry) {
  const history = await getHistory();
  const normalizedUrl = normalizeUrl(entry.url);
  const record = {
    id: entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    url: entry.url,
    normalizedUrl,
    title: entry.title || '未命名素笺',
    siteName: entry.siteName || '',
    category: sanitizeCategoryPath(entry.category || '默认归档'),
    format: entry.format || 'html',
    filename: entry.filename || '',
    noteExcerpt: String(entry.noteExcerpt || '').trim().slice(0, 140),
    clippedAt: entry.clippedAt || Date.now()
  };

  const next = [record, ...history].slice(0, MAX_HISTORY_ITEMS);
  await ext.storage.local.set({ [STORAGE_KEYS.HISTORY]: next });
  return record;
}

export async function deleteHistoryItem(id) {
  const history = await getHistory();
  const next = history.filter((item) => item.id !== id);
  await ext.storage.local.set({ [STORAGE_KEYS.HISTORY]: next });
  return next;
}

export async function clearHistory() {
  await ext.storage.local.set({ [STORAGE_KEYS.HISTORY]: [] });
}

/* ---------- IndexedDB FileSystemDirectoryHandle Persistence ---------- */

function openFsDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getRootDirHandle() {
  try {
    const db = await openFsDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(IDB_ROOT_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function setRootDirHandle(handle) {
  const db = await openFsDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const req = store.put(handle, IDB_ROOT_KEY);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function clearRootDirHandle() {
  const db = await openFsDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const req = store.delete(IDB_ROOT_KEY);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Checks handle permission without triggering a user prompt.
 * @param {FileSystemDirectoryHandle | null} handle
 * @returns {Promise<'granted' | 'prompt' | 'denied' | 'none'>}
 */
export async function queryDirPermission(handle) {
  if (!handle || typeof handle.queryPermission !== 'function') return 'none';
  try {
    return await handle.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'none';
  }
}

/**
 * Scans 1st and 2nd level subdirectories under rootHandle (excluding assets).
 * @param {FileSystemDirectoryHandle} rootHandle
 * @returns {Promise<string[]>}
 */
export async function scanSubfolders(rootHandle) {
  const folders = [];
  if (!rootHandle) return folders;
  const perm = await queryDirPermission(rootHandle);
  if (perm !== 'granted') return folders;

  try {
    for await (const [name, entry] of rootHandle.entries()) {
      if (entry.kind !== 'directory' || name.startsWith('.') || name === 'assets') {
        continue;
      }
      folders.push(name);
      try {
        for await (const [subName, subEntry] of entry.entries()) {
          if (
            subEntry.kind === 'directory' &&
            !subName.startsWith('.') &&
            subName !== 'assets'
          ) {
            folders.push(`${name}/${subName}`);
          }
        }
      } catch {
        // Ignore unreadable subfolder
      }
    }
  } catch {
    // Ignore permission errors
  }

  return folders.sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

/**
 * Writes an array of { relativePath, content } files into <rootHandle>/<categoryPath>/.
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {string} categoryPath
 * @param {Array<{ relativePath: string, content: string | Uint8Array }>} files
 */
export async function writeBundleToHandle(rootHandle, categoryPath, files) {
  if (!rootHandle) throw new Error('尚未绑定本地总目录');

  let perm = await rootHandle.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted') {
    perm = await rootHandle.requestPermission({ mode: 'readwrite' });
  }
  if (perm !== 'granted') {
    throw new Error('未获得本地文件夹写入权限');
  }

  const cleanCategory = sanitizeCategoryPath(categoryPath);
  let categoryDir = rootHandle;
  for (const seg of cleanCategory.split('/')) {
    categoryDir = await categoryDir.getDirectoryHandle(seg, { create: true });
  }

  for (const file of files) {
    const parts = file.relativePath.split('/').filter(Boolean);
    const filename = parts.pop();
    if (!filename) continue;

    let targetDir = categoryDir;
    for (const dirSeg of parts) {
      targetDir = await targetDir.getDirectoryHandle(dirSeg, { create: true });
    }

    const fileHandle = await targetDir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(file.content);
    await writable.close();
  }
}
