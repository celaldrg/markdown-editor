/**
 * Keeps the editor and the preview scrolled to the same place, and scrolls
 * the visible panes to a source line (table of contents, ?demo, switching
 * tabs on phones). The browser measures where every block starts in both
 * panes; createScrollMap (scroll-sync.js) maps one position to the other.
 */
import { createScrollMap } from './scroll-sync.js';

// After moving a pane by code, its own scroll events are ignored this long.
const UNLOCK_DELAY = 150;
// A block this close below the top edge already counts as reached.
const TOP_SLACK = 4;
// Textarea styles the mirror copies, so its text wraps exactly like the editor's.
const MIRRORED = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'font-stretch', 'font-feature-settings',
  'font-kerning', 'line-height', 'letter-spacing', 'word-spacing', 'text-indent', 'text-transform', 'tab-size',
  'white-space', 'word-break', 'overflow-wrap', 'padding-top', 'padding-left', 'padding-right',
];

/**
 * @typedef {object} ScrollView
 * @property {() => void} invalidate - the text, the preview or a pane size changed
 * @property {(on: boolean) => void} setLinked - true while both panes are visible side by side
 * @property {(line: number) => void} scrollToLine - shows a source line at the top of every visible pane
 * @property {() => number} topLine - the source line at the top of the pane in use
 */

/**
 * Wires scrolling of the editor and the preview.
 * @param {object} parts
 * @param {Window} parts.win
 * @param {HTMLTextAreaElement} parts.editor
 * @param {HTMLElement} parts.preview - scroll container whose blocks carry data-line
 * @param {HTMLElement} parts.mirror - hidden, absolutely positioned element used to measure the editor
 * @param {(line: number) => void} parts.onTopLine - the source line at the top changed
 * @returns {ScrollView}
 */
