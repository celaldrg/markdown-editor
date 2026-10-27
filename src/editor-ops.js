/**
 * Pure text operations behind the toolbar, the keyboard shortcuts and the
 * clickable task checkboxes. They work on an editor state {text, start, end}
 * (start and end are textarea selection offsets) and return a new state that
 * the UI writes back to the textarea.
 */

/** @typedef {{text: string, start: number, end: number}} EditorState */

/** Toolbar actions understood by applyAction(), in toolbar order. */
export const ACTIONS = Object.freeze(['bold', 'italic', 'heading', 'list', 'task', 'link', 'code', 'quote', 'table']);

const INDENT = '  ';
const RE_HEADING_PREFIX = /^ {0,3}(#{1,6})(?:[ \t]+|$)/;
const RE_MARKER = /^(?:([-*+])|\d{1,9}[.)])(?:[ \t]+|$)/;
const RE_TASK_BOX = /^\[[ xX]\](?:[ \t]+|$)/;
const RE_QUOTE_PREFIX = /^ {0,3}> ?/;
const RE_URL = /^(?:https?:\/\/|mailto:|www\.)\S+$/i;
const RE_TASK_LINE = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([ xX])\]/;
// Groups: 1 quote markers, 2 indentation, 3 bullet, 4 number, 5 delimiter, 6 spacing, 7 task box.
const RE_LIST_ITEM = /^((?:[ \t]*>[ \t]?)*)([ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\](?:[ \t]+|$))?/;
const RE_QUOTE_ONLY = /^(?:[ \t]*>[ \t]?)+/;
const RE_THEMATIC_BREAK = /^(?:[ \t]*>[ \t]?)*[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const RE_FENCE = /^(?:[ \t]*>[ \t]?)*[ \t]{0,3}(`{3,}|~{3,})/;

/**
 * Applies a toolbar action to the editor state.
 * bold/italic/code toggle inline markers around the selection, heading cycles
 * the current line through none, #, ## and ###, list/task/quote toggle a line
 * prefix on every selected line, link wraps the selection in a link and table
 * inserts a table template as its own block.
 * @param {EditorState} state
 * @param {string} action - one of ACTIONS
 * @param {{labels?: {header?: string, cell?: string}}} [options] - table labels
 * @returns {EditorState}
 */
export function applyAction(state, action, options = {}) {
  switch (action) {
    case 'bold':
      return toggleWrap(state, '**');
    case 'italic':
      return toggleWrap(state, '_');
    case 'heading':
      return cycleHeading(state);
    case 'list':
    case 'task':
      return toggleListPrefix(state, action);
    case 'quote':
      return toggleQuote(state);
    case 'code':
      return toggleCode(state);
    case 'link':
      return insertLink(state);
    case 'table':
      return insertTable(state, options.labels);
    default:
      return { ...state };
  }
}

/**
 * Tab / Shift+Tab: inserts two spaces at the caret, or indents (outdents)
 * every selected line when the selection spans several lines.
 * @param {EditorState} state
 * @param {boolean} [outdent=false]
 * @returns {EditorState}
 */
export function indent(state, outdent = false) {
  const { text, start, end } = state;
  if (!outdent && !text.slice(start, end).includes('\n')) {
    return { text: text.slice(0, start) + INDENT + text.slice(end), start: start + INDENT.length, end: start + INDENT.length };
  }
  return editLines(state, (line) => {
    if (!outdent) return line.trim() === '' ? null : { from: 0, to: 0, insert: INDENT };
    const width = line.startsWith('\t') ? 1 : /^ {0,2}/.exec(line)[0].length;
    return width > 0 ? { from: 0, to: width, insert: '' } : null;
  });
}

/**
 * Maps a keyboard event to a toolbar action: Ctrl/Cmd+B bold, Ctrl/Cmd+I
 * italic, Ctrl/Cmd+K link. Shift or Alt combinations are left alone.
 * @param {{key: string, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean, altKey?: boolean}} event
 * @returns {'bold'|'italic'|'link'|null}
 */
export function shortcutAction(event) {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return null;
  switch (String(event.key).toLowerCase()) {
    case 'b':
      return 'bold';
    case 'i':
    case '\u{131}': // dotless i: the "I" key of a Turkish keyboard
      return 'italic';
    case 'k':
      return 'link';
    default:
      return null;
  }
}

/**
 * Enter inside a list item or block quote: continues the list on a new line
 * (the next number, an unchecked box after a task) or the quote. Enter on an
 * empty item or quote line ends the list or quote instead. Returns null when
 * Enter should insert a plain line break: with a selection, with the caret
 * inside the marker, on other lines, on a thematic break and inside a fenced
 * code block.
 * @param {EditorState} state
 * @returns {EditorState|null}
 */
export function continueList(state) {
  const { text, start, end } = state;
  if (start !== end) return null;
  const lineStart = lineStartOffset(text, lineIndexAt(text, start));
  const line = text.slice(lineStart, lineEndOffset(text, lineStart));
  if (RE_THEMATIC_BREAK.test(line) || insideFence(text, lineStart)) return null;
  const item = RE_LIST_ITEM.exec(line);
  const prefix = item ? item[0] : (RE_QUOTE_ONLY.exec(line)?.[0] ?? '');
  if (prefix === '' || start - lineStart < prefix.length) return null;
  if (line.slice(prefix.length).trim() === '') {
    const kept = item ? item[1] : '';
    const caret = lineStart + kept.length;
    return { text: text.slice(0, lineStart) + kept + text.slice(lineStart + line.length), start: caret, end: caret };
  }
  const marker = item ? `${item[1]}${item[2]}${item[3] ?? `${Number(item[4]) + 1}${item[5]}`}${item[6]}${item[7] ? '[ ] ' : ''}` : prefix;
  const insert = `\n${marker}`;
  const caret = start + insert.length;
  return { text: text.slice(0, start) + insert + text.slice(start), start: caret, end: caret };
}

/**
 * Finds the smallest single replacement that turns `before` into `after`,
 * never splitting a surrogate pair. The UI applies edits this way through
 * the browser's undo-aware insertText command.
 * @param {string} before
 * @param {string} after
 * @returns {{from: number, to: number, insert: string}} replace before.slice(from, to) with insert
 */
export function diffRange(before, after) {
  const shortest = Math.min(before.length, after.length);
  let from = 0;
  while (from < shortest && before.charCodeAt(from) === after.charCodeAt(from)) from += 1;
  if (from > 0 && isHighSurrogate(before.charCodeAt(from - 1))) from -= 1;
  let tail = 0;
  while (tail < shortest - from
    && before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)) tail += 1;
  if (tail > 0 && isLowSurrogate(before.charCodeAt(before.length - tail))) tail -= 1;
  return { from, to: before.length - tail, insert: after.slice(from, after.length - tail) };
}

/**
 * Flips the task checkbox ([ ] / [x]) of the list item that starts on the
 * given source line. Returns the text unchanged when that line has no task.
 * @param {string} text
 * @param {number} line - 0-based line index
 * @returns {string}
 */
export function toggleTaskAtLine(text, line) {
  const start = lineStartOffset(text, line);
  const match = RE_TASK_LINE.exec(text.slice(start, lineEndOffset(text, start)));
  if (!match) return text;
  const at = start + match[1].length;
  return text.slice(0, at) + (match[2] === ' ' ? 'x' : ' ') + text.slice(at + 1);
}

/**
 * Returns the 0-based line index of a text offset.
 * @param {string} text
 * @param {number} offset
 * @returns {number}
 */
export function lineIndexAt(text, offset) {
  let line = 0;
  let index = text.indexOf('\n');
  while (index !== -1 && index < offset) {
    line += 1;
    index = text.indexOf('\n', index + 1);
  }
  return line;
}

/**
 * Returns the offset where a 0-based line starts (text length when the line
 * does not exist).
 * @param {string} text
 * @param {number} line
 * @returns {number}
 */
export function lineStartOffset(text, line) {
  let offset = 0;
  for (let i = 0; i < line; i += 1) {
    const next = text.indexOf('\n', offset);
    if (next === -1) return text.length;
    offset = next + 1;
  }
  return offset;
}

// ---------------------------------------------------------------------------
// Helpers

function lineEndOffset(text, offset) {
  const next = text.indexOf('\n', offset);
  return next === -1 ? text.length : next;
}

const isHighSurrogate = (code) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code) => code >= 0xdc00 && code <= 0xdfff;

/** Whether the line starting at lineStart lies inside an open fenced code block. */
function insideFence(text, lineStart) {
  let open = null;
  for (const line of text.slice(0, lineStart).split('\n')) {
    const fence = RE_FENCE.exec(line);
    if (!fence) continue;
    if (open === null) open = fence[1];
    else if (fence[1][0] === open[0] && fence[1].length >= open.length && line.slice(fence[0].length).trim() === '') open = null;
  }
  return open !== null;
}

/** Narrows a selection so it does not start or end with whitespace. */
function trimRange(text, start, end) {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(text[from])) from += 1;
  while (to > from && /\s/.test(text[to - 1])) to -= 1;
  return from < to ? [from, to] : [start, start];
}

function longestRun(text, char) {
  let longest = 0;
  let current = 0;
  for (const ch of text) {
    current = ch === char ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

/**
 * Applies non-overlapping replacements, sorted by position, and returns the
 * new text plus a function that maps old offsets to new ones.
 */
function applyChanges(text, changes) {
  let out = '';
  let cursor = 0;
  for (const change of changes) {
    out += text.slice(cursor, change.at) + change.insert;
    cursor = change.at + change.remove;
  }
  out += text.slice(cursor);
  const map = (pos) => {
    let delta = 0;
    for (const change of changes) {
      if (pos < change.at) break;
      if (pos < change.at + change.remove) return change.at + delta + change.insert.length;
      delta += change.insert.length - change.remove;
    }
    return pos + delta;
  };
  return { text: out, map };
}

/** Line indexes touched by the selection; a selection ending at a line start excludes that line. */
function selectedLines(state) {
  const first = lineIndexAt(state.text, state.start);
  let last = lineIndexAt(state.text, state.end);
  if (state.end > state.start && last > first && state.text[state.end - 1] === '\n') last -= 1;
  return [first, last];
}

/**
 * Runs `edit(line)` on every selected line. It returns null (no change) or
 * {from, to, insert}: replace line.slice(from, to) with insert.
 */
function editLines(state, edit) {
  const [first, last] = selectedLines(state);
  const changes = [];
  let offset = lineStartOffset(state.text, first);
  for (let i = first; i <= last; i += 1) {
    const end = lineEndOffset(state.text, offset);
    const change = edit(state.text.slice(offset, end));
    if (change) changes.push({ at: offset + change.from, remove: change.to - change.from, insert: change.insert });
    offset = end + 1;
  }
  const { text, map } = applyChanges(state.text, changes);
  return { text, start: map(state.start), end: map(state.end) };
}

function selectedLineTexts(state) {
  const [first, last] = selectedLines(state);
  return state.text.split('\n').slice(first, last + 1);
}

// ---------------------------------------------------------------------------
// Actions

function toggleWrap(state, marker) {
  const { text } = state;
  const [start, end] = trimRange(text, state.start, state.end);
  const size = marker.length;
  const selected = text.slice(start, end);
  const outside = text.slice(Math.max(0, start - size), start) === marker && text.slice(end, end + size) === marker;
  if (selected.length >= size * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(size, -size);
    return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length };
  }
  if (outside) {
    return {
      text: text.slice(0, start - size) + selected + text.slice(end + size),
      start: start - size,
      end: end - size,
    };
  }
  return {
    text: text.slice(0, start) + marker + selected + marker + text.slice(end),
    start: start + size,
    end: end + size,
  };
}

function cycleHeading(state) {
  const lineStart = lineStartOffset(state.text, lineIndexAt(state.text, state.start));
  const line = state.text.slice(lineStart, lineEndOffset(state.text, lineStart));
  const match = RE_HEADING_PREFIX.exec(line);
  const level = match ? match[1].length : 0;
  const next = level >= 3 ? 0 : level + 1;
  const insert = next === 0 ? '' : `${'#'.repeat(next)} `;
  const { text, map } = applyChanges(state.text, [{ at: lineStart, remove: match ? match[0].length : 0, insert }]);
  return { text, start: map(state.start), end: map(state.end) };
}

/** Splits a line into indentation, list marker and task box. */
function listParts(line) {
  const indentation = /^[ \t]*/.exec(line)[0];
  const rest = line.slice(indentation.length);
  const marker = RE_MARKER.exec(rest);
  const box = marker ? RE_TASK_BOX.exec(rest.slice(marker[0].length)) : null;
  let kind = 'none';
  if (box) kind = 'task';
  else if (marker) kind = marker[1] ? 'bullet' : 'ordered';
  const prefixLength = (marker ? marker[0].length : 0) + (box ? box[0].length : 0);
  return { from: indentation.length, to: indentation.length + prefixLength, kind };
}

function toggleListPrefix(state, action) {
  const kind = action === 'task' ? 'task' : 'bullet';
  const prefix = action === 'task' ? '- [ ] ' : '- ';
  const lines = selectedLineTexts(state);
  const skipBlank = lines.some((line) => line.trim() !== '');
  const targets = lines.filter((line) => !skipBlank || line.trim() !== '');
  const remove = targets.every((line) => listParts(line).kind === kind);
  return editLines(state, (line) => {
    if (skipBlank && line.trim() === '') return null;
    const parts = listParts(line);
    if (remove) return { from: parts.from, to: parts.to, insert: '' };
    if (parts.kind === kind) return null;
    return { from: parts.from, to: parts.to, insert: prefix };
  });
}

function toggleQuote(state) {
  const remove = selectedLineTexts(state).every((line) => RE_QUOTE_PREFIX.test(line));
  return editLines(state, (line) => {
    if (remove) return { from: 0, to: RE_QUOTE_PREFIX.exec(line)[0].length, insert: '' };
    return { from: 0, to: 0, insert: line.trim() === '' ? '>' : '> ' };
  });
}

function toggleCode(state) {
  const { text, start, end } = state;
  if (text.slice(start, end).includes('\n')) return fenceLines(state);
  const lineStart = lineStartOffset(text, lineIndexAt(text, start));
  const lineEnd = lineEndOffset(text, lineStart);
  if (start === end && text.slice(lineStart, lineEnd).trim() === '') {
    return { text: `${text.slice(0, lineStart)}\`\`\`\n\n\`\`\`${text.slice(lineEnd)}`, start: lineStart + 4, end: lineStart + 4 };
  }
  return toggleInlineCode(state);
}

