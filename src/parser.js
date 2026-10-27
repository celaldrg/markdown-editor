/**
 * Markdown to AST: block parsing first (block-parser.js), then inline parsing
 * of every paragraph, heading and table cell (inline-parser.js). Also detects
 * GFM task list items and gives every heading a unique id.
 */
import { parseBlocks } from './block-parser.js';
import { parseInline } from './inline-parser.js';
import { inlineText } from './ast.js';
import { createSlugger } from './slug.js';

const RE_TASK_MARKER = /^\[([ xX])\][ \t\n]+(?=\S)/;
const RE_LANGUAGE_UNSAFE = /[^\p{L}\p{N}_#+.-]/gu;

/**
 * Parses Markdown into a document AST.
 *
 * Block nodes carry `line` and `endLine` (0-based source lines):
 * paragraph, heading {level, id}, thematicBreak, codeBlock {lang, info, value},
 * blockquote, list {ordered, start, tight}, listItem {checked: null|boolean},
 * table {align}, tableRow {header}, tableCell {header, align}.
 * Inline nodes: text {value}, softbreak, break, emphasis, strong, delete,
 * inlineCode {value}, link {url, title, autolink?}, image {url, title, alt}.
 *
 * @param {string} markdown
 * @returns {{type: 'document', children: Array<object>}}
 */
export function parse(markdown) {
  const { root, refmap } = parseBlocks(String(markdown ?? ''));
  const context = { refmap, slug: createSlugger() };
  return { type: 'document', children: convertBlocks(root.children, context) };
}

function convertBlocks(blocks, context) {
  return blocks.map((block) => convertBlock(block, context));
}

function convertBlock(block, context) {
  const position = { line: block.line, endLine: block.endLine };
  switch (block.type) {
    case 'paragraph':
      return { type: 'paragraph', ...position, children: parseInline(block.content, context.refmap) };
    case 'heading': {
      const children = parseInline(block.content, context.refmap);
      return { type: 'heading', level: block.level, id: context.slug(inlineText(children)), ...position, children };
    }
    case 'thematicBreak':
      return { type: 'thematicBreak', ...position };
    case 'codeBlock':
      return {
        type: 'codeBlock',
        lang: block.fenced ? languageOf(block.info) : '',
        info: block.fenced ? block.info : '',
        value: block.value,
        ...position,
      };
    case 'blockquote':
      return { type: 'blockquote', ...position, children: convertBlocks(block.children, context) };
    case 'list':
      return {
        type: 'list',
        ordered: block.ordered,
        start: block.start,
        tight: block.tight,
        ...position,
        children: block.children.map((item) => convertItem(item, context)),
      };
    default:
      return convertTable(block, context);
  }
}

function convertItem(item, context) {
  let checked = null;
  const first = item.children[0];
  if (first && first.type === 'paragraph') {
    const m = RE_TASK_MARKER.exec(first.content);
    if (m) {
      checked = m[1] !== ' ';
      first.content = first.content.slice(m[0].length);
    }
  }
  return {
    type: 'listItem',
    checked,
    line: item.line,
    endLine: item.endLine,
    children: convertBlocks(item.children, context),
  };
}

function convertTable(block, context) {
  const children = block.rows.map((cells, index) => ({
    type: 'tableRow',
    header: index === 0,
    line: index === 0 ? block.line : block.line + index + 1,
    children: cells.map((cell, column) => ({
      type: 'tableCell',
      header: index === 0,
      align: block.align[column],
      children: parseInline(cell, context.refmap),
    })),
  }));
  return { type: 'table', align: block.align.slice(), line: block.line, endLine: block.endLine, children };
}

/** First word of a fence info string, limited to characters safe in a class name. */
function languageOf(info) {
  return info.split(/[ \t]/, 1)[0].replace(RE_LANGUAGE_UNSAFE, '');
}
