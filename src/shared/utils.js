/**
 * Pure utility functions: URL normalization, safe filename sanitization,
 * chunked Base64 encoding/decoding, date formatting, and HTML escaping.
 */

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'spm',
  'from',
  'isappinstalled',
  'chksm',
  'mpshare',
  'scene',
  'srcid',
  'fbclid',
  'gclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'ref',
  'vd_source',
  'share_source',
  'share_medium'
]);

/**
 * Normalizes a URL by removing common tracking parameters, non-route fragments,
 * and trailing slashes on non-root paths.
 * @param {string} rawUrl
 * @returns {string}
 */
export function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return rawUrl;
    }

    const keysToDelete = [];
    for (const key of parsed.searchParams.keys()) {
      const lower = key.toLowerCase();
      if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      parsed.searchParams.delete(key);
    }
    parsed.searchParams.sort();

    // Preserve SPA hash routes (#/...) while stripping anchor jumps.
    if (parsed.hash && !parsed.hash.startsWith('#/')) {
      parsed.hash = '';
    }

    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Sanitizes a raw title into a Windows/macOS/Linux safe filename stem.
 * @param {string} rawTitle
 * @param {string} [datePrefix]
 * @returns {string}
 */
export function sanitizeFilename(rawTitle, datePrefix = '') {
  let stem = String(rawTitle || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');

  if (stem.length > 80) {
    stem = stem.slice(0, 80).trim().replace(/[.\s]+$/g, '');
  }

  // Guard against Windows reserved device names.
  if (!stem || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) {
    stem = '未命名素笺';
  }

  const cleanPrefix = String(datePrefix || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .trim();

  return cleanPrefix ? `${cleanPrefix}_${stem}` : stem;
}

/**
 * Sanitizes a multi-segment category folder path (e.g. "技术研发/前端").
 * @param {string} rawPath
 * @returns {string}
 */
export function sanitizeCategoryPath(rawPath) {
  const segments = String(rawPath || '')
    .split(/[/\\]+/)
    .map((seg) =>
      seg
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[.\s]+|[.\s]+$/g, '')
    )
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .map((seg) => seg.slice(0, 48));

  return segments.length > 0 ? segments.join('/') : '默认归档';
}

/**
 * Converts a Uint8Array to Base64 in 32KB chunks to avoid call stack overflow.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function uint8ToBase64(bytes) {
  const CHUNK_SIZE = 0x8000;
  const parts = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const slice = bytes.subarray(i, i + CHUNK_SIZE);
    parts.push(String.fromCharCode.apply(null, slice));
  }
  return btoa(parts.join(''));
}

/**
 * Converts a Base64 string into a Uint8Array.
 * @param {string} b64
 * @returns {Uint8Array}
 */
export function base64ToUint8(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encodes a UTF-8 string into Base64 safely.
 * @param {string} str
 * @returns {string}
 */
export function utf8ToBase64(str) {
  const encoder = new TextEncoder();
  return uint8ToBase64(encoder.encode(str));
}

/**
 * Parses a data:image/...;base64,... URL into mimeType, extension, and bytes.
 * @param {string} dataUrl
 * @returns {{ mimeType: string, ext: string, bytes: Uint8Array } | null}
 */
export function dataUrlToParts(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
  if (!match) return null;

  const mimeType = match[1].toLowerCase();
  const extMap = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
    'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico'
  };
  const ext = extMap[mimeType] || 'png';
  try {
    const bytes = base64ToUint8(match[2].replace(/\s+/g, ''));
    return { mimeType, ext, bytes };
  } catch {
    return null;
  }
}

/**
 * Formats a timestamp as YYYY-MM-DD in local time.
 * @param {number} [ts]
 * @returns {string}
 */
export function formatDate(ts = Date.now()) {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Formats a timestamp as YYYY-MM-DD HH:mm in local time.
 * @param {number} [ts]
 * @returns {string}
 */
export function formatDateTime(ts = Date.now()) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${formatDate(ts)} ${hh}:${min}`;
}

/**
 * Escapes HTML special characters.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