export function createScrollView({ win, editor, preview, mirror, onTopLine }) {
  const doc = win.document;
  let linked = true;
  let leader = editor;
  let cache = {};
  let frame = 0;
  let unlockTimer = 0;
  let lastTop = -1;
  const locked = new Set();

  const visible = (pane) => pane.clientHeight > 0;

  /** Source lines that start a block of the preview, ascending. */
  const blockLines = () => {
    const lines = new Set();
    for (const el of preview.querySelectorAll('[data-line]')) lines.add(Number(el.dataset.line));
    return [...lines].sort((a, b) => a - b);
  };

  /** Editor scroll offsets that put each line at the top, measured on a copy of the text. */
  const measureEditor = (lines) => {
    const style = win.getComputedStyle(editor);
    for (const name of MIRRORED) mirror.style.setProperty(name, style.getPropertyValue(name));
    const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    mirror.style.setProperty('width', `${Math.max(0, editor.clientWidth - paddingX)}px`);
    const text = editor.value;
    const parts = [];
    const markers = [];
    let line = 0;
    let offset = 0;
    let copied = 0;
    for (const target of lines) {
      while (line < target && offset !== -1) {
        const next = text.indexOf('\n', offset);
        offset = next === -1 ? -1 : next + 1;
        line += 1;
      }
      if (offset === -1) break;
      const marker = doc.createElement('span');
      parts.push(text.slice(copied, offset), marker);
      markers.push([target, marker]);
      copied = offset;
    }
    // The space keeps a final empty line, which the textarea shows as well.
    parts.push(`${text.slice(copied)} `);
    mirror.replaceChildren(...parts);
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const tops = new Map(markers.map(([target, marker]) => [target, marker.offsetTop - paddingTop]));
    mirror.replaceChildren();
    return tops;
  };

  /** Preview scroll offsets that put each block at the top (the smallest one per line). */
  const measurePreview = () => {
    const paddingTop = parseFloat(win.getComputedStyle(preview).paddingTop) || 0;
    const origin = preview.getBoundingClientRect().top + preview.clientTop - preview.scrollTop + paddingTop;
    const tops = new Map();
    for (const el of preview.querySelectorAll('[data-line]')) {
      const line = Number(el.dataset.line);
      const top = el.getBoundingClientRect().top - origin;
      if (!tops.has(line) || top < tops.get(line)) tops.set(line, top);
    }
    return tops;
  };

  const editorTops = () => {
    if (!cache.editor && visible(editor)) cache.editor = measureEditor(blockLines());
    return cache.editor ?? null;
  };

  const previewTops = () => {
    if (!cache.preview && visible(preview)) cache.preview = measurePreview();
    return cache.preview ?? null;
  };

  const scrollMap = () => {
    if (cache.map) return cache.map;
    const fromEditor = editorTops();
    const fromPreview = previewTops();
    if (!fromEditor || !fromPreview) return null;
    const editorMax = Math.max(0, editor.scrollHeight - editor.clientHeight);
    const previewMax = Math.max(0, preview.scrollHeight - preview.clientHeight);
    // Both ends always meet; inner pairs only where both panes can reach them.
    const pairs = [[0, 0], [editorMax, previewMax]];
    for (const [line, y] of fromPreview) {
      const x = fromEditor.get(line);
      if (x > 0 && x < editorMax && y > 0 && y < previewMax) pairs.push([x, y]);
    }
    cache.map = createScrollMap(pairs);
    return cache.map;
  };

  const setScroll = (pane, value) => {
    const target = Math.round(value);
    if (Math.abs(pane.scrollTop - target) < 1) return;
    locked.add(pane);
    pane.scrollTop = target;
    win.clearTimeout(unlockTimer);
    unlockTimer = win.setTimeout(() => locked.clear(), UNLOCK_DELAY);
  };

  const topLine = () => {
    let pane = leader;
    if (!visible(pane)) pane = visible(editor) ? editor : preview;
    const tops = pane === editor ? editorTops() : previewTops();
    if (!tops) return 0;
    const reached = pane.scrollTop + TOP_SLACK;
    let line = 0;
    for (const [blockLine, top] of tops) if (top <= reached && blockLine > line) line = blockLine;
    return line;
  };

  const reportTop = () => {
    const line = topLine();
    if (line === lastTop) return;
    lastTop = line;
    onTopLine(line);
  };

  const sync = () => {
    frame = 0;
    const map = linked && visible(editor) && visible(preview) ? scrollMap() : null;
    if (map && leader === editor) setScroll(preview, map.toPreview(editor.scrollTop));
    else if (map) setScroll(editor, map.toEditor(preview.scrollTop));
    reportTop();
  };

  const schedule = () => {
    if (!frame) frame = win.requestAnimationFrame(sync);
  };

  const invalidate = () => {
    cache = {};
    schedule();
  };

  for (const pane of [editor, preview]) {
    pane.addEventListener('scroll', () => {
      if (locked.has(pane)) return;
      leader = pane;
      schedule();
    }, { passive: true });
    // Whatever the reader touches or types into leads, even before it scrolls.
    for (const type of ['pointerdown', 'keydown', 'wheel']) {
      pane.addEventListener(type, () => {
        leader = pane;
        locked.delete(pane);
      }, { passive: true });
    }
  }
  // Images change the preview's height when they load (load events do not bubble).
  preview.addEventListener('load', invalidate, true);
  preview.addEventListener('error', invalidate, true);
  if (win.ResizeObserver) {
    const observer = new win.ResizeObserver(invalidate);
    observer.observe(editor);
    observer.observe(preview);
  }

  return {
    invalidate,
    setLinked(on) {
      linked = on;
      invalidate();
    },
    scrollToLine(line) {
      if (visible(editor)) {
        setScroll(editor, measureEditor([line]).get(line) ?? 0);
        leader = editor;
      } else {
        leader = preview;
      }
      const tops = previewTops();
      if (tops) {
        let best = -1;
        let y = 0;
        for (const [blockLine, top] of tops) {
          if (blockLine <= line && blockLine > best) {
            best = blockLine;
            y = top;
          }
        }
        setScroll(preview, y);
      }
      reportTop();
    },
    topLine,
  };
}
