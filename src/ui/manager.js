import { ext, getSessionStorage } from '../shared/ext-api.js';
import {
  addCategory,
  clearHistory,
  clearRootDirHandle,
  deleteCategory,
  deleteHistoryItem,
  getCategories,
  getHistory,
  getPrefs,
  getRootDirHandle,
  mergeDiscoveredCategories,
  queryDirPermission,
  recordHistory,
  savePrefs,
  scanSubfolders,
  setRootDirHandle,
  writeBundleToHandle
} from '../shared/storage-db.js';
import { base64ToUint8, formatDateTime, sanitizeCategoryPath } from '../shared/utils.js';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'manager';
const jobId = params.get('jobId') || '';

function el(id) {
  return document.getElementById(id);
}

function showToast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.add('hidden'), 3200);
}

function jobFilesToWritableArray(files) {
  return files.map((f) => ({
    relativePath: f.relativePath,
    content: f.base64Content ? base64ToUint8(f.base64Content) : f.textContent || ''
  }));
}

async function runWriteBridge() {
  el('manager-view').classList.add('hidden');
  el('bridge-view').classList.remove('hidden');

  const storage = getSessionStorage();
  const jobKey = `pureclip_write_job_${jobId}`;
  const resKey = `pureclip_write_result_${jobId}`;
  const data = await storage.get(jobKey);
  const job = data?.[jobKey];

  if (!job) {
    el('bridge-status').textContent = '写入任务已失效或不存在。';
    return;
  }

  const handle = await getRootDirHandle();
  if (!handle) {
    el('bridge-status').textContent = '尚未绑定本地总目录，是否直接保存到系统下载目录？';
    el('btn-bridge-fallback').classList.remove('hidden');
    el('btn-bridge-fallback').addEventListener('click', async () => {
      await ext.runtime.sendMessage({ type: 'PC_FORCE_DOWNLOAD_JOB', job });
      await storage.set({ [resKey]: { ok: true, mode: 'downloads' } });
      await storage.remove(jobKey);
      window.close();
    });
    return;
  }

  const perm = await queryDirPermission(handle);
  if (perm === 'granted') {
    await executeHandleWrite(handle, job, storage, jobKey, resKey);
    return;
  }

  el('bridge-status').textContent = `浏览器重启后需点击一次以恢复对本地目录「${handle.name}」的写入权限。`;
  const grantBtn = el('btn-bridge-grant');
  const fallbackBtn = el('btn-bridge-fallback');
  grantBtn.classList.remove('hidden');
  fallbackBtn.classList.remove('hidden');

  grantBtn.addEventListener('click', async () => {
    try {
      await executeHandleWrite(handle, job, storage, jobKey, resKey);
    } catch (err) {
      el('bridge-status').textContent = `写入失败：${err?.message || err}`;
    }
  });

  fallbackBtn.addEventListener('click', async () => {
    await ext.runtime.sendMessage({ type: 'PC_FORCE_DOWNLOAD_JOB', job });
    await storage.set({ [resKey]: { ok: true, mode: 'downloads' } });
    await storage.remove(jobKey);
    window.close();
  });
}

async function executeHandleWrite(handle, job, storage, jobKey, resKey) {
  await writeBundleToHandle(handle, job.category, jobFilesToWritableArray(job.files));
  await recordHistory(job.historyEntry);
  await ext.runtime.sendMessage({ type: 'PC_REFRESH_ACTIVE_BADGES' });
  await storage.set({ [resKey]: { ok: true, mode: 'fsHandle', dirName: handle.name } });
  await storage.remove(jobKey);
  window.close();
}

/* ---------- Full Manager View ---------- */

let allHistory = [];
let allCategories = [];

