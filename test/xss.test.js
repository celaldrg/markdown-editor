import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parser.js';
import { renderHtml } from '../src/render.js';
import { EXPORT_CSP, exportHtmlDocument } from '../src/export.js';
import { SAMPLES } from '../src/sample.js';
import { sanitizeUrl } from '../src/url.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const CASES = fixture('parser-cases.json');
// Each attack: {name, md, noLinks}; noLinks = the output must not contain <a> or <img>.
const ATTACKS = fixture('xss-attacks.json');
// Tag name -> allowed attribute names.
const ALLOWED = fixture('markup-allowlist.json');

// Unicode spaces that String#trim() removes but a URL parser keeps. Each one
// hides a scheme raw and as hex and decimal references, in four link forms.
const SPACE_CODES = [0x1680, ...Array.from({ length: 11 }, (_, i) => 0x2000 + i), 0x202f, 0x205f, 0x3000];
const HIDDEN_SCHEMES = ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+', 'vbscript:msgbox(1)'];
const LINK_FORMS = {
  'an inline link': (url) => `[x](${url})`,
  'an image': (url) => `![x](${url})`,
  'a reference definition': (url) => `[x][r]\n\n[r]: ${url}`,
  'a <...> destination': (url) => `[x](<${url}>)`,
};
const codeLabel = (code) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;

/** The attacks hiding a scheme behind one space character, as {name, md, noLinks}. */
function spaceAttacks(code) {
  const spellings = [String.fromCodePoint(code), `&#x${code.toString(16)};`, `&#${code};`];
  return spellings.flatMap((space) => HIDDEN_SCHEMES.flatMap((scheme) => Object.entries(LINK_FORMS).map(([form, make]) => ({
    name: `${codeLabel(code)} ${space.startsWith('&') ? space : 'raw'} before ${scheme.split(':')[0]}: in ${form}`,
    md: make(space + scheme),
    noLinks: true,
  }))));
}
const SPACE_ATTACKS = SPACE_CODES.flatMap(spaceAttacks);

