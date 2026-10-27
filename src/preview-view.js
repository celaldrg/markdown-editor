/**
 * The live preview. The document is rendered with renderDom (elements and
 * text nodes only), fenced code is highlighted with spans filled through
 * textContent, task checkboxes edit the source and in-page links scroll the
 * preview instead of changing the address.
 */
import { h } from './dom.js';
import { highlight, isHighlighted } from './highlight.js';
import { renderDom } from './render.js';

/** Prefix of heading ids in the preview, so headings cannot clash with the app's own ids. */
export const ID_PREFIX = 'md-';

const LANGUAGE_CLASS = 'language-';

/**
 * @typedef {object} PreviewView
 * @property {(ast: object, emptyText: string) => void} render - shows a parsed document
 * @property {(line: number) => void} focusTask - focuses the checkbox of the task on that source line
 */

/**
 * Wires the preview element.
 * @param {object} parts
 * @param {Document} parts.doc
 * @param {HTMLElement} parts.preview
 * @param {(line: number) => void} parts.onToggleTask - the checkbox of the task on that source line was clicked
 * @param {(target: HTMLElement) => void} parts.onJump - an in-page link to that element was followed
 * @returns {PreviewView}
 */
export function createPreviewView({ doc, preview, onToggleTask, onJump }) {
  preview.addEventListener('change', (event) => {
    const item = event.target.matches('input[type="checkbox"]') ? event.target.closest('li[data-line]') : null;
    if (item) onToggleTask(Number(item.dataset.line));
  });

  preview.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    event.preventDefault();
    let id = link.getAttribute('href').slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // A malformed escape: look the id up as written.
    }
    const target = id === '' ? null : doc.getElementById(id);
    if (target && preview.contains(target)) onJump(target);
  });

  const highlightBlock = (code) => {
    const lang = code.className.slice(LANGUAGE_CLASS.length);
    if (!isHighlighted(lang)) return;
    code.replaceChildren(...highlight(code.textContent, lang).map((token) => (token.type === 'plain'
      ? token.text
      : h(doc, 'span', { className: `tok-${token.type}`, text: token.text }))));
  };

  return {
    render(ast, emptyText) {
      const fragment = renderDom(ast, doc, { idPrefix: ID_PREFIX, sourceLines: true, externalLinks: true, interactiveTasks: true });
      for (const code of fragment.querySelectorAll(`pre > code[class^="${LANGUAGE_CLASS}"]`)) highlightBlock(code);
      // Relative links would navigate away from the editor; open them in a new tab as well.
      for (const link of fragment.querySelectorAll('a[href]:not([href^="#"]):not([target])')) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
      if (!fragment.firstChild) fragment.append(h(doc, 'p', { className: 'preview-empty', text: emptyText }));
      preview.replaceChildren(fragment);
    },
    focusTask(line) {
      const box = preview.querySelector(`li[data-line="${Number(line)}"] input[type="checkbox"]`);
      box?.focus({ preventScroll: true });
    },
  };
}