async function refreshFsUi() {
  const supportsFsPicker = typeof window.showDirectoryPicker === 'function';
  if (supportsFsPicker) {
    el('chromium-fs-panel').classList.remove('hidden');
    const handle = await getRootDirHandle();
    const perm = await queryDirPermission(handle);

    const nameEl = el('fs-dir-name');
    const badge = el('fs-perm-badge');
    const regrantBtn = el('btn-regrant-dir');
    const syncBtn = el('btn-sync-dirs');
    const unbindBtn = el('btn-unbind-dir');

    if (!handle) {
      nameEl.textContent = '未绑定（当前自动保存至浏览器默认下载目录）';
      badge.textContent = '';
      badge.className = 'badge';
      regrantBtn.classList.add('hidden');
      syncBtn.classList.add('hidden');
      unbindBtn.classList.add('hidden');
    } else {
      nameEl.textContent = handle.name;
      unbindBtn.classList.remove('hidden');
      if (perm === 'granted') {
        badge.textContent = '已授权可写';
        badge.className = 'badge ok';
        regrantBtn.classList.add('hidden');
        syncBtn.classList.remove('hidden');
      } else {
        badge.textContent = '需点击恢复权限';
        badge.className = 'badge warn';
        regrantBtn.classList.remove('hidden');
        syncBtn.classList.add('hidden');
      }
    }
  } else {
    el('firefox-fs-panel').classList.remove('hidden');
    const prefs = await getPrefs();
    el('archive-root-input').value = prefs.archiveRootName || 'PureClip_素笺';

    const permBtn = el('btn-fx-host-perm');
    if (ext.permissions?.contains) {
      const hasAll = await ext.permissions.contains({ origins: ['<all_urls>'] });
      permBtn.textContent = hasAll ? '✓ 已开启全站图片防盗链补抓' : '授权全站防盗链图片补抓';
      permBtn.disabled = hasAll;
    }
  }
}

async function refreshCategoriesUi() {
  allCategories = await getCategories();
  const listEl = el('cat-list');
  const filterCat = el('filter-category');
  const prevFilter = filterCat.value;

  listEl.innerHTML = '';
  filterCat.innerHTML = '<option value="">全部分类</option>';

  for (const cat of allCategories) {
    const pill = document.createElement('span');
    pill.className = 'cat-pill';
    const label = document.createElement('span');
    label.textContent = cat;
    pill.appendChild(label);

    if (cat !== '默认归档') {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'cat-del';
      delBtn.textContent = '×';
      delBtn.title = '从列表中移除该分类（不会删除磁盘已有文件）';
      delBtn.addEventListener('click', async () => {
        await deleteCategory(cat);
        await refreshCategoriesUi();
      });
      pill.appendChild(delBtn);
    }
    listEl.appendChild(pill);

    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    if (cat === prevFilter) opt.selected = true;
    filterCat.appendChild(opt);
  }
}