const ALL_OPTIONS = { idPrefix: 'doc-', sourceLines: true, externalLinks: true, interactiveTasks: true };
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input']);
const BOOLEAN_ATTRIBUTES = new Set(['checked', 'disabled']);
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);
const RE_TAG = /<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:\s+[^\s"'<>/=]+(?:="[^"]*")?)*)\s*>/g;
const RE_ATTRIBUTE = /\s+([^\s"'<>/=]+)(?:="([^"]*)")?/g;
// What an href/src may contain: URL characters, with & written as &amp;.
const RE_URL_TEXT = /^(?:[A-Za-z0-9;/?:@=+$,\-_.!~*'()#%]|&amp;)*$/;
const RE_SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const CLASS_PATTERNS = {
  code: /^language-[\p{L}\p{N}_#+.-]+$/u,
  ul: /^contains-task-list$/,
  ol: /^contains-task-list$/,
  li: /^task-list-item$/,
};

/**
 * Reads rendered HTML the way a browser would and lists every problem: tags
 * or attributes outside the allowlist, markup that is not a known tag,
 * character references the renderer never writes, unsafe URLs and
 * unbalanced tags. An empty list means the HTML is inert.
 * @param {string} html
 * @returns {string[]}
 */
function inspect(html) {
  const problems = [];
  const open = [];
  const text = html.replace(RE_TAG, (tag, slash, name, attributes) => {
    checkTag({ tag, closing: slash === '/', name, attributes }, open, problems);
    return '';
  });
  if (/[<>]/.test(text)) problems.push(`markup outside a known tag: ${JSON.stringify(text)}`);
  if (/&(?!(?:amp|lt|gt|quot);)/.test(html)) problems.push('a character reference the renderer never writes');
  if (open.length > 0) problems.push(`unclosed tags: ${open.join(', ')}`);
  return problems;
}

function checkTag({ tag, closing, name, attributes }, open, problems) {
  if (!Object.hasOwn(ALLOWED, name)) {
    problems.push(`tag not allowed: ${tag}`);
    return;
  }
  if (closing) {
    if (attributes !== '' || VOID_TAGS.has(name) || open.pop() !== name) problems.push(`unbalanced: ${tag}`);
    return;
  }
  if (!VOID_TAGS.has(name)) open.push(name);
  const seen = new Set();
  for (const [, attribute, value] of attributes.matchAll(RE_ATTRIBUTE)) {
    if (seen.has(attribute)) problems.push(`duplicate attribute: ${tag}`);
    seen.add(attribute);
    if (!ALLOWED[name].includes(attribute)) problems.push(`attribute not allowed: ${tag}`);
    else if (!isValidValue(name, attribute, value)) problems.push(`bad attribute value: ${tag}`);
  }
}

function isValidValue(tag, attribute, value) {
  if (BOOLEAN_ATTRIBUTES.has(attribute)) return value === undefined;
  if (value === undefined || /[<>]/.test(value)) return false;
  switch (attribute) {
    case 'href':
    case 'src':
      return isSafeUrl(value);
    case 'id':
      return /^[\p{L}\p{M}\p{N}\p{Pc}-]+$/u.test(value);
    case 'class':
      return CLASS_PATTERNS[tag].test(value);
    case 'start':
    case 'data-line':
      return /^\d+$/.test(value);
    case 'align':
      return /^(?:left|center|right)$/.test(value);
    case 'type':
      return value === 'checkbox';
    case 'target':
      return value === '_blank';
    case 'rel':
      return value === 'noopener noreferrer';
    default:
      return true; // title and alt are escaped text
  }
}

/** A URL is safe when it has no scheme (relative) or an http, https or mailto scheme. */
function isSafeUrl(value) {
  if (!RE_URL_TEXT.test(value)) return false;
  const scheme = RE_SCHEME.exec(value.replaceAll('&amp;', '&'));
  return !scheme || SAFE_SCHEMES.has(scheme[1].toLowerCase());
}

const html = (md, options) => renderHtml(parse(md), options);

/** Link and image nodes of a syntax tree, depth first. */
function linksOf(node, out = []) {
  if (node.type === 'link' || node.type === 'image') out.push(node);
  for (const child of node.children ?? []) linksOf(child, out);
  return out;
}
const headOf = (page) => page.slice(0, page.indexOf('<body>'));
const MAIN_OPEN = '<main class="markdown-body">\n';
const bodyOf = (page) => page.slice(page.indexOf(MAIN_OPEN) + MAIN_OPEN.length, page.lastIndexOf('</main>'));

/**
 * Explicit form of the DONE criterion on top of inspect(): no attribute is an
 * event handler and no href/src uses javascript:, vbscript: or data:. (Text
 * and attribute values may still mention "onload=" or "javascript:" as
 * escaped, inert text.)
 */
function assertNoActiveAttributes(markup, message) {
  for (const [, , , attributes] of markup.matchAll(RE_TAG)) {
    for (const [, name, value = ''] of attributes.matchAll(RE_ATTRIBUTE)) {
      assert.doesNotMatch(name, /^on/i, message);
      if (name === 'href' || name === 'src') assert.doesNotMatch(value, /^\s*(?:javascript|vbscript|data):/i, message);
    }
  }
}

describe('the inspector', () => {
  test('flags unsafe markup (so a passing check means something)', () => {
    const unsafe = [
      '<script>alert(1)</script>',
      '<p onclick="alert(1)">a</p>',
      '<a href="javascript:alert(1)">x</a>',
      '<a href="JAVASCRIPT:alert(1)">x</a>',
      '<a href="java&#x09;script:alert(1)">x</a>',
      '<img src="data:image/png;base64,AAAA" alt="">',
      '<a href="vbscript:x">x</a>',
      '<a href="https://a.example" target="_top">x</a>',
      '<iframe src="https://a.example"></iframe>',
      '<p>a < b</p>',
      '<p>&#60;script&#62;</p>',
      '<p>unclosed',
      '<em>a</strong>',
      '<input type="text">',
      '<h1 id="a b">x</h1>',
      '<code class="x" class="y">a</code>',
    ];
    for (const markup of unsafe) assert.notDeepEqual(inspect(markup), [], markup);
  });

  test('accepts the output for every parser case and the sample documents', () => {
    for (const md of [...CASES.map((c) => c.md), ...Object.values(SAMPLES).map((sample) => sample.content)]) {
      assert.deepEqual(inspect(html(md)), [], md);
      assert.deepEqual(inspect(html(md, ALL_OPTIONS)), [], md);
    }
  });
});

describe('attacks are rendered inert', () => {
  assert.ok(ATTACKS.length >= 40);
  for (const attack of ATTACKS) {
    test(attack.name, () => {
      for (const output of [html(attack.md), html(attack.md, ALL_OPTIONS)]) {
        assert.deepEqual(inspect(output), []);
        assert.doesNotMatch(output, /<script/i);
        assertNoActiveAttributes(output);
        if (attack.noLinks) assert.doesNotMatch(output, /<(?:a|img)\b/);
      }
    });
  }
});

describe('a scheme behind a Unicode space is dropped', () => {
  for (const code of SPACE_CODES) {
    test(codeLabel(code), () => {
      for (const attack of spaceAttacks(code)) {
        // The parser does see the link or image, so it is the URL check that drops it.
        const links = linksOf(parse(attack.md));
        assert.equal(links.length, 1, attack.name);
        assert.equal(sanitizeUrl(links[0].url), null, attack.name);
        for (const output of [html(attack.md), html(attack.md, ALL_OPTIONS)]) {
          assert.deepEqual(inspect(output), [], attack.name);
          assertNoActiveAttributes(output, attack.name);
          assert.doesNotMatch(output, /<(?:a|img)\b/, attack.name);
        }
      }
    });
  }
});

describe('safe URLs are kept', () => {
  const cases = [
    ['[a](https://example.com/a?b=1&c=2#d)', '<a href="https://example.com/a?b=1&amp;c=2#d">a</a>'],
    ['[a](HTTP://EXAMPLE.COM/)', '<a href="HTTP://EXAMPLE.COM/">a</a>'],
    ['[a](mailto:hello@example.com)', '<a href="mailto:hello@example.com">a</a>'],
    ['<hello@example.com>', '<a href="mailto:hello@example.com">hello@example.com</a>'],
    ['[a](/docs/page)', '<a href="/docs/page">a</a>'],
    ['[a](../notes/page.md)', '<a href="../notes/page.md">a</a>'],
    ['[a](#install)', '<a href="#install">a</a>'],
    ['[a](?q=1)', '<a href="?q=1">a</a>'],
    ['[a](<my notes.md>)', '<a href="my%20notes.md">a</a>'],
    ['[a](https://example.com/\u{fc}ber)', '<a href="https://example.com/%C3%BCber">a</a>'],
    ['[a](https://example.com/a%20b)', '<a href="https://example.com/a%20b">a</a>'],
    ['![i](images/a.png "Title")', '<img src="images/a.png" alt="i" title="Title">'],
  ];
  for (const [md, expected] of cases) {
    test(md, () => assert.equal(html(md), `<p>${expected}</p>\n`));
  }

  test('other schemes are dropped but the link text stays', () => {
    for (const url of ['tel:123', 'ftp://example.com', 'chrome://settings', 'C:/Windows']) {
      assert.equal(html(`[text](${url})`), '<p>text</p>\n', url);
    }
  });
});

test('DONE: the parser passes at least 60 cases and the HTML export is XSS-safe', () => {
  const passing = CASES.filter((c) => html(c.md) === c.html);
  assert.ok(passing.length >= 60, `only ${passing.length} parser cases pass`);
  assert.equal(passing.length, CASES.length);

  assert.match(EXPORT_CSP, /script-src 'none'/);
  const cleanHead = headOf(exportHtmlDocument('', { title: 'Attack' }));
  assert.ok(cleanHead.includes(`<meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}">`));
  assert.equal(SPACE_ATTACKS.length, 540);
  for (const attack of [...ATTACKS, ...SPACE_ATTACKS]) {
    const page = exportHtmlDocument(attack.md, { title: 'Attack' });
    // Nothing from the document reaches the head, so the CSP always applies.
    assert.equal(headOf(page), cleanHead, attack.name);
    assert.doesNotMatch(page, /<script/i, attack.name);
    const body = bodyOf(page);
    assert.equal(body, html(attack.md), attack.name);
    // No script elements, no event handler attributes, no javascript:/data: URLs.
    assert.deepEqual(inspect(body), [], attack.name);
    assertNoActiveAttributes(body, attack.name);
  }
});
