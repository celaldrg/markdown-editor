/**
 * Inline Markdown parser. Turns the raw text of a paragraph, heading or table
 * cell into inline nodes, following the CommonMark delimiter-stack algorithm
 * with the GFM strikethrough and extended-autolink extensions.
 *
 * Raw HTML is never recognised: a `<` that does not start an autolink is
 * plain text, so it is escaped by the renderers.
 */
import { ENTITY_SOURCE, decodeEntity } from './entities.js';

const ASCII_PUNCTUATION = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
const RE_ESCAPE_OR_ENTITY = new RegExp(`\\\\([!-/:-@[-\`{-~])|${ENTITY_SOURCE}`, 'g');
const RE_ENTITY_HERE = new RegExp(ENTITY_SOURCE, 'y');
const RE_TICKS_HERE = /`+/y;
const RE_TICKS = /`+/g;
const RE_TEXT_HERE = /[^\n`[\]\\!<&*_~]+/y;
const RE_EMAIL_AUTOLINK = /<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/y;
const RE_URI_AUTOLINK = /<([A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>\u0000-\u0020]*)>/y;
const RE_LINK_TITLE = /"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)'|\(((?:\\[\s\S]|[^()\\])*)\)/y;
const RE_LINK_DEST_BRACES = /<((?:[^<>\n\\]|\\.)*)>/y;
const RE_LINK_LABEL = /\[(?:[^\\[\]]|\\[\s\S]){0,999}\]/y;
const RE_SPNL = /[ \t]*(?:\n[ \t]*)?/y;
const RE_SPACE_AT_EOL = /[ \t]*(?:\n|$)/y;
const RE_LINE_INDENT = /[ \t]*/y;
const RE_UNICODE_SPACE = /^[\t\n\f\r\p{Zs}]$/u;
const RE_PUNCTUATION = /^[\p{P}\p{S}]$/u;
const RE_EXT_AUTOLINK = /(?:https?:\/\/|www\.)[^\s<]+/gi;
const RE_DOMAIN = /^[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*/u;
const AUTOLINK_TRAILING = '?!.,:*_~\'"';
// Nesting limit for parentheses in a link destination; keeps hostile input
// like "[a](b[a](b[a](b..." linear (the spec allows such a limit).
const MAX_LINK_PAREN_DEPTH = 32;
// Inline nesting deeper than this is flattened (the wrappers are dropped), so
// tree walks over hostile input cannot overflow the call stack.
const MAX_INLINE_DEPTH = 32;

/**
 * Parses inline Markdown into an array of inline nodes.
 * @param {string} content - raw inline text (may contain newlines)
 * @param {Map<string, {destination: string, title: string}>} [refmap] - link reference definitions
 * @returns {Array<object>}
 */
export function parseInline(content, refmap = new Map()) {
  const parser = new InlineParser(refmap);
  return linkify(toInlineArray(parser.parse(content)));
}

/**
 * Tries to read one link reference definition (`[label]: url "title"`) at the
 * start of `content`. A new label is stored in `refmap` (the first one wins).
 * @param {string} content
 * @param {Map<string, {destination: string, title: string}>} refmap
 * @returns {number} number of characters consumed, 0 when there is none
 */
export function parseReferenceDefinition(content, refmap) {
  return new InlineParser(refmap).parseReference(content);
}

/**
 * Resolves backslash escapes and character references in a string.
 * @param {string} value
 * @returns {string}
 */
export function unescapeString(value) {
  if (!value.includes('\\') && !value.includes('&')) return value;
  return value.replace(RE_ESCAPE_OR_ENTITY, (match, escaped) => escaped ?? decodeEntity(match) ?? match);
}

/**
 * Normalises a link label (with its brackets) for reference lookups:
 * whitespace collapsed, case folded.
 * @param {string} label
 * @returns {string}
 */
export function normalizeLabel(label) {
  return label.slice(1, -1).trim().replace(/[ \t\r\n]+/g, ' ').toLowerCase().toUpperCase();
}

const isAsciiPunctuation = (ch) => ch.length === 1 && ASCII_PUNCTUATION.includes(ch);
const trimMarkdown = (value) => value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');

// ---------------------------------------------------------------------------
// Linked inline nodes used while parsing (converted to plain arrays at the end)

function makeNode(type, props) {
  return { type, ...props, parent: null, prev: null, next: null, first: null, last: null };
}

const textNode = (value) => makeNode('text', { value });

function appendChild(parent, child) {
  child.parent = parent;
  child.prev = parent.last;
  child.next = null;
  if (parent.last) parent.last.next = child;
  else parent.first = child;
  parent.last = child;
}

function insertAfter(ref, child) {
  child.parent = ref.parent;
  child.prev = ref;
  child.next = ref.next;
  if (ref.next) ref.next.prev = child;
  else ref.parent.last = child;
  ref.next = child;
}

function unlink(node) {
  if (node.prev) node.prev.next = node.next;
  else if (node.parent) node.parent.first = node.next;
  if (node.next) node.next.prev = node.prev;
  else if (node.parent) node.parent.last = node.prev;
  node.parent = null;
  node.prev = null;
  node.next = null;
}

function codePointBefore(text, index) {
  if (index <= 0) return '\n';
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(index - 2, index);
  }
  return text.charAt(index - 1);
}

function codePointAt(text, index) {
  if (index >= text.length) return '\n';
  return String.fromCodePoint(text.codePointAt(index));
}

// ---------------------------------------------------------------------------

class InlineParser {
  constructor(refmap) {
    this.refmap = refmap;
    this.subject = '';
    this.pos = 0;
    this.delimiters = null;
    this.brackets = null;
  }

  peek(ahead = 0) {
    return this.subject.charAt(this.pos + ahead);
  }

  /** Matches a sticky regular expression at the current position and advances. */
  match(re) {
    re.lastIndex = this.pos;
    const m = re.exec(this.subject);
    if (m) this.pos += m[0].length;
    return m;
  }

  parse(content) {
    const root = makeNode('root', {});
    this.subject = trimMarkdown(content);
    this.pos = 0;
    this.delimiters = null;
    this.brackets = null;
    while (this.pos < this.subject.length) this.parseInline(root);
    this.processEmphasis(null);
    return root;
  }

  parseInline(block) {
    switch (this.peek()) {
      case '\n': this.parseNewline(block); break;
      case '\\': this.parseBackslash(block); break;
      case '`': this.parseBackticks(block); break;
      case '*':
      case '_':
      case '~': this.handleDelimiters(this.peek(), block); break;
      case '[': this.parseOpenBracket(block); break;
      case '!': this.parseBang(block); break;
      case ']': this.parseCloseBracket(block); break;
      case '<': this.parseAutolink(block); break;
      case '&': this.parseEntity(block); break;
      default: this.parseText(block);
    }
  }

  parseText(block) {
    const m = this.match(RE_TEXT_HERE);
    if (m) {
      appendChild(block, textNode(m[0]));
    } else {
      appendChild(block, textNode(this.peek()));
      this.pos += 1;
    }
  }

  parseNewline(block) {
    this.pos += 1;
    const last = block.last;
    if (last && last.type === 'text' && last.value.endsWith(' ')) {
      const hard = last.value.endsWith('  ');
      last.value = last.value.replace(/ +$/, '');
      appendChild(block, makeNode(hard ? 'break' : 'softbreak', {}));
    } else {
      appendChild(block, makeNode('softbreak', {}));
    }
    this.match(RE_LINE_INDENT);
  }

  parseBackslash(block) {
    const next = this.peek(1);
    if (next === '\n') {
      this.pos += 2;
      appendChild(block, makeNode('break', {}));
      this.match(RE_LINE_INDENT);
    } else if (isAsciiPunctuation(next)) {
      this.pos += 2;
      appendChild(block, textNode(next));
    } else {
      this.pos += 1;
      appendChild(block, textNode('\\'));
    }
  }

  parseBackticks(block) {
    const ticks = this.match(RE_TICKS_HERE)[0];
    const afterOpen = this.pos;
    RE_TICKS.lastIndex = afterOpen;
    let m;
    while ((m = RE_TICKS.exec(this.subject)) !== null) {
      if (m[0].length === ticks.length) {
        let code = this.subject.slice(afterOpen, m.index).replace(/\n/g, ' ');
        if (code.startsWith(' ') && code.endsWith(' ') && /[^ ]/.test(code)) code = code.slice(1, -1);
        appendChild(block, makeNode('inlineCode', { value: code }));
        this.pos = m.index + m[0].length;
        return;
      }
    }
    appendChild(block, textNode(ticks));
  }

  parseAutolink(block) {
    let m = this.match(RE_EMAIL_AUTOLINK);
    if (m) {
      appendChild(block, autolinkNode(`mailto:${m[1]}`, m[1]));
      return;
    }
    m = this.match(RE_URI_AUTOLINK);
    if (m) {
      appendChild(block, autolinkNode(m[1], m[1]));
      return;
    }
    this.pos += 1;
    appendChild(block, textNode('<'));
  }

  parseEntity(block) {
    const m = this.match(RE_ENTITY_HERE);
    if (m) {
      appendChild(block, textNode(decodeEntity(m[0]) ?? m[0]));
    } else {
      this.pos += 1;
      appendChild(block, textNode('&'));
    }
  }

  // ----- emphasis, strong and strikethrough -----

  scanDelimiters(cc) {
    const start = this.pos;
    let count = 0;
    while (this.subject.charAt(start + count) === cc) count += 1;
    const before = codePointBefore(this.subject, start);
    const after = codePointAt(this.subject, start + count);
    const afterSpace = RE_UNICODE_SPACE.test(after);
    const afterPunct = RE_PUNCTUATION.test(after);
    const beforeSpace = RE_UNICODE_SPACE.test(before);
    const beforePunct = RE_PUNCTUATION.test(before);
    const leftFlanking = !afterSpace && (!afterPunct || beforeSpace || beforePunct);
    const rightFlanking = !beforeSpace && (!beforePunct || afterSpace || afterPunct);
    if (cc === '_') {
      return {
        count,
        canOpen: leftFlanking && (!rightFlanking || beforePunct),
        canClose: rightFlanking && (!leftFlanking || afterPunct),
      };
    }
    return { count, canOpen: leftFlanking, canClose: rightFlanking };
  }

  handleDelimiters(cc, block) {
    const { count, canOpen, canClose } = this.scanDelimiters(cc);
    const node = textNode(this.subject.slice(this.pos, this.pos + count));
    this.pos += count;
    appendChild(block, node);
    const usable = cc !== '~' || count <= 2;
    if (!usable || !(canOpen || canClose)) return;
    const delimiter = {
      cc, count, original: count, node, canOpen, canClose, previous: this.delimiters, next: null,
    };
    if (this.delimiters) this.delimiters.next = delimiter;
    this.delimiters = delimiter;
  }

  removeDelimiter(delimiter) {
    if (delimiter.previous) delimiter.previous.next = delimiter.next;
    if (delimiter.next) delimiter.next.previous = delimiter.previous;
    else this.delimiters = delimiter.previous;
  }

  processEmphasis(stackBottom) {
    const openersBottom = new Map();
    let closer = this.delimiters;
    while (closer !== null && closer.previous !== stackBottom) closer = closer.previous;
    while (closer !== null) {
      if (!closer.canClose) {
        closer = closer.next;
        continue;
      }
      const key = `${closer.cc}${closer.canOpen ? 1 : 0}${closer.cc === '~' ? closer.original : closer.original % 3}`;
      const bottom = openersBottom.has(key) ? openersBottom.get(key) : stackBottom;
      let opener = closer.previous;
      while (opener !== null && opener !== stackBottom && opener !== bottom) {
        if (opener.cc === closer.cc && opener.canOpen && canPair(opener, closer)) break;
        opener = opener.previous;
      }
      if (opener !== null && opener !== stackBottom && opener !== bottom) {
        closer = this.pairDelimiters(opener, closer);
      } else {
        const unmatched = closer;
        closer = closer.next;
        openersBottom.set(key, unmatched.previous);
        if (!unmatched.canOpen) this.removeDelimiter(unmatched);
      }
    }
    while (this.delimiters !== null && this.delimiters !== stackBottom) this.removeDelimiter(this.delimiters);
  }

  /** Wraps the nodes between a matched opener and closer; returns the next closer to look at. */
  pairDelimiters(opener, closer) {
    const strike = closer.cc === '~';
    const used = strike ? closer.count : closer.count >= 2 && opener.count >= 2 ? 2 : 1;
    const openerNode = opener.node;
    const closerNode = closer.node;
    opener.count -= used;
    closer.count -= used;
    openerNode.value = openerNode.value.slice(0, openerNode.value.length - used);
    closerNode.value = closerNode.value.slice(0, closerNode.value.length - used);
    const wrapper = makeNode(strike ? 'delete' : used === 1 ? 'emphasis' : 'strong', {});
    let node = openerNode.next;
    while (node && node !== closerNode) {
      const next = node.next;
      unlink(node);
      appendChild(wrapper, node);
      node = next;
    }
    insertAfter(openerNode, wrapper);
    if (opener.next !== closer) {
      opener.next = closer;
      closer.previous = opener;
    }
    if (opener.count === 0) {
      unlink(openerNode);
      this.removeDelimiter(opener);
    }
    if (closer.count === 0) {
      const next = closer.next;
      unlink(closerNode);
      this.removeDelimiter(closer);
      return next;
    }
    return closer;
  }

  // ----- links and images -----

  addBracket(node, index, image) {
    if (this.brackets) this.brackets.bracketAfter = true;
    this.brackets = {
      node, index, image, active: true, bracketAfter: false, previous: this.brackets, previousDelimiter: this.delimiters,
    };
  }

  parseOpenBracket(block) {
    const node = textNode('[');
    appendChild(block, node);
    this.addBracket(node, this.pos, false);
    this.pos += 1;
  }

  parseBang(block) {
    if (this.peek(1) === '[') {
      const node = textNode('![');
      appendChild(block, node);
      this.addBracket(node, this.pos + 1, true);
      this.pos += 2;
    } else {
      appendChild(block, textNode('!'));
      this.pos += 1;
    }
  }

  parseCloseBracket(block) {
    this.pos += 1;
    const afterBracket = this.pos;
    const opener = this.brackets;
    if (opener === null) {
      appendChild(block, textNode(']'));
      return;
    }
    if (!opener.active) {
      appendChild(block, textNode(']'));
      this.brackets = opener.previous;
      return;
    }
    const target = this.parseInlineTarget() ?? this.parseReferenceTarget(opener, afterBracket);
    if (target === null) {
      this.brackets = opener.previous;
      this.pos = afterBracket;
      appendChild(block, textNode(']'));
      return;
    }
    const node = makeNode(opener.image ? 'image' : 'link', { url: target.destination, title: target.title });
    let child = opener.node.next;
    while (child) {
      const next = child.next;
      unlink(child);
      appendChild(node, child);
      child = next;
    }
    appendChild(block, node);
    this.processEmphasis(opener.previousDelimiter);
    this.brackets = opener.previous;
    unlink(opener.node);
    if (!opener.image) {
      for (let earlier = this.brackets; earlier; earlier = earlier.previous) {
        if (!earlier.image) earlier.active = false; // no links inside links
      }
    }
  }

  /** `(destination "title")` right after `]`; restores the position on failure. */
  parseInlineTarget() {
    if (this.peek() !== '(') return null;
    const start = this.pos;
    this.pos += 1;
    this.match(RE_SPNL);
    const destination = this.parseLinkDestination();
    if (destination !== null) {
      const beforeTitle = this.pos;
      this.match(RE_SPNL);
      const title = this.pos > beforeTitle ? this.parseLinkTitle() : null;
      this.match(RE_SPNL);
      if (this.peek() === ')') {
        this.pos += 1;
        return { destination, title: title ?? '' };
      }
    }
    this.pos = start;
    return null;
  }

  /** Full, collapsed or shortcut reference link lookups. */
  parseReferenceTarget(opener, afterBracket) {
    const beforeLabel = this.pos;
    const length = this.parseLinkLabel();
    let label = null;
    if (length > 2) label = this.subject.slice(beforeLabel, beforeLabel + length);
    else if (!opener.bracketAfter) label = this.subject.slice(opener.index, afterBracket);
    if (length === 0) this.pos = afterBracket;
    const ref = label === null ? undefined : this.refmap.get(normalizeLabel(label));
    return ref ? { destination: ref.destination, title: ref.title } : null;
  }

  parseLinkDestination() {
    const braces = this.match(RE_LINK_DEST_BRACES);
    if (braces) return unescapeString(braces[1]);
    if (this.peek() === '<') return null;
    const start = this.pos;
    let depth = 0;
    while (this.pos < this.subject.length) {
      const ch = this.subject[this.pos];
      if (ch === '\\' && isAsciiPunctuation(this.peek(1))) {
        this.pos += 2;
      } else if (ch === '(') {
        depth += 1;
        if (depth > MAX_LINK_PAREN_DEPTH) break;
        this.pos += 1;
      } else if (ch === ')') {
        if (depth === 0) break;
        depth -= 1;
        this.pos += 1;
      } else if (ch <= ' ' || ch === '\u007f') {
        break;
      } else {
        this.pos += 1;
      }
    }
    if (depth !== 0 || (this.pos === start && this.peek() !== ')')) {
      this.pos = start;
      return null;
    }
    return unescapeString(this.subject.slice(start, this.pos));
  }

  parseLinkTitle() {
    const m = this.match(RE_LINK_TITLE);
    return m ? unescapeString(m[1] ?? m[2] ?? m[3]) : null;
  }

  parseLinkLabel() {
    const m = this.match(RE_LINK_LABEL);
    return m ? m[0].length : 0;
  }

  parseReference(content) {
    this.subject = content;
    this.pos = 0;
    const labelLength = this.parseLinkLabel();
    if (labelLength === 0 || this.peek() !== ':') return 0;
    const label = content.slice(0, labelLength);
    this.pos += 1;
    this.match(RE_SPNL);
    const destination = this.parseLinkDestination();
    if (destination === null) return 0;
    const beforeTitle = this.pos;
    this.match(RE_SPNL);
    let title = this.pos > beforeTitle ? this.parseLinkTitle() : null;
    if (title === null) this.pos = beforeTitle;
    let atLineEnd = this.match(RE_SPACE_AT_EOL) !== null;
    if (!atLineEnd && title !== null) {
      // The title is followed by other text: try the definition without it.
      title = null;
      this.pos = beforeTitle;
      atLineEnd = this.match(RE_SPACE_AT_EOL) !== null;
    }
    const key = normalizeLabel(label);
    if (!atLineEnd || key === '') return 0;
    if (!this.refmap.has(key)) this.refmap.set(key, { destination, title: title ?? '' });
    return this.pos;
  }
}

