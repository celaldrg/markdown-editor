import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/parser.js';
import { renderHtml } from '../src/render.js';

// Each case: {section, name, md, html}. Expected HTML follows the CommonMark
// and GFM reference output, with HTML5 void tags and heading ids.
const CASES = JSON.parse(readFileSync(new URL('./fixtures/parser-cases.json', import.meta.url), 'utf8'));

const FEATURES = [
  'atx-heading', 'setext-heading', 'paragraph', 'emphasis', 'strikethrough', 'inline-code',
  'fenced-code', 'indented-code', 'blockquote', 'list', 'task-list', 'link', 'autolink', 'image',
  'thematic-break', 'table', 'hard-break', 'escape', 'entity', 'raw-html', 'nesting',
];

const html = (md) => renderHtml(parse(md));

describe('parser cases', () => {
  for (const feature of FEATURES) {
    describe(feature, () => {
      for (const c of CASES.filter((k) => k.section === feature)) {
        test(c.name, () => assert.equal(html(c.md), c.html));
      }
    });
  }
});

test('the case table has at least 60 cases and covers every feature', () => {
  assert.ok(CASES.length >= 60, `only ${CASES.length} cases`);
  for (const feature of FEATURES) assert.ok(CASES.some((c) => c.section === feature), `no case for ${feature}`);
  assert.ok(CASES.every((c) => FEATURES.includes(c.section)));
});

describe('AST', () => {
  test('block nodes carry 0-based source lines', () => {
    const doc = parse('# Title\n\nfirst\nsecond\n\n- a\n- b\n\n> quote\n\n```js\ncode\n```');
    const [heading, paragraph, list, quote, code] = doc.children;
    assert.deepEqual([heading.type, heading.line, heading.endLine], ['heading', 0, 0]);
    assert.deepEqual([paragraph.type, paragraph.line, paragraph.endLine], ['paragraph', 2, 3]);
    assert.deepEqual([list.type, list.line, list.endLine], ['list', 5, 6]);
    assert.deepEqual(list.children.map((item) => item.line), [5, 6]);
    assert.deepEqual([quote.type, quote.line], ['blockquote', 8]);
    assert.deepEqual([code.type, code.line, code.endLine], ['codeBlock', 10, 12]);
  });

  test('table rows know their source line (the delimiter row is skipped)', () => {
    const doc = parse('intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |');
    const tableNode = doc.children[1];
    assert.equal(tableNode.type, 'table');
    assert.deepEqual(tableNode.align, [null, null]);
    assert.deepEqual(tableNode.children.map((row) => [row.header, row.line]), [[true, 2], [false, 4], [false, 5]]);
  });

  test('code blocks expose language and info string', () => {
    const [block] = parse('```js title="a.js"\nx\n```').children;
    assert.equal(block.lang, 'js');
    assert.equal(block.info, 'js title="a.js"');
    assert.equal(block.value, 'x\n');
    assert.equal(parse('    indented').children[0].lang, '');
  });

  test('list nodes describe ordering, start, tightness and tasks', () => {
    const [list] = parse('7. [x] done\n8. open').children;
    assert.deepEqual([list.ordered, list.start, list.tight], [true, 7, true]);
    assert.deepEqual(list.children.map((item) => item.checked), [true, null]);
  });

  test('autolinks are marked', () => {
    const [paragraph] = parse('<https://a.example> www.b.example [c](https://c.example)').children;
    const links = paragraph.children.filter((node) => node.type === 'link');
    assert.deepEqual(links.map((link) => Boolean(link.autolink)), [true, true, false]);
  });

  test('line endings, byte order mark and NUL characters', () => {
    assert.equal(html('a\r\nb\rc'), '<p>a\nb\nc</p>\n');
    assert.equal(html('\u{feff}# Title'), '<h1 id="title">Title</h1>\n');
    assert.equal(html('a\u{0}b'), '<p>a\u{fffd}b</p>\n');
  });

  test('empty and missing input give an empty document', () => {
    assert.deepEqual(parse(''), { type: 'document', children: [] });
    assert.deepEqual(parse(undefined), { type: 'document', children: [] });
    assert.equal(html('\n\n   \n'), '');
  });
});

describe('hostile input stays fast and never overflows the stack', () => {
  const inputs = {
    'deeply nested emphasis': `${'*a '.repeat(20000)}${'a* '.repeat(20000)}`,
    'deeply nested strong': `${'**a '.repeat(20000)}${'a** '.repeat(20000)}`,
    'nested images': `${'![a'.repeat(20000)}${'](u)'.repeat(20000)}`,
    'unclosed link destinations': '[a](b'.repeat(10000),
    'many open brackets': '['.repeat(30000),
    'nested quotes': `${'> '.repeat(5000)}a`,
    'nested lists': `${'- '.repeat(5000)}a`,
    'long table': `|a|b|\n|-|-|\n${'|x|y|\n'.repeat(20000)}`,
    'wide table': `|${'a|'.repeat(2000)}\n|${'-|'.repeat(2000)}\n|${'x|'.repeat(2000)}\n`,
    'many backticks': '`a``'.repeat(10000),
    'many less-than signs': '<'.repeat(50000),
  };
  for (const [name, md] of Object.entries(inputs)) {
    test(name, { timeout: 5000 }, () => {
      const output = html(md);
      assert.equal(typeof output, 'string');
      assert.ok(output.length > 0);
    });
  }
});