function renderHistoryList() {
  const q = el('search-input').value.trim().toLowerCase();
  const catFilter = el('filter-category').value;
  const fmtFilter = el('filter-format').value;

  const filtered = allHistory.filter((item) => {
    if (catFilter && item.category !== catFilter) return false;
    if (fmtFilter && item.format !== fmtFilter) return false;
    if (q) {
      const hay = `${item.title} ${item.url} ${item.noteExcerpt || ''} ${item.siteName || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  el('history-count').textContent = String(filtered.length);
  const listEl = el('history-list');
  listEl.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = allHistory.length === 0 ? '还没有剪藏记录，打开任意网页点击「素笺」图标即可开始。' : '没有符合当前筛选条件的剪藏记录。';
    listEl.appendChild(empty);
    return;
  }

  for (const item of filtered) {
    const row = document.createElement('div');
    row.className = 'history-item';

    const main = document.createElement('div');
    main.className = 'history-main';

    const link = document.createElement('a');
    link.className = 'history-title';
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = item.title || item.url;

    const meta = document.createElement('div');
    meta.className = 'history-meta';
    meta.innerHTML = `
      <span>分类：<strong>${escapeText(item.category)}</strong></span>
      <span>格式：<strong>${escapeText(String(item.format || 'html').toUpperCase())}</strong></span>
      ${item.siteName ? `<span>来源：${escapeText(item.siteName)}</span>` : ''}
      <span>时间：${escapeText(formatDateTime(item.clippedAt))}</span>
    `;

    main.append(link, meta);

    if (item.noteExcerpt) {
      const note = document.createElement('div');
      note.className = 'history-note';
      note.textContent = `备注：${item.noteExcerpt}`;
      main.appendChild(note);
    }

    const actions = document.createElement('div');
    actions.className = 'history-actions';
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'tool-btn';
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', async () => {
      allHistory = await deleteHistoryItem(item.id);
      renderHistoryList();
      await ext.runtime.sendMessage({ type: 'PC_REFRESH_ACTIVE_BADGES' });
    });
    actions.appendChild(delBtn);

    row.append(main, actions);
    listEl.appendChild(row);
  }
}

function escapeText(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

async function initManagerView() {
  await refreshFsUi();
  await refreshCategoriesUi();
  allHistory = await getHistory();
  renderHistoryList();

  // Chromium FS bindings
  el('btn-pick-dir').addEventListener('click', async () => {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await setRootDirHandle(handle);
      await savePrefs({ preferFsHandle: true });
      const discovered = await scanSubfolders(handle);
      await mergeDiscoveredCategories(discovered);
      await refreshFsUi();
      await refreshCategoriesUi();
      showToast(`已绑定本地总目录「${handle.name}」并同步子目录`);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        showToast(`绑定失败：${err?.message || err}`);
      }
    }
  });

  el('btn-regrant-dir').addEventListener('click', async () => {
    const handle = await getRootDirHandle();
    if (!handle) return;
    const perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      const discovered = await scanSubfolders(handle);
      await mergeDiscoveredCategories(discovered);
      await refreshFsUi();
      await refreshCategoriesUi();
      showToast('写入权限已恢复');
    }
  });

  el('btn-sync-dirs').addEventListener('click', async () => {
    const handle = await getRootDirHandle();
    if (!handle) return;
    const discovered = await scanSubfolders(handle);
    await mergeDiscoveredCategories(discovered);
    await refreshCategoriesUi();
    showToast(`已同步磁盘子文件夹（共 ${discovered.length} 个）`);
  });

  el('btn-unbind-dir').addEventListener('click', async () => {
    await clearRootDirHandle();
    await refreshFsUi();
    showToast('已解绑，后续将保存至浏览器默认下载目录');
  });

  // Firefox settings
  el('btn-save-root-name').addEventListener('click', async () => {
    const val = sanitizeCategoryPath(el('archive-root-input').value || 'PureClip_素笺').replace(/\//g, '_');
    el('archive-root-input').value = val;
    await savePrefs({ archiveRootName: val });
    showToast(`已更新下载归档根目录为「${val}」`);
  });

  el('btn-fx-host-perm').addEventListener('click', async () => {
    if (!ext.permissions?.request) return;
    const granted = await ext.permissions.request({ origins: ['<all_urls>'] });
    await refreshFsUi();
    showToast(granted ? '已开启全站图片防盗链补抓' : '未授予全站权限，仍可使用单页剪藏');
  });

  // Category creation
  el('cat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = el('cat-input').value.trim();
    if (!val) return;
    const res = await addCategory(val);
    el('cat-input').value = '';
    await refreshCategoriesUi();
    showToast(`已添加分类「${res.category}」`);
  });

  // History filters
  el('search-input').addEventListener('input', renderHistoryList);
  el('filter-category').addEventListener('change', renderHistoryList);
  el('filter-format').addEventListener('change', renderHistoryList);

  el('btn-export-json').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(allHistory, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PureClip_History_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  el('btn-clear-history').addEventListener('click', async () => {
    await clearHistory();
    allHistory = [];
    renderHistoryList();
    await ext.runtime.sendMessage({ type: 'PC_REFRESH_ACTIVE_BADGES' });
    showToast('已清空历史记录');
  });
}

if (mode === 'writeBridge' && jobId) {
  runWriteBridge();
} else {
  initManagerView();
}
