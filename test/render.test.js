import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parser.js';
import { renderDom, renderHtml } from '../src/render.js';
import { SAMPLES } from '../src/sample.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const CASES = fixture('parser-cases.json');
const ATTACKS = fixture('xss-attacks.json');
const ALLOWED = fixture('markup-allowlist.json');

const ALL_OPTIONS = { idPrefix: 'doc-', sourceLines: true, externalLinks: true, interactiveTasks: true };
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input']);
const BOOLEAN_ATTRIBUTES = new Set(['checked', 'disabled']);
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);

/**
 * A minimal DOM offering only what the renderer may use: createElement,
 * createTextNode, createDocumentFragment, setAttribute and appendChild.
 * innerHTML, outerHTML, insertAdjacentHTML and document.write throw.
 */
function createFakeDocument() {
  const forbidden = (name) => () => {
    throw new Error(`${name} must not be used`);
  };
  const parentNode = (props) => {
    const node = { ...props, childNodes: [] };
    node.appendChild = (child) => {
      node.childNodes.push(child);
      return child;
    };
    node.insertAdjacentHTML = forbidden('insertAdjacentHTML');
    for (const name of ['innerHTML', 'outerHTML']) {
      Object.defineProperty(node, name, { get: forbidden(name), set: forbidden(name) });
    }
    return node;
  };
  return {
    write: forbidden('document.write'),
    createElement(tagName) {
      const element = parentNode({ nodeType: 1, tagName, attributes: new Map() });
      element.setAttribute = (name, value) => {
        assert.equal(typeof value, 'string');
        element.attributes.set(name, value);
      };
      return element;
    },
    createTextNode: (data) => ({ nodeType: 3, data }),
    createDocumentFragment: () => parentNode({ nodeType: 11 }),
  };
}

const escape = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Serializes fake DOM nodes with the conventions of renderHtml (escaped text, bare boolean attributes). */
function serialize(node) {
  if (node.nodeType === 3) return escape(node.data);
  const inner = node.childNodes.map(serialize).join('');
  if (node.nodeType === 11) return inner;
  const attributes = [...node.attributes]
    .map(([name, value]) => (BOOLEAN_ATTRIBUTES.has(name) && value === '' ? ` ${name}` : ` ${name}="${escape(value)}"`))
    .join('');
  return VOID_TAGS.has(node.tagName) ? `<${node.tagName}${attributes}>` : `<${node.tagName}${attributes}>${inner}</${node.tagName}>`;
}

// renderHtml puts a newline between block tags for readability; the DOM has no such text nodes.
const BLOCK_TAGS = 'p|h[1-6]|hr|blockquote|ul|ol|li|pre|table|thead|tbody|tr|th|td';
const RE_NEWLINE_BEFORE_BLOCK = new RegExp(`\\n(?=</?(?:${BLOCK_TAGS})[\\s>])`, 'g');
const RE_NEWLINE_AFTER_BLOCK = new RegExp(`(</?(?:${BLOCK_TAGS})(?:\\s[^>]*)?>)\\n`, 'g');
const withoutLayoutNewlines = (html) => html.replace(RE_NEWLINE_BEFORE_BLOCK, '').replace(RE_NEWLINE_AFTER_BLOCK, '$1');

function renderBoth(md, options) {
  const ast = parse(md);
  const fragment = renderDom(ast, createFakeDocument(), options);
  return { fragment, dom: serialize(fragment), html: renderHtml(ast, options) };
}

/** Lists elements, attributes and URLs of a DOM tree that are not allowed. */
function domProblems(node, problems = []) {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) continue;
    const allowed = ALLOWED[child.tagName];
    if (!allowed) problems.push(`element ${child.tagName}`);
    for (const [name, value] of child.attributes) {
      if (!allowed?.includes(name)) problems.push(`attribute ${name} on ${child.tagName}`);
      if ((name === 'href' || name === 'src') && !isSafeUrl(value)) problems.push(`url ${value}`);
    }
    if (VOID_TAGS.has(child.tagName) && child.childNodes.length > 0) problems.push(`children in ${child.tagName}`);
    domProblems(child, problems);
  }
  return problems;
}

function isSafeUrl(url) {
  if (/[\s\u{0}-\u{1f}\u{7f}]/u.test(url)) return false;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(url);
  return !scheme || SAFE_SCHEMES.has(scheme[1].toLowerCase());
}

