import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEMO_ANCHOR, SAMPLE_MARKDOWN, SAMPLE_TITLE, SAMPLES } from '../src/sample.js';
import { parse } from '../src/parser.js';
import { inlineText } from '../src/ast.js';
import { LANGS } from '../src/i18n.js';

/** Every node of the AST, depth first. */
function nodesOf(node, out = []) {
  out.push(node);
  for (const child of node.children ?? []) nodesOf(child, out);
  return out;
}

// Text that each sample shows with backslash escapes.
const ESCAPED = {
  en: ['*not italic*', '`not code`', '[not a link]'],
  tr: ['*italik değil*', '`kod değil`', '[bağlantı değil]'],
};
const BLOCK_TYPES = new Set(['heading', 'paragraph', 'blockquote', 'list', 'listItem', 'codeBlock', 'table', 'thematicBreak']);

/** The block structure of a document: block types (headings with their level), depth first. */
const blockShape = (markdown) => nodesOf(parse(markdown))
  .filter((node) => BLOCK_TYPES.has(node.type))
  .map((node) => (node.type === 'heading' ? `h${node.level}` : node.type));

for (const lang of LANGS) {
  const { content } = SAMPLES[lang];
  const nodes = nodesOf(parse(content));
  const ofType = (type) => nodes.filter((node) => node.type === type);

  describe(`the ${lang} sample document shows every feature`, () => {
    test('headings: setext and ATX', () => {
      const headings = ofType('heading');
      assert.equal(headings[0].level, 1);
      assert.equal(content.split('\n')[1].startsWith('==='), true);
      assert.deepEqual([...new Set(headings.map((h) => h.level))].sort(), [1, 2, 3]);
    });

    test('inline styles, code, escapes and a hard line break', () => {
      for (const type of ['emphasis', 'strong', 'delete', 'inlineCode', 'break', 'softbreak']) {
        assert.ok(ofType(type).length > 0, type);
      }
      const text = inlineText(ofType('paragraph').flatMap((p) => p.children));
      for (const escaped of ESCAPED[lang]) assert.ok(text.includes(escaped), escaped);
    });

    test('links of every kind and an image', () => {
      const links = ofType('link');
      assert.ok(links.some((link) => link.title && !link.autolink), 'inline link with a title');
      assert.ok(links.some((link) => link.autolink && link.url.startsWith('https://')), 'autolink');
      assert.ok(links.some((link) => link.autolink && link.url === 'http://www.example.com'), 'bare www link');
      assert.ok(links.some((link) => link.url === 'https://spec.commonmark.org/'), 'reference link');
      assert.ok(links.some((link) => link.url.startsWith('mailto:')), 'email');
      const [image] = ofType('image');
      assert.equal(image.url, 'assets/sample.svg');
      assert.ok(image.title && image.alt);
    });

    test('nested, ordered, loose and task lists', () => {
      const lists = ofType('list');
      assert.ok(lists.some((list) => list.ordered) && lists.some((list) => !list.ordered));
      assert.ok(lists.some((list) => !list.tight), 'loose list');
      assert.ok(ofType('listItem').some((item) => item.children.some((child) => child.type === 'list')), 'nested list');
      assert.deepEqual(ofType('listItem').map((item) => item.checked).filter((c) => c !== null), [true, true, false]);
    });

    test('nested quotes holding a list, an aligned table, a code block and a rule', () => {
      const quotes = ofType('blockquote');
      assert.ok(quotes.some((quote) => quote.children.some((child) => child.type === 'blockquote')), 'nested quote');
      assert.ok(quotes.some((quote) => quote.children.some((child) => child.type === 'list')), 'list in a quote');
      const [table] = ofType('table');
      assert.deepEqual(table.align, ['left', 'center', 'right']);
      assert.ok(ofType('codeBlock').some((block) => block.lang === 'js'));
      assert.equal(ofType('thematicBreak').length, 1);
    });

    test('the table source is aligned', () => {
      const rows = content.split('\n').filter((line) => line.startsWith('|'));
      assert.ok(rows.length >= 4);
      assert.equal(new Set(rows.map((row) => row.length)).size, 1);
    });
  });
}

describe('sample metadata', () => {
  test('title and demo anchor', () => {
    assert.equal(SAMPLE_TITLE, 'Welcome');
    assert.deepEqual(SAMPLES.en, { title: SAMPLE_TITLE, content: SAMPLE_MARKDOWN });
    assert.equal(SAMPLE_MARKDOWN.split('\n').filter((line) => line === DEMO_ANCHOR).length, 1);
  });

  test('there is a sample for every interface language, and the Turkish one is in Turkish', () => {
    assert.deepEqual(Object.keys(SAMPLES).sort(), [...LANGS].sort());
    assert.equal(SAMPLES.tr.title, 'Hoş geldiniz');
    assert.match(SAMPLES.tr.content, /^Markdown Düzenleyici'ye hoş geldiniz\n=+\n/);
    assert.equal(SAMPLES.tr.content, SAMPLES.tr.content.normalize('NFC'));
  });

  test('the Turkish sample mirrors the English one block for block', () => {
    assert.deepEqual(blockShape(SAMPLES.tr.content), blockShape(SAMPLES.en.content));
  });

  test('the sample image is a local, script-free SVG', () => {
    const svg = readFileSync(new URL('../assets/sample.svg', import.meta.url), 'utf8');
    assert.match(svg, /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /role="img"/);
    assert.match(svg, /<title[^>]*>[^<]+<\/title>/);
    // Only local references such as fill="url(#glow)".
    assert.doesNotMatch(svg, /<script|\son\w+=|href=|url\((?!#)|<image|<foreignObject/i);
  });
});
