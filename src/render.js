/**
 * Renders the Markdown AST either to an HTML string (export, copy) or to DOM
 * nodes (live preview). Both outputs come from the same tree walk, so they
 * always have the same structure.
 *
 * Safety: all text is escaped (string output) or inserted as text nodes (DOM
 * output); attribute names are fixed by this module; link and image URLs pass
 * through sanitizeUrl, so only http, https, mailto and relative URLs survive.
 * A link with an unsafe URL is rendered as its plain content, an image as its
 * alt text.
 */
import { encodeUrl, escapeHtml, sanitizeUrl } from './url.js';

/**
 * @typedef {object} RenderOptions
 * @property {string} [idPrefix=''] - prefix for heading ids and `#fragment` links
 * @property {boolean} [sourceLines=false] - add `data-line` (0-based source line) to block elements
 * @property {boolean} [externalLinks=false] - open http(s)/mailto links in a new tab (rel="noopener noreferrer")
 * @property {boolean} [interactiveTasks=false] - leave task checkboxes enabled
 */

/**
 * Renders a document AST to an HTML string.
 * @param {object} ast - document node from parse()
 * @param {RenderOptions} [options]
 * @returns {string}
 */
export function renderHtml(ast, options = {}) {
  const out = createStringOutput();
  renderBlocks(ast.children, out, resolveOptions(options), false);
  return out.result();
}

/**
 * Renders a document AST to a DocumentFragment using only createElement,
 * createTextNode and setAttribute.
 * @param {object} ast - document node from parse()
 * @param {Document} doc - the document that creates the nodes
 * @param {RenderOptions} [options]
 * @returns {DocumentFragment}
 */
export function renderDom(ast, doc, options = {}) {
  const out = createDomOutput(doc);
  renderBlocks(ast.children, out, resolveOptions(options), false);
  return out.result();
}

function resolveOptions(options) {
  return {
    idPrefix: String(options.idPrefix ?? ''),
    sourceLines: Boolean(options.sourceLines),
    externalLinks: Boolean(options.externalLinks),
    interactiveTasks: Boolean(options.interactiveTasks),
  };
}

// ---------------------------------------------------------------------------
// Outputs. Attributes are [name, value] pairs; value `true` = boolean attribute.