describe('renderDom builds the same tree as renderHtml', () => {
  for (const c of CASES) {
    test(`${c.section}: ${c.name}`, () => {
      const { dom, html } = renderBoth(c.md);
      assert.equal(withoutLayoutNewlines(dom), withoutLayoutNewlines(html));
    });
  }

  test('the sample documents, with every option', () => {
    for (const { content } of Object.values(SAMPLES)) {
      const { dom, html } = renderBoth(content, ALL_OPTIONS);
      assert.equal(withoutLayoutNewlines(dom), withoutLayoutNewlines(html));
    }
  });

  test('returns a document fragment and sets boolean attributes to ""', () => {
    const { fragment } = renderBoth('- [x] done');
    assert.equal(fragment.nodeType, 11);
    const input = fragment.childNodes[0].childNodes[0].childNodes[0];
    assert.equal(input.tagName, 'input');
    assert.deepEqual([...input.attributes], [['type', 'checkbox'], ['checked', ''], ['disabled', '']]);
  });

  test('empty text is not added as a node', () => {
    const { fragment } = renderBoth('**a**');
    const strong = fragment.childNodes[0].childNodes[0];
    assert.deepEqual(strong.childNodes.map((node) => node.data), ['a']);
  });
});

describe('renderDom keeps attacks inert', () => {
  for (const attack of ATTACKS) {
    test(attack.name, () => {
      for (const options of [{}, ALL_OPTIONS]) {
        const { fragment, dom, html } = renderBoth(attack.md, options);
        assert.deepEqual(domProblems(fragment), []);
        assert.equal(withoutLayoutNewlines(dom), withoutLayoutNewlines(html));
      }
    });
  }
});

describe('render options', () => {
  test('sourceLines adds the 0-based source line to block elements', () => {
    const md = '# A\n\ntext\n\n- x\n- y\n\n> q\n\n```\nc\n```\n\n---\n\n| a |\n| - |\n| b |\n\n1. [ ] t';
    assert.equal(renderHtml(parse(md), { sourceLines: true }), [
      '<h1 id="a" data-line="0">A</h1>',
      '<p data-line="2">text</p>',
      '<ul data-line="4">',
      '<li data-line="4">x</li>',
      '<li data-line="5">y</li>',
      '</ul>',
      '<blockquote data-line="7">',
      '<p data-line="7">q</p>',
      '</blockquote>',
      '<pre data-line="9"><code>c\n</code></pre>',
      '<hr data-line="13">',
      '<table data-line="15">',
      '<thead>',
      '<tr data-line="15">',
      '<th>a</th>',
      '</tr>',
      '</thead>',
      '<tbody>',
      '<tr data-line="17">',
      '<td>b</td>',
      '</tr>',
      '</tbody>',
      '</table>',
      '<ol class="contains-task-list" data-line="19">',
      '<li class="task-list-item" data-line="19"><input type="checkbox" disabled> t</li>',
      '</ol>',
      '',
    ].join('\n'));
  });

  test('idPrefix prefixes heading ids and fragment links', () => {
    assert.equal(
      renderHtml(parse('# Intro\n\n[go](#intro)'), { idPrefix: 'p1-' }),
      '<h1 id="p1-intro">Intro</h1>\n<p><a href="#p1-intro">go</a></p>\n',
    );
  });

  test('externalLinks opens http(s) and mailto links in a new tab, not relative ones', () => {
    const output = renderHtml(parse('[a](https://x.example) [b](/local) [c](mailto:a@b.example) [d](#top) www.z.example'), { externalLinks: true });
    const external = ' target="_blank" rel="noopener noreferrer"';
    assert.equal(output, [
      `<p><a href="https://x.example"${external}>a</a>`,
      '<a href="/local">b</a>',
      `<a href="mailto:a@b.example"${external}>c</a>`,
      '<a href="#top">d</a>',
      `<a href="http://www.z.example"${external}>www.z.example</a></p>\n`,
    ].join(' '));
  });

  test('interactiveTasks leaves the checkboxes enabled', () => {
    const md = '- [ ] a\n- [x] b';
    assert.equal((renderHtml(parse(md)).match(/ disabled/g) ?? []).length, 2);
    assert.doesNotMatch(renderHtml(parse(md), { interactiveTasks: true }), /disabled/);
  });

  test('unknown node types render nothing', () => {
    const ast = { type: 'document', children: [{ type: 'mystery', children: [] }, { type: 'paragraph', children: [{ type: 'mystery' }] }] };
    assert.equal(renderHtml(ast), '<p></p>\n');
  });
});