function canPair(opener, closer) {
  if (closer.cc === '~') return opener.count === closer.count;
  const oddMatch = (closer.canOpen || opener.canClose)
    && closer.original % 3 !== 0
    && (opener.original + closer.original) % 3 === 0;
  return !oddMatch;
}

function autolinkNode(url, label) {
  const link = makeNode('link', { url, title: '', autolink: true });
  appendChild(link, textNode(label));
  return link;
}

// ---------------------------------------------------------------------------
// Conversion to plain nodes and GFM extended autolinks

function toInlineArray(container, depth = 0) {
  const out = [];
  for (let node = container.first; node !== null; node = node.next) {
    if (depth >= MAX_INLINE_DEPTH && node.first !== null && node.type !== 'image') {
      forEachLeaf(node, (leaf) => pushInline(out, toPlainNode(leaf, depth)), true);
    } else {
      pushInline(out, toPlainNode(node, depth));
    }
  }
  return out;
}

/** Appends a node, merging adjacent text and dropping empty text. */
function pushInline(out, plain) {
  if (plain.type === 'text') {
    if (plain.value === '') return;
    const previous = out[out.length - 1];
    if (previous && previous.type === 'text') {
      previous.value += plain.value;
      return;
    }
  }
  out.push(plain);
}

function toPlainNode(node, depth) {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
      return { type: node.type, value: node.value };
    case 'softbreak':
    case 'break':
      return { type: node.type };
    case 'link': {
      const link = { type: 'link', url: node.url, title: node.title, children: toInlineArray(node, depth + 1) };
      if (node.autolink) link.autolink = true;
      return link;
    }
    case 'image':
      return { type: 'image', url: node.url, title: node.title, alt: plainText(node) };
    default:
      return { type: node.type, children: toInlineArray(node, depth + 1) };
  }
}

