/**
 * The Markdown textarea and its formatting toolbar. Edits made by the
 * toolbar, the shortcuts and list continuation go through the browser's
 * insertText command where it is available, so Ctrl+Z undoes them like
 * ordinary typing.
 */
import { applyAction, continueList, diffRange, indent, shortcutAction } from './editor-ops.js';

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

/**
 * @typedef {object} EditorView
 * @property {(text: string) => void} load - shows another document from its start
 * @property {(text: string) => void} replace - changes the text without moving the focus (task checkboxes)
 * @property {() => void} focus
 */

/**
 * Wires the editor textarea and the toolbar buttons (`data-action`).
 * @param {object} parts
 * @param {Document} parts.doc
 * @param {HTMLTextAreaElement} parts.editor
 * @param {HTMLElement} parts.toolbar - role="toolbar" holding the action buttons
 * @param {(text: string) => void} parts.onChange - called after every change of the text
 * @param {() => {header: string, cell: string}} parts.tableLabels - cell texts of a new table
 * @returns {EditorView}
 */
export function createEditorView({ doc, editor, toolbar, onChange, tableLabels }) {
  const buttons = [...toolbar.querySelectorAll('button[data-action]')];
  // After Escape the next Tab leaves the editor instead of indenting.
  let tabLeaves = false;

  const current = () => ({ text: editor.value, start: editor.selectionStart, end: editor.selectionEnd });

  const runCommand = (insert) => {
    try {
      return insert === '' ? doc.execCommand('delete') : doc.execCommand('insertText', false, insert);
    } catch {
      return false;
    }
  };

  /** Applies a state from editor-ops as one undoable edit and selects its range. */
  const apply = (next) => {
    const before = editor.value;
    if (next.text !== before) {
      const { from, to, insert } = diffRange(before, next.text);
      if (doc.activeElement !== editor) editor.focus({ preventScroll: true });
      editor.setSelectionRange(from, to);
      // execCommand fires the input event itself; the fallback has to report the change.
      if (!runCommand(insert) || editor.value !== next.text) {
        const scroll = editor.scrollTop;
        editor.value = next.text;
        editor.scrollTop = scroll;
        onChange(editor.value);
      }
    }
    editor.setSelectionRange(next.start, next.end);
  };

  const runAction = (action) => apply(applyAction(current(), action, { labels: tableLabels() }));

  editor.addEventListener('input', () => onChange(editor.value));
  editor.addEventListener('blur', () => {
    tabLeaves = false;
  });
  editor.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229 || MODIFIERS.has(event.key)) return;
    const leave = tabLeaves;
    tabLeaves = event.key === 'Escape';
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (event.key === 'Tab' && plain) {
      if (leave) return;
      event.preventDefault();
      apply(indent(current(), event.shiftKey));
      return;
    }
    const action = shortcutAction(event);
    if (action) {
      event.preventDefault();
      runAction(action);
      return;
    }
    if (event.key === 'Enter' && plain && !event.shiftKey) {
      const next = continueList(current());
      if (next) {
        event.preventDefault();
        apply(next);
      }
    }
  });

  // Clicking a tool must not take the focus (and the phone keyboard) from the editor.
  toolbar.addEventListener('mousedown', (event) => {
    if (event.target.closest('button')) event.preventDefault();
  });
  toolbar.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (button) runAction(button.dataset.action);
  });
  // One tab stop for the whole toolbar; the arrow keys move between tools.
  buttons.forEach((button, index) => {
    button.tabIndex = index === 0 ? 0 : -1;
  });
  toolbar.addEventListener('keydown', (event) => {
    const index = buttons.indexOf(event.target.closest('button'));
    const moves = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: buttons.length - 1 };
    if (index === -1 || !Object.hasOwn(moves, event.key)) return;
    event.preventDefault();
    const next = buttons[(moves[event.key] + buttons.length) % buttons.length];
    buttons[index].tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  });

  return {
    load(text) {
      editor.value = text;
      editor.setSelectionRange(0, 0);
      editor.scrollTop = 0;
    },
    replace(text) {
      const before = editor.value;
      if (text === before) return;
      const { from, to, insert } = diffRange(before, text);
      const scroll = editor.scrollTop;
      editor.setRangeText(insert, from, to, 'preserve');
      editor.scrollTop = scroll;
      onChange(editor.value);
    },
    focus() {
      editor.focus();
    },
  };
}
