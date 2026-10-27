/**
 * The two sidebar lists: the documents (open, rename, delete) and the table
 * of contents of the open document, which marks the section in view.
 */
import { h, icon } from './dom.js';
import { ID_PREFIX } from './preview-view.js';

const MAX_DEPTH = 4;

/**
 * @typedef {object} DocLabels
 * @property {string} untitled - shown for a document without a title
 * @property {(title: string) => string} rename - accessible name of a rename button
 * @property {(title: string) => string} remove - accessible name of a delete button
 * @property {(ms: number) => string} date - formats the last change
 */

/**
 * @typedef {object} SidebarView
 * @property {(docs: Array<{id: string, title: string, updatedAt: number}>, activeId: string, labels: DocLabels) => void} renderDocs
 * @property {(entries: import('./toc.js').TocEntry[]) => void} renderToc
 * @property {(line: number) => void} setTopLine - marks the last heading at or above that source line
 */

/**
 * Wires the document list and the table of contents.
 * @param {object} parts
 * @param {Document} parts.doc
 * @param {HTMLElement} parts.docList - <ul>
 * @param {HTMLElement} parts.tocList - <ul>
 * @param {HTMLElement} parts.tocEmpty - shown instead of the list when there are no headings
 * @param {(action: 'open'|'rename'|'remove', id: string) => void} parts.onDoc
 * @param {(line: number) => void} parts.onHeading - a heading on that source line was chosen
 * @returns {SidebarView}
 */
export function createSidebarView({ doc, docList, tocList, tocEmpty, onDoc, onHeading }) {
  let topLine = 0;
  let marked = null;

  docList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-doc]');
    if (button) onDoc(button.dataset.docAction, button.dataset.doc);
  });

  tocList.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-line]');
    if (!link) return;
    event.preventDefault();
    onHeading(Number(link.dataset.line));
  });

  const docButton = (className, id, action, attrs, children) => h(doc, 'button', {
    className,
    attrs: { type: 'button', 'data-doc': id, 'data-doc-action': action, ...attrs },
  }, children);

  const markTop = () => {
    let current = null;
    for (const link of tocList.querySelectorAll('a[data-line]')) {
      if (Number(link.dataset.line) > topLine) break;
      current = link;
    }
    if (current === marked) return;
    marked?.removeAttribute('aria-current');
    current?.setAttribute('aria-current', 'location');
    marked = current;
  };

  return {
    renderDocs(docs, activeId, labels) {
      const focused = docList.contains(doc.activeElement) ? { ...doc.activeElement.dataset } : null;
      docList.replaceChildren(...docs.map((item) => {
        const title = item.title || labels.untitled;
        const active = item.id === activeId;
        const open = docButton('doc-open', item.id, 'open', active ? { 'aria-current': 'true' } : {}, [
          h(doc, 'span', { className: item.title ? 'doc-name' : 'doc-name untitled', text: title }),
          h(doc, 'span', { className: 'doc-date', text: labels.date(item.updatedAt) }),
        ]);
        const rename = docButton('icon-btn doc-action', item.id, 'rename', { 'aria-label': labels.rename(title), title: labels.rename(title) }, [icon(doc, 'edit')]);
        const remove = docButton('icon-btn doc-action danger', item.id, 'remove', { 'aria-label': labels.remove(title), title: labels.remove(title) }, [icon(doc, 'trash')]);
        return h(doc, 'li', { className: active ? 'doc-item active' : 'doc-item' }, [open, rename, remove]);
      }));
      if (!focused) return;
      // Keep the keyboard focus on the same button, or on the open document when that button is gone.
      const buttons = [...docList.querySelectorAll('button[data-doc]')];
      const same = buttons.find((b) => b.dataset.doc === focused.doc && b.dataset.docAction === focused.docAction);
      (same ?? buttons.find((b) => b.dataset.doc === activeId && b.dataset.docAction === 'open'))?.focus();
    },

    renderToc(entries) {
      tocList.replaceChildren(...entries.map((entry) => {
        const link = h(doc, 'a', {
          className: 'toc-link',
          text: entry.text,
          attrs: { href: `#${ID_PREFIX}${entry.id}`, 'data-line': String(entry.line) },
        });
        link.style.setProperty('--depth', String(Math.min(entry.depth, MAX_DEPTH)));
        return h(doc, 'li', {}, [link]);
      }));
      tocList.hidden = entries.length === 0;
      tocEmpty.hidden = entries.length > 0;
      marked = null;
      markTop();
    },

    setTopLine(line) {
      topLine = line;
      markTop();
    },
  };
}