/** Plain text of a linked subtree (image alt text: images contribute their own alt). */
function plainText(root) {
  let text = '';
  forEachLeaf(root, (leaf) => {
    if (leaf.type === 'text' || leaf.type === 'inlineCode') text += leaf.value;
    else if (leaf.type === 'softbreak' || leaf.type === 'break') text += ' ';
  }, false);
  return text;
}

/**
 * Visits the leaves of a linked subtree in document order without recursion,
 * so arbitrarily deep input cannot overflow the call stack. Images count as
 * leaves when `keepImages` is set.
 */
function forEachLeaf(root, visit, keepImages) {
  let node = root.first;
  while (node !== null) {
    if (node.first !== null && !(keepImages && node.type === 'image')) {
      node = node.first;
      continue;
    }
    visit(node);
    while (node.next === null) {
      node = node.parent;
      if (node === root) return;
    }
    node = node.next;
  }
}

function linkify(nodes) {
  const out = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      for (const part of splitAutolinks(node.value)) out.push(part);
    } else {
      if (node.children && node.type !== 'link') node.children = linkify(node.children);
      out.push(node);
    }
  }
  return out;
}

/** Splits a text value around bare `http(s)://` and `www.` URLs (GFM rules). */
function splitAutolinks(value) {
  if (!/https?:\/\/|www\./i.test(value)) return [{ type: 'text', value }];
  const parts = [];
  let last = 0;
  RE_EXT_AUTOLINK.lastIndex = 0;
  let m;
  while ((m = RE_EXT_AUTOLINK.exec(value)) !== null) {
    const start = m.index;
    if (start > 0 && !/[\s*_~(]/.test(value[start - 1])) continue;
    const candidate = trimAutolink(m[0]);
    const www = /^www\./i.test(candidate);
    const host = www ? candidate : candidate.slice(candidate.indexOf('//') + 2);
    if (!isValidDomain(host)) continue;
    if (start > last) parts.push({ type: 'text', value: value.slice(last, start) });
    parts.push({
      type: 'link',
      url: www ? `http://${candidate}` : candidate,
      title: '',
      autolink: true,
      children: [{ type: 'text', value: candidate }],
    });
    last = start + candidate.length;
    RE_EXT_AUTOLINK.lastIndex = last;
  }
  if (last < value.length) parts.push({ type: 'text', value: value.slice(last) });
  return parts;
}

function trimAutolink(url) {
  let s = url;
  while (s.length > 0) {
    const last = s[s.length - 1];
    if (AUTOLINK_TRAILING.includes(last)) {
      s = s.slice(0, -1);
    } else if (last === ')' && countChar(s, ')') > countChar(s, '(')) {
      s = s.slice(0, -1);
    } else if (last === ';' && /&[A-Za-z0-9]+;$/.test(s)) {
      s = s.replace(/&[A-Za-z0-9]+;$/, '');
    } else {
      break;
    }
  }
  return s;
}

function countChar(text, ch) {
  let n = 0;
  for (const c of text) if (c === ch) n += 1;
  return n;
}

function isValidDomain(hostAndPath) {
  const m = RE_DOMAIN.exec(hostAndPath);
  if (!m) return false;
  const segments = m[0].split('.');
  return segments.length >= 2 && !segments.slice(-2).some((segment) => segment.includes('_'));
}

