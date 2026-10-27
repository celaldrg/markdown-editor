/**
 * Escaping and URL safety helpers shared by both renderers.
 */
import { decodeEntities } from './entities.js';

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);
const RE_SCHEME = /^([a-z][a-z0-9+.-]*):/i;
// Characters a browser may ignore or that hide a scheme: controls, every
// Unicode space (all that String#trim removes, and more) and invisible
// (default ignorable) characters. They are removed before the scheme check.
const RE_INVISIBLE = /[\p{Cc}\p{White_Space}\p{Default_Ignorable_Code_Point}]/gu;
const RE_URL_UNSAFE = /%(?![0-9A-Fa-f]{2})|[^A-Za-z0-9;/?:@&=+$,\-_.!~*'()#%]/gu;
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/**
 * Escapes text for HTML text content and double-quoted attribute values.
 * @param {string} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * Returns the URL when it is safe to put in an href or src, otherwise null.
 * Only http, https, mailto and relative URLs are kept. The URL is trimmed
 * first and the scheme check runs on exactly that trimmed value, so the
 * string that is checked is the string that is returned. The check looks at
 * a copy with character references decoded (repeatedly) and invisible
 * characters and spaces removed, so obfuscated forms such as
 * `JaVa&#x09;script:` or `&#x2000;javascript:` are caught as well.
 * @param {string} url
 * @returns {string|null}
 */
export function sanitizeUrl(url) {
  if (typeof url !== 'string') return null;
  const value = url.trim();
  let probe = value;
  for (let i = 0; i < 3; i += 1) {
    const decoded = decodeEntities(probe);
    if (decoded === probe) break;
    probe = decoded;
  }
  const match = RE_SCHEME.exec(probe.replace(RE_INVISIBLE, ''));
  return match && !SAFE_SCHEMES.has(match[1].toLowerCase()) ? null : value;
}

/**
 * Percent-encodes characters that are not allowed in a URL, keeping existing
 * `%XX` escapes and URL delimiters intact.
 * @param {string} url
 * @returns {string}
 */
export function encodeUrl(url) {
  return url.replace(RE_URL_UNSAFE, (ch) => {
    if (ch === '%') return '%25';
    try {
      return encodeURIComponent(ch);
    } catch {
      return '%EF%BF%BD'; // lone surrogate
    }
  });
}
