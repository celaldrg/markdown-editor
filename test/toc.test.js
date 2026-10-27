import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createSlugger, slugify } from '../src/slug.js';
import { buildToc } from '../src/toc.js';
import { parse } from '../src/parser.js';
import { renderHtml } from '../src/render.js';
import { createRng } from '../src/rng.js';
import { SAMPLES } from '../src/sample.js';

describe('slugify', () => {
  const cases = [
    ['Hello, World!', 'hello-world'],
    ['  many   spaces  ', 'many-spaces'],
    ['C++ & Go', 'c-go'],
    ['v1.2.3', 'v123'],
    ['snake_case and kebab-case', 'snake_case-and-kebab-case'],
    ['\u{1f680} Launch', 'launch'],
    ['\u{c7}al\u{131}\u{15f}ma Notlar\u{131}', '\u{e7}al\u{131}\u{15f}ma-notlar\u{131}'],
    ['\u{130}stanbul', 'istanbul'],
    ['Stra\u{df}e', 'stra\u{df}e'],
    ['', ''],
  ];
  for (const [text, slug] of cases) {
    test(JSON.stringify(text), () => assert.equal(slugify(text), slug));
  }
});

describe('createSlugger gives unique slugs', () => {
  test('repeats get numbered suffixes', () => {
    const slug = createSlugger();
    assert.deepEqual(['Intro', 'Intro', 'intro', 'Intro!'].map(slug), ['intro', 'intro-1', 'intro-2', 'intro-3']);
  });

  test('a suffix never collides with a heading that looks like one', () => {
    const slug = createSlugger();
    assert.deepEqual(['a-1', 'a', 'a', 'a 1', 'a-2'].map(slug), ['a-1', 'a', 'a-2', 'a-1-1', 'a-2-1']);
  });

  test('empty slugs become "section"', () => {
    const slug = createSlugger();
    assert.deepEqual(['', '!!!', '\u{1f600}'].map(slug), ['section', 'section-1', 'section-2']);
  });

  test('every slug of a large random document is unique and non-empty', () => {
    const rng = createRng(7);
    const words = ['a', 'a-1', 'a 1', 'A', 'a!', '', '-', 'b-2', 'b', 'section', 'section-1', '1', '\u{e7}'];
    const slug = createSlugger();
    const slugs = Array.from({ length: 2000 }, () => {
      const count = 1 + Math.floor(rng() * 3);
      return slug(Array.from({ length: count }, () => words[Math.floor(rng() * words.length)]).join(' '));
    });
    assert.equal(new Set(slugs).size, slugs.length);
    for (const value of slugs) assert.match(value, /^[\p{L}\p{M}\p{N}\p{Pc}-]+$/u);
  });

  test('each document starts with a fresh slugger', () => {
    assert.equal(parse('# Same').children[0].id, 'same');
    assert.equal(parse('# Same').children[0].id, 'same');
  });
});

describe('buildToc', () => {
  const md = [
    '## Getting **started**', '', 'Intro', '',
    '### Install `npm`', '',
    '> #### Quoted heading', '',
    '- item', '', '  ### In a list', '',
    'Setext', '------', '',
    '## Getting started', '',
    '## ![logo](a.png) Brand',
  ].join('\n');

  test('lists every heading in order, also inside quotes and lists', () => {
    assert.deepEqual(buildToc(parse(md)), [
      { level: 2, depth: 0, text: 'Getting started', id: 'getting-started', line: 0 },
      { level: 3, depth: 1, text: 'Install npm', id: 'install-npm', line: 4 },
      { level: 4, depth: 2, text: 'Quoted heading', id: 'quoted-heading', line: 6 },
      { level: 3, depth: 1, text: 'In a list', id: 'in-a-list', line: 10 },
      { level: 2, depth: 0, text: 'Setext', id: 'setext', line: 12 },
      { level: 2, depth: 0, text: 'Getting started', id: 'getting-started-1', line: 15 },
      { level: 2, depth: 0, text: 'logo Brand', id: 'logo-brand', line: 17 },
    ]);
  });

  test('ids are the element ids of the rendered headings', () => {
    for (const source of [md, ...Object.values(SAMPLES).map((sample) => sample.content)]) {
      const doc = parse(source);
      const rendered = [...renderHtml(doc).matchAll(/<h[1-6] id="([^"]*)"/g)].map((m) => m[1]);
      assert.deepEqual(buildToc(doc).map((entry) => entry.id), rendered);
    }
  });

  test('collapses whitespace of multi-line headings', () => {
    assert.equal(buildToc(parse('Two\nlines\n===')).at(0).text, 'Two lines');
  });

  test('a document without headings has an empty TOC', () => {
    assert.deepEqual(buildToc(parse('Just a paragraph.\n\n```\n# not a heading\n```')), []);
  });
});
