/**
 * Builds the files the editor exports: a standalone HTML page with a small
 * embedded stylesheet, and safe download file names.
 */
import { parse } from './parser.js';
import { renderHtml } from './render.js';
import { escapeHtml } from './url.js';

const RE_LANG_TAG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const RE_FILE_UNSAFE = /[\u{0}-\u{1f}\u{7f}<>:"/\\|?*]+/gu;
const MAX_FILE_NAME = 80;

/** Content Security Policy of exported pages: no scripts, plugins, forms or base URL changes. */
export const EXPORT_CSP = "script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

const EXPORT_CSS = [
  ':root{color-scheme:light dark;--bg:#ffffff;--fg:#1e293b;--muted:#64748b;--line:#e2e8f0;--code:#f1f5f9;--accent:#2563eb}',
  '@media (prefers-color-scheme:dark){:root{--bg:#0f172a;--fg:#e2e8f0;--muted:#94a3b8;--line:#334155;--code:#1e293b;--accent:#60a5fa}}',
  '*{box-sizing:border-box}',
  'body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
  '.markdown-body{max-width:760px;margin:0 auto;padding:32px 20px 64px;overflow-wrap:break-word}',
  'h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.6em 0 .6em}',
  'h1,h2{padding-bottom:.3em;border-bottom:1px solid var(--line)}',
  'a{color:var(--accent)}',
  'code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:.9em}',
  'code{background:var(--code);padding:.15em .35em;border-radius:6px}',
  'pre{background:var(--code);padding:14px 16px;border-radius:12px;overflow:auto}',
  'pre code{background:none;padding:0}',
  'blockquote{margin:1em 0;padding:.2em 1em;border-left:4px solid var(--accent);color:var(--muted)}',
  'table{border-collapse:collapse;display:block;max-width:100%;overflow:auto}',
  'th,td{border:1px solid var(--line);padding:6px 12px}',
  'img{max-width:100%;height:auto}',
  'hr{border:0;border-top:1px solid var(--line);margin:2em 0}',
  '.contains-task-list{list-style:none;padding-left:1.4em}',
  '.task-list-item input{margin:0 .45em 0 -1.4em}',
].join('\n');

/**
 * Renders Markdown as a complete, standalone HTML document. The page carries
 * a Content Security Policy that blocks scripts, so even a hostile document
 * stays inert.
 * @param {string} markdown
 * @param {{title?: string, lang?: string}} [options]
 * @returns {string}
 */
export function exportHtmlDocument(markdown, { title = '', lang = 'en' } = {}) {
  const pageLang = RE_LANG_TAG.test(String(lang)) ? lang : 'en';
  const pageTitle = String(title).trim() || 'Document';
  return [
    '<!doctype html>',
    `<html lang="${pageLang}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}">`,
    `<title>${escapeHtml(pageTitle)}</title>`,
    `<style>\n${EXPORT_CSS}\n</style>`,
    '</head>',
    '<body>',
    '<main class="markdown-body">',
    `${renderHtml(parse(markdown))}</main>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/**
 * Turns a document title into a safe download file name: characters that
 * file systems reject are replaced, the length is limited and an empty
 * result becomes "document".
 * @param {string} title
 * @param {string} extension - without the dot, e.g. "md" or "html"
 * @returns {string}
 */
export function toFileName(title, extension) {
  const cleaned = String(title ?? '')
    .normalize('NFC')
    .replace(RE_FILE_UNSAFE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  const base = Array.from(cleaned).slice(0, MAX_FILE_NAME).join('').trim();
  return `${base || 'document'}.${extension}`;
}