function createStringOutput() {
  // Parts are joined once at the end; remembering the last character keeps
  // cr() O(1) (endsWith on a growing string would flatten it every time).
  const parts = [];
  let last = '';
  const push = (value) => {
    if (value === '') return;
    parts.push(value);
    last = value[value.length - 1];
  };
  const attributes = (attrs) => attrs
    .map(([name, value]) => (value === true ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`))
    .join('');
  return {
    open(tag, attrs = []) { push(`<${tag}${attributes(attrs)}>`); },
    close(tag) { push(`</${tag}>`); },
    empty(tag, attrs = []) { push(`<${tag}${attributes(attrs)}>`); },
    text(value) { push(escapeHtml(value)); },
    cr() { if (last !== '' && last !== '\n') push('\n'); },
    result: () => parts.join(''),
  };
}

function createDomOutput(doc) {
  const root = doc.createDocumentFragment();
  const stack = [root];
  const current = () => stack[stack.length - 1];
  const element = (tag, attrs) => {
    const el = doc.createElement(tag);
    for (const [name, value] of attrs) el.setAttribute(name, value === true ? '' : String(value));
    return el;
  };
  return {
    open(tag, attrs = []) {
      const el = element(tag, attrs);
      current().appendChild(el);
      stack.push(el);
    },
    close() { stack.pop(); },
    empty(tag, attrs = []) { current().appendChild(element(tag, attrs)); },
    text(value) { if (value !== '') current().appendChild(doc.createTextNode(value)); },
    cr() {},
    result: () => root,
  };
}

// ---------------------------------------------------------------------------
// Blocks

function lineAttrs(node, opts) {
  return opts.sourceLines ? [['data-line', String(node.line)]] : [];
}

function renderBlocks(nodes, out, opts, tight) {
  for (const node of nodes) renderBlock(node, out, opts, tight);
}

function renderBlock(node, out, opts, tight) {
  switch (node.type) {
    case 'paragraph':
      renderParagraph(node, out, opts, tight, null);
      break;
    case 'heading': {
      const tag = `h${node.level}`;
      out.cr();
      out.open(tag, [['id', opts.idPrefix + node.id], ...lineAttrs(node, opts)]);
      renderInlines(node.children, out, opts);
      out.close(tag);
      out.cr();
      break;
    }
    case 'thematicBreak':
      out.cr();
      out.empty('hr', lineAttrs(node, opts));
      out.cr();
      break;
    case 'blockquote':
      out.cr();
      out.open('blockquote', lineAttrs(node, opts));
      out.cr();
      renderBlocks(node.children, out, opts, false);
      out.cr();
      out.close('blockquote');
      out.cr();
      break;
    case 'codeBlock':
      out.cr();
      out.open('pre', lineAttrs(node, opts));
      out.open('code', node.lang ? [['class', `language-${node.lang}`]] : []);
      out.text(node.value);
      out.close('code');
      out.close('pre');
      out.cr();
      break;
    case 'list':
      renderList(node, out, opts);
      break;
    case 'table':
      renderTable(node, out, opts);
      break;
    default:
      break;
  }
}

function renderParagraph(node, out, opts, tight, lead) {
  if (tight) {
    if (lead) lead();
    renderInlines(node.children, out, opts);
    return;
  }
  out.cr();
  out.open('p', lineAttrs(node, opts));
  if (lead) lead();
  renderInlines(node.children, out, opts);
  out.close('p');
  out.cr();
}

function renderList(list, out, opts) {
  const tag = list.ordered ? 'ol' : 'ul';
  const attrs = [];
  if (list.ordered && list.start !== 1) attrs.push(['start', String(list.start)]);
  if (list.children.some((item) => item.checked !== null)) attrs.push(['class', 'contains-task-list']);
  out.cr();
  out.open(tag, [...attrs, ...lineAttrs(list, opts)]);
  out.cr();
  for (const item of list.children) renderItem(item, out, opts, list.tight);
  out.cr();
  out.close(tag);
  out.cr();
}

function renderItem(item, out, opts, tight) {
  const isTask = item.checked !== null;
  out.open('li', [...(isTask ? [['class', 'task-list-item']] : []), ...lineAttrs(item, opts)]);
  item.children.forEach((child, index) => {
    if (isTask && index === 0) {
      renderParagraph(child, out, opts, tight, () => renderCheckbox(item.checked, out, opts));
    } else {
      renderBlock(child, out, opts, tight);
    }
  });
  out.close('li');
  out.cr();
}

function renderCheckbox(checked, out, opts) {
  const attrs = [['type', 'checkbox']];
  if (checked) attrs.push(['checked', true]);
  if (!opts.interactiveTasks) attrs.push(['disabled', true]);
  out.empty('input', attrs);
  out.text(' ');
}

function renderTable(table, out, opts) {
  const [head, ...body] = table.children;
  out.cr();
  out.open('table', lineAttrs(table, opts));
  out.cr();
  out.open('thead');
  out.cr();
  renderRow(head, out, opts);
  out.close('thead');
  out.cr();
  if (body.length > 0) {
    out.open('tbody');
    out.cr();
    for (const row of body) renderRow(row, out, opts);
    out.close('tbody');
    out.cr();
  }
  out.close('table');
  out.cr();
}

function renderRow(row, out, opts) {
  out.open('tr', lineAttrs(row, opts));
  out.cr();
  for (const cell of row.children) {
    const tag = cell.header ? 'th' : 'td';
    out.open(tag, cell.align ? [['align', cell.align]] : []);
    renderInlines(cell.children, out, opts);
    out.close(tag);
    out.cr();
  }
  out.close('tr');
  out.cr();
}

// ---------------------------------------------------------------------------
// Inlines

function renderInlines(nodes, out, opts) {
  for (const node of nodes) renderInline(node, out, opts);
}

const WRAPPERS = { emphasis: 'em', strong: 'strong', delete: 'del' };

function renderInline(node, out, opts) {
  switch (node.type) {
    case 'text':
      out.text(node.value);
      break;
    case 'softbreak':
      out.text('\n');
      break;
    case 'break':
      out.empty('br');
      out.text('\n');
      break;
    case 'inlineCode':
      out.open('code');
      out.text(node.value);
      out.close('code');
      break;
    case 'link':
      renderLink(node, out, opts);
      break;
    case 'image':
      renderImage(node, out);
      break;
    default: {
      const tag = WRAPPERS[node.type];
      if (!tag) break;
      out.open(tag);
      renderInlines(node.children, out, opts);
      out.close(tag);
    }
  }
}

function renderLink(node, out, opts) {
  const safe = sanitizeUrl(node.url);
  if (safe === null) {
    renderInlines(node.children, out, opts);
    return;
  }
  const href = safe.startsWith('#') ? `#${opts.idPrefix}${safe.slice(1)}` : safe;
  const attrs = [['href', encodeUrl(href)]];
  if (node.title) attrs.push(['title', node.title]);
  if (opts.externalLinks && /^(?:https?|mailto):/i.test(href)) {
    attrs.push(['target', '_blank'], ['rel', 'noopener noreferrer']);
  }
  out.open('a', attrs);
  renderInlines(node.children, out, opts);
  out.close('a');
}

function renderImage(node, out) {
  const safe = sanitizeUrl(node.url);
  if (safe === null) {
    out.text(node.alt);
    return;
  }
  const attrs = [['src', encodeUrl(safe)], ['alt', node.alt]];
  if (node.title) attrs.push(['title', node.title]);
  out.empty('img', attrs);
}