function fenceLines(state) {
  const [first, last] = selectedLines(state);
  const from = lineStartOffset(state.text, first);
  const to = lineEndOffset(state.text, lineStartOffset(state.text, last));
  const content = state.text.slice(from, to);
  const fence = '`'.repeat(Math.max(3, longestRun(content, '`') + 1));
  const inner = from + fence.length + 1;
  return {
    text: `${state.text.slice(0, from)}${fence}\n${content}\n${fence}${state.text.slice(to)}`,
    start: inner,
    end: inner + content.length,
  };
}

function toggleInlineCode(state) {
  const { text } = state;
  const [start, end] = trimRange(text, state.start, state.end);
  const before = /`*$/.exec(text.slice(0, start))[0].length;
  const after = /^`*/.exec(text.slice(end))[0].length;
  if (before > 0 && before === after) {
    const selected = text.slice(start, end);
    return {
      text: text.slice(0, start - before) + selected + text.slice(end + after),
      start: start - before,
      end: end - before,
    };
  }
  const selected = text.slice(start, end);
  const fence = '`'.repeat(longestRun(selected, '`') + 1);
  const pad = selected.startsWith('`') || selected.endsWith('`') ? ' ' : '';
  const open = fence + pad;
  return {
    text: text.slice(0, start) + open + selected + pad + fence + text.slice(end),
    start: start + open.length,
    end: start + open.length + selected.length,
  };
}

