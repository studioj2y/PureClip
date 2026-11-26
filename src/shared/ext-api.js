/**
 * Cross-browser WebExtension API shim for Chromium MV3 and Firefox MV3.
 */

export const ext = globalThis.browser ?? globalThis.chrome;

export const isFirefox =
  typeof globalThis.browser !== 'undefined' &&
  typeof globalThis.browser?.runtime?.getBrowserInfo === 'function';

/**
 * Returns session storage when supported (MV3), falling back to local storage.
 */
export function getSessionStorage() {
  return ext?.storage?.session ?? ext?.storage?.local;
}
