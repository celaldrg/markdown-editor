/**
 * Block-level Markdown parser: the CommonMark container algorithm (block
 * quotes, lists, code blocks, headings, thematic breaks, paragraphs, link
 * reference definitions) plus GFM pipe tables. Leaf text stays raw; inline
 * parsing happens later in parser.js. Raw HTML blocks are not recognised.
 *
 * Every block records `line` and `endLine` (0-based source lines).
 */
import { parseReferenceDefinition, unescapeString } from './inline-parser.js';

const CODE_INDENT = 4;
const MAX_NESTING = 64;
const RE_ATX = /^#{1,6}(?:[ \t]+|$)/;
const RE_CODE_FENCE = /^`{3,}(?!.*`)|^~{3,}/;
const RE_CLOSING_FENCE = /^(?:`{3,}|~{3,})(?=[ \t]*$)/;
const RE_SETEXT = /^(?:=+|-+)[ \t]*$/;
const RE_THEMATIC_BREAK = /^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$|^(?:-[ \t]*){3,}$/;
const RE_BULLET = /^[*+-]/;
const RE_ORDERED = /^(\d{1,9})([.)])/;
const RE_NON_SPACE = /[^ \t\f\v\r\n]/;
const RE_DELIMITER_ROW = /^[ \t|:-]+$/;
const RE_DELIMITER_CELL = /^:?-+:?$/;

/**
 * Parses the block structure of a Markdown document.
 * @param {string} markdown
 * @returns {{root: object, refmap: Map<string, {destination: string, title: string}>}}
 */
export function parseBlocks(markdown) {
  return new BlockParser().parse(markdown);
}

/**
 * Splits a GFM table row into trimmed cell strings. `\|` becomes a literal
 * pipe; other backslash escapes are kept for the inline parser.
 * @param {string} line
 * @returns {string[]}
 */
export function splitTableRow(line) {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  const cells = [];
  let cell = '';
  let endsWithPipe = false;
  for (let i = 0; i < row.length; i += 1) {
    const ch = row[i];
    endsWithPipe = false;
    if (ch === '\\' && i + 1 < row.length) {
      cell += row[i + 1] === '|' ? '|' : ch + row[i + 1];
      i += 1;
    } else if (ch === '|') {
      cells.push(cell.trim());
      cell = '';
      endsWithPipe = true;
    } else {
      cell += ch;
    }
  }
  if (!endsWithPipe) cells.push(cell.trim());
  return cells;
}

const isSpaceOrTab = (ch) => ch === ' ' || ch === '\t';

function makeBlock(type, line) {
  return { type, parent: null, children: [], open: true, line, endLine: line, content: '' };
}

function canContain(parentType, childType) {
  if (parentType === 'list') return childType === 'item';
  if (parentType === 'document' || parentType === 'blockquote' || parentType === 'item') return childType !== 'item';
  return false;
}

function depthOf(block) {
  let depth = 0;
  for (let b = block; b; b = b.parent) depth += 1;
  return depth;
}

function replaceBlock(oldBlock, newBlock) {
  const siblings = oldBlock.parent.children;
  siblings[siblings.indexOf(oldBlock)] = newBlock;
  newBlock.parent = oldBlock.parent;
}

function removeBlock(block) {
  const siblings = block.parent.children;
  siblings.splice(siblings.indexOf(block), 1);
}

function parseDelimiterRow(line) {
  if (!RE_DELIMITER_ROW.test(line) || !line.includes('-')) return null;
  const align = [];
  for (const cell of splitTableRow(line)) {
    if (!RE_DELIMITER_CELL.test(cell)) return null;
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    align.push(left && right ? 'center' : right ? 'right' : left ? 'left' : null);
  }
  return align;
}

function fitRow(cells, columns) {
  const row = cells.slice(0, columns);
  while (row.length < columns) row.push('');
  return row;
}

function finalizeCode(block) {
  if (block.fenced) {
    const newline = block.content.indexOf('\n');
    block.info = unescapeString(block.content.slice(0, newline).trim());
    block.value = block.content.slice(newline + 1);
    return;
  }
  const lines = block.content.split('\n');
  while (lines.length > 0 && /^[ \t]*$/.test(lines[lines.length - 1])) lines.pop();
  block.value = lines.length > 0 ? `${lines.join('\n')}\n` : '';
  block.endLine = block.line + Math.max(lines.length - 1, 0);
}

function finalizeTable(block) {
  const lines = block.content.replace(/\n$/, '').split('\n');
  const columns = block.align.length;
  block.rows = [lines[0], ...lines.slice(2)].map((line) => fitRow(splitTableRow(line), columns));
}

function finalizeList(list) {
  const items = list.children;
  list.endLine = items[items.length - 1].endLine;
  list.tight = !items.some((item, i) => {
    const gapAfterItem = i < items.length - 1 && items[i + 1].line > item.endLine + 1;
    return gapAfterItem || item.children.some((child, j) => {
      const next = item.children[j + 1];
      return next !== undefined && next.line > child.endLine + 1;
    });
  });
}

class BlockParser {
  constructor() {
    this.doc = makeBlock('document', 0);
    this.tip = this.doc;
    this.oldtip = this.doc;
    this.lastMatchedContainer = this.doc;
    this.allClosed = true;
    this.refmap = new Map();
    this.lineNumber = -1;
    this.currentLine = '';
    this.offset = 0;
    this.column = 0;
    this.nextNonspace = 0;
    this.nextNonspaceColumn = 0;
    this.indent = 0;
    this.indented = false;
    this.blank = false;
    this.partiallyConsumedTab = false;
  }

  parse(markdown) {
    const lines = markdown.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
    if (lines[lines.length - 1] === '') lines.pop();
    for (const line of lines) this.incorporateLine(line);
    while (this.tip) this.finalize(this.tip, lines.length - 1);
    return { root: this.doc, refmap: this.refmap };
  }

  // ----- position helpers (tabs count to the next multiple of 4) -----

  findNextNonspace() {
    const line = this.currentLine;
    let i = this.offset;
    let cols = this.column;
    let ch = line.charAt(i);
    while (ch === ' ' || ch === '\t') {
      cols += ch === ' ' ? 1 : 4 - (cols % 4);
      i += 1;
      ch = line.charAt(i);
    }
    this.blank = ch === '';
    this.nextNonspace = i;
    this.nextNonspaceColumn = cols;
    this.indent = cols - this.column;
    this.indented = this.indent >= CODE_INDENT;
  }

  advanceNextNonspace() {
    this.offset = this.nextNonspace;
    this.column = this.nextNonspaceColumn;
    this.partiallyConsumedTab = false;
  }

  advanceOffset(count, columns) {
    let remaining = count;
    while (remaining > 0 && this.offset < this.currentLine.length) {
      if (this.currentLine[this.offset] === '\t') {
        const charsToTab = 4 - (this.column % 4);
        if (columns) {
          this.partiallyConsumedTab = charsToTab > remaining;
          const advance = Math.min(charsToTab, remaining);
          this.column += advance;
          this.offset += this.partiallyConsumedTab ? 0 : 1;
          remaining -= advance;
        } else {
          this.partiallyConsumedTab = false;
          this.column += charsToTab;
          this.offset += 1;
          remaining -= 1;
        }
      } else {
        this.partiallyConsumedTab = false;
        this.offset += 1;
        this.column += 1;
        remaining -= 1;
      }
    }
  }

  // ----- tree maintenance -----

  addChild(type) {
    while (!canContain(this.tip.type, type)) this.finalize(this.tip, this.lineNumber - 1);
    const block = makeBlock(type, this.lineNumber);
    block.parent = this.tip;
    this.tip.children.push(block);
    this.tip = block;
    return block;
  }

  addLine() {
    if (this.partiallyConsumedTab) {
      this.offset += 1;
      this.tip.content += ' '.repeat(4 - (this.column % 4));
    }
    this.tip.content += `${this.currentLine.slice(this.offset)}\n`;
  }

  closeUnmatchedBlocks() {
    if (this.allClosed) return;
    while (this.oldtip !== this.lastMatchedContainer) {
      const parent = this.oldtip.parent;
      this.finalize(this.oldtip, this.lineNumber - 1);
      this.oldtip = parent;
    }
    this.allClosed = true;
  }

  finalize(block, lineNumber) {
    const parent = block.parent;
    block.open = false;
    block.endLine = Math.max(lineNumber, block.line);
    if (block.type === 'paragraph') this.finalizeParagraph(block);
    else if (block.type === 'codeBlock') finalizeCode(block);
    else if (block.type === 'table') finalizeTable(block);
    else if (block.type === 'list') finalizeList(block);
    else if (block.type === 'item' && block.children.length > 0) {
      block.endLine = block.children[block.children.length - 1].endLine;
    }
    this.tip = parent;
  }

  finalizeParagraph(block) {
    if (this.extractReferences(block) && !RE_NON_SPACE.test(block.content)) removeBlock(block);
  }

  /** Moves leading link reference definitions of a paragraph into the refmap. */
  extractReferences(block) {
    let found = false;
    let consumed;
    while (block.content.startsWith('[') && (consumed = parseReferenceDefinition(block.content, this.refmap)) > 0) {
      block.line += (block.content.slice(0, consumed).match(/\n/g) || []).length;
      block.content = block.content.slice(consumed);
      found = true;
    }
    return found;
  }

  // ----- one line -----

  incorporateLine(rawLine) {
    let container = this.doc;
    this.oldtip = this.tip;
    this.offset = 0;
    this.column = 0;
    this.blank = false;
    this.partiallyConsumedTab = false;
    this.lineNumber += 1;
    this.currentLine = rawLine.includes('\u0000') ? rawLine.replace(/\u0000/g, '\uFFFD') : rawLine;

    let last = container.children[container.children.length - 1];
    while (last && last.open) {
      container = last;
      this.findNextNonspace();
      const result = this.continueBlock(container);
      if (result === 2) return;
      if (result === 1) {
        container = container.parent;
        break;
      }
      last = container.children[container.children.length - 1];
    }

    this.allClosed = container === this.oldtip;
    this.lastMatchedContainer = container;

    let matchedLeaf = container.type === 'codeBlock';
    while (!matchedLeaf) {
      this.findNextNonspace();
      const result = this.tryBlockStarts(container);
      if (result === 0) {
        this.advanceNextNonspace();
        break;
      }
      container = this.tip;
      matchedLeaf = result === 2;
    }

    if (!this.allClosed && !this.blank && this.tip.type === 'paragraph') {
      this.addLine(); // lazy paragraph continuation
      return;
    }
    this.closeUnmatchedBlocks();
    if (container.type === 'codeBlock' || container.type === 'paragraph' || container.type === 'table') {
      this.addLine();
    } else if (this.offset < this.currentLine.length && !this.blank) {
      this.addChild('paragraph');
      this.advanceNextNonspace();
      this.addLine();
    }
  }

  /** 0 = matched, 1 = not matched, 2 = line fully consumed (closing fence). */
  continueBlock(block) {
    switch (block.type) {
      case 'document':
      case 'list':
        return 0;
      case 'blockquote':
        return this.continueBlockquote();
      case 'item':
        return this.continueItem(block);
      case 'codeBlock':
        return block.fenced ? this.continueFence(block) : this.continueIndentedCode();
      case 'paragraph':
      case 'table':
        return this.blank ? 1 : 0;
      default:
        return 1;
    }
  }

  continueBlockquote() {
    if (this.indented || this.currentLine.charAt(this.nextNonspace) !== '>') return 1;
    this.advanceNextNonspace();
    this.advanceOffset(1, false);
    if (isSpaceOrTab(this.currentLine.charAt(this.offset))) this.advanceOffset(1, true);
    return 0;
  }

  continueItem(item) {
    if (this.blank) {
      if (item.children.length === 0) return 1;
      this.advanceNextNonspace();
      return 0;
    }
    const width = item.markerOffset + item.padding;
    if (this.indent < width) return 1;
    this.advanceOffset(width, true);
    return 0;
  }

  continueFence(block) {
    if (this.indent <= 3 && this.currentLine.charAt(this.nextNonspace) === block.fenceChar) {
      const m = RE_CLOSING_FENCE.exec(this.currentLine.slice(this.nextNonspace));
      if (m && m[0].length >= block.fenceLength) {
        this.finalize(block, this.lineNumber);
        return 2;
      }
    }
    for (let i = block.fenceOffset; i > 0 && isSpaceOrTab(this.currentLine.charAt(this.offset)); i -= 1) {
      this.advanceOffset(1, true);
    }
    return 0;
  }

  continueIndentedCode() {
    if (this.indent >= CODE_INDENT) {
      this.advanceOffset(CODE_INDENT, true);
      return 0;
    }
    if (this.blank) {
      this.advanceNextNonspace();
      return 0;
    }
    return 1;
  }

  // ----- block starts: 0 = none, 1 = container opened, 2 = leaf opened -----

  tryBlockStarts(container) {
    return this.startBlockquote(container)
      || this.startAtxHeading()
      || this.startFence()
      || this.startSetextHeading(container)
      || this.startThematicBreak()
      || this.startListItem(container)
      || this.startIndentedCode()
      || this.startTable(container);
  }

  startBlockquote(container) {
    if (this.indented || this.currentLine.charAt(this.nextNonspace) !== '>') return 0;
    if (depthOf(container) >= MAX_NESTING) return 0;
    this.advanceNextNonspace();
    this.advanceOffset(1, false);
    if (isSpaceOrTab(this.currentLine.charAt(this.offset))) this.advanceOffset(1, true);
    this.closeUnmatchedBlocks();
    this.addChild('blockquote');
    return 1;
  }

  startAtxHeading() {
    if (this.indented) return 0;
    const m = RE_ATX.exec(this.currentLine.slice(this.nextNonspace));
    if (!m) return 0;
    this.advanceNextNonspace();
    this.advanceOffset(m[0].length, false);
    this.closeUnmatchedBlocks();
    const heading = this.addChild('heading');
    heading.level = m[0].trim().length;
    heading.content = this.currentLine
      .slice(this.offset)
      .replace(/^[ \t]*#+[ \t]*$/, '')
      .replace(/[ \t]+#+[ \t]*$/, '');
    this.advanceOffset(this.currentLine.length - this.offset, false);
    return 2;
  }

  startFence() {
    if (this.indented) return 0;
    const m = RE_CODE_FENCE.exec(this.currentLine.slice(this.nextNonspace));
    if (!m) return 0;
    this.closeUnmatchedBlocks();
    const block = this.addChild('codeBlock');
    block.fenced = true;
    block.fenceLength = m[0].length;
    block.fenceChar = m[0][0];
    block.fenceOffset = this.indent;
    this.advanceNextNonspace();
    this.advanceOffset(m[0].length, false);
    return 2;
  }

  startSetextHeading(container) {
    if (this.indented || container.type !== 'paragraph') return 0;
    const m = RE_SETEXT.exec(this.currentLine.slice(this.nextNonspace));
    if (!m) return 0;
    this.closeUnmatchedBlocks();
    this.extractReferences(container);
    if (container.content.length === 0) return 0;
    const heading = makeBlock('heading', container.line);
    heading.level = m[0][0] === '=' ? 1 : 2;
    heading.content = container.content;
    replaceBlock(container, heading);
    this.tip = heading;
    this.advanceOffset(this.currentLine.length - this.offset, false);
    return 2;
  }

  startThematicBreak() {
    if (this.indented || !RE_THEMATIC_BREAK.test(this.currentLine.slice(this.nextNonspace))) return 0;
    this.closeUnmatchedBlocks();
    this.addChild('thematicBreak');
    this.advanceOffset(this.currentLine.length - this.offset, false);
    return 2;
  }

  startListItem(container) {
    if ((this.indented && container.type !== 'list') || depthOf(container) >= MAX_NESTING) return 0;
    const data = this.parseListMarker(container);
    if (!data) return 0;
    this.closeUnmatchedBlocks();
    const tip = this.tip;
    const sameList = tip.type === 'list' && tip.ordered === data.ordered
      && tip.bulletChar === data.bulletChar && tip.delimiter === data.delimiter;
    if (!sameList) {
      const list = this.addChild('list');
      list.ordered = data.ordered;
      list.bulletChar = data.bulletChar;
      list.delimiter = data.delimiter;
      list.start = data.start;
    }
    const item = this.addChild('item');
    item.markerOffset = data.markerOffset;
    item.padding = data.padding;
    return 1;
  }

  parseListMarker(container) {
    if (this.indent >= CODE_INDENT) return null;
    const rest = this.currentLine.slice(this.nextNonspace);
    const data = { ordered: false, bulletChar: '', delimiter: '', start: 1, markerOffset: this.indent, padding: 0 };
    let m = RE_BULLET.exec(rest);
    if (m) {
      data.bulletChar = m[0];
    } else {
      m = RE_ORDERED.exec(rest);
      if (!m || (container.type === 'paragraph' && Number.parseInt(m[1], 10) !== 1)) return null;
      data.ordered = true;
      data.start = Number.parseInt(m[1], 10);
      data.delimiter = m[2];
    }
    const marker = m[0];
    const after = this.currentLine.charAt(this.nextNonspace + marker.length);
    if (after !== '' && !isSpaceOrTab(after)) return null;
    if (container.type === 'paragraph' && !RE_NON_SPACE.test(rest.slice(marker.length))) return null;

    this.advanceNextNonspace();
    this.advanceOffset(marker.length, true);
    const spacesStartColumn = this.column;
    const spacesStartOffset = this.offset;
    do {
      this.advanceOffset(1, true);
    } while (this.column - spacesStartColumn < 5 && isSpaceOrTab(this.currentLine.charAt(this.offset)));
    const blankItem = this.offset >= this.currentLine.length;
    const spaces = this.column - spacesStartColumn;
    if (spaces >= 5 || spaces < 1 || blankItem) {
      data.padding = marker.length + 1;
      this.column = spacesStartColumn;
      this.offset = spacesStartOffset;
      if (isSpaceOrTab(this.currentLine.charAt(this.offset))) this.advanceOffset(1, true);
    } else {
      data.padding = marker.length + spaces;
    }
    return data;
  }

  startIndentedCode() {
    if (!this.indented || this.tip.type === 'paragraph' || this.blank) return 0;
    this.advanceOffset(CODE_INDENT, true);
    this.closeUnmatchedBlocks();
    this.addChild('codeBlock').fenced = false;
    return 2;
  }

  /** A delimiter row under a paragraph turns its last line into a table header. */
  startTable(container) {
    if (this.indented || container.type !== 'paragraph') return 0;
    const delimiterRow = this.currentLine.slice(this.nextNonspace);
    const align = parseDelimiterRow(delimiterRow);
    if (!align) return 0;
    const lines = container.content.replace(/\n$/, '').split('\n');
    const headerRow = lines[lines.length - 1];
    if (splitTableRow(headerRow).length !== align.length) return 0;
    if (!headerRow.includes('|') && !delimiterRow.includes('|')) return 0;

    this.closeUnmatchedBlocks();
    const table = makeBlock('table', container.line + lines.length - 1);
    table.align = align;
    table.content = `${headerRow}\n`;
    if (lines.length > 1) {
      container.content = `${lines.slice(0, -1).join('\n')}\n`;
      const parent = container.parent;
      this.finalize(container, this.lineNumber - 2);
      table.parent = parent;
      parent.children.push(table);
    } else {
      replaceBlock(container, table);
    }
    this.tip = table;
    this.advanceNextNonspace();
    return 2;
  }
}