function insertLink(state) {
  const { text } = state;
  const [start, end] = trimRange(text, state.start, state.end);
  const selected = text.slice(start, end);
  if (RE_URL.test(selected)) {
    const url = /^www\./i.test(selected) ? `https://${selected}` : selected;
    return { text: `${text.slice(0, start)}[](${url})${text.slice(end)}`, start: start + 1, end: start + 1 };
  }
  const result = `${text.slice(0, start)}[${selected}](https://)${text.slice(end)}`;
  if (selected === '') return { text: result, start: start + 1, end: start + 1 };
  const urlStart = start + selected.length + 3;
  return { text: result, start: urlStart, end: urlStart + 'https://'.length };
}

function insertTable(state, labels = {}) {
  const header = labels.header || 'Header';
  const cell = labels.cell || 'Cell';
  const width = Math.max(3, Array.from(header).length, Array.from(cell).length);
  const pad = (value) => value + ' '.repeat(width - Array.from(value).length);
  const row = (value) => `| ${pad(value)} | ${pad(value)} |`;
  const rule = `| ${'-'.repeat(width)} | ${'-'.repeat(width)} |`;
  const table = [row(header), rule, row(cell), row(cell)].join('\n');
  const { text, offset } = insertBlock(state.text, lineEndOffset(state.text, state.end), table);
  return { text, start: offset + 2, end: offset + 2 + header.length };
}

/**
 * Inserts a block at a line end (so `after` is empty or starts with a line
 * break), separated from its neighbours by blank lines. Whitespace before
 * the block at the very start of the text is dropped, so the block cannot
 * turn into indented code.
 */
function insertBlock(text, pos, block) {
  const before = text.slice(0, pos).trim() === '' ? '' : text.slice(0, pos);
  const after = text.slice(pos);
  let lead = '\n\n';
  if (before === '' || before.endsWith('\n\n')) lead = '';
  else if (before.endsWith('\n')) lead = '\n';
  const trail = after.startsWith('\n\n') ? '' : '\n';
  return { text: before + lead + block + trail + after, offset: before.length + lead.length };
}
