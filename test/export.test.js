import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPORT_CSP, exportHtmlDocument, toFileName } from '../src/export.js';
import { parse } from '../src/parser.js';
import { renderHtml } from '../src/render.js';
import { SAMPLE_MARKDOWN } from '../src/sample.js';

const headOf = (page) => page.slice(0, page.indexOf('<body>'));

describe('exportHtmlDocument', () => {
  test('builds a complete standalone page around the rendered Markdown', () => {
    const page = exportHtmlDocument('# Hi\n\nText', { title: 'Notes', lang: 'tr' });
    const lines = page.split('\n');
    assert.deepEqual(lines.slice(0, 7), [
      '<!doctype html>',
      '<html lang="tr">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}">`,
      '<title>Notes</title>',
    ]);
    assert.ok(page.endsWith([
      '</head>',
      '<body>',
      '<main class="markdown-body">',
      '<h1 id="hi">Hi</h1>',
      '<p>Text</p>',
      '</main>',
      '</body>',
      '</html>',
      '',
    ].join('\n')));
  });

  test('the body is exactly the HTML renderer output', () => {
    const page = exportHtmlDocument(SAMPLE_MARKDOWN);
    assert.ok(page.includes(`<main class="markdown-body">\n${renderHtml(parse(SAMPLE_MARKDOWN))}</main>`));
  });

  test('the Content Security Policy blocks scripts, plugins, forms and base changes', () => {
    for (const directive of ["script-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]) {
      assert.ok(EXPORT_CSP.includes(directive), directive);
    }
    const page = exportHtmlDocument('text');
    assert.equal(page.split('http-equiv="Content-Security-Policy"').length, 2);
    assert.ok(page.indexOf('Content-Security-Policy') < page.indexOf('<title>'));
  });

  test('the page is self-contained: no scripts, links, imports or external URLs', () => {
    const head = headOf(exportHtmlDocument(SAMPLE_MARKDOWN, { title: 'Sample' }));
    assert.doesNotMatch(head, /<script|<link|@import|url\(|https?:|src=|href=/i);
  });

  test('has light and dark colors with the accent color in dark mode', () => {
    const head = headOf(exportHtmlDocument(''));
    assert.match(head, /@media \(prefers-color-scheme:dark\)\{[^}]*--accent:#60a5fa/);
    assert.match(head, /color-scheme:light dark/);
  });

  test('escapes the title and falls back to "Document"', () => {
    assert.match(exportHtmlDocument('', { title: '</title><script>alert(1)</script>' }), /<title>&lt;\/title&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/title>/);
    assert.match(exportHtmlDocument(''), /<title>Document<\/title>/);
    assert.match(exportHtmlDocument('', { title: '   ' }), /<title>Document<\/title>/);
    assert.match(exportHtmlDocument('', { title: ' Trip & plans ' }), /<title>Trip &amp; plans<\/title>/);
  });

  test('accepts only well-formed language tags', () => {
    const langOf = (lang) => /<html lang="([^"]*)">/.exec(exportHtmlDocument('', { lang }))[1];
    for (const lang of ['en', 'tr', 'pt-BR', 'zh-Hant-TW']) assert.equal(langOf(lang), lang);
    for (const lang of ['"><script>alert(1)</script>', 'x', '', 'EN', 'en_US', 'english', null]) assert.equal(langOf(lang), 'en', String(lang));
  });
});

describe('toFileName', () => {
  const cases = [
    ['My notes', 'md', 'My notes.md'],
    ['Plan', 'html', 'Plan.html'],
    ['a/b:c*d?e"f<g>h|i\\j', 'md', 'a b c d e f g h i j.md'],
    ['tab\there\nnew line', 'md', 'tab here new line.md'],
    ['...hidden...', 'md', 'hidden.md'],
    ['\u{c7}al\u{131}\u{15f}ma Notlar\u{131}', 'md', '\u{c7}al\u{131}\u{15f}ma Notlar\u{131}.md'],
    ['e\u{301}', 'md', '\u{e9}.md'],
    ['', 'md', 'document.md'],
    ['  /// ', 'html', 'document.html'],
    [null, 'md', 'document.md'],
  ];
  for (const [title, extension, expected] of cases) {
    test(JSON.stringify(title), () => assert.equal(toFileName(title, extension), expected));
  }

  test('limits the name to 80 characters without splitting a character', () => {
    assert.equal(toFileName('x'.repeat(200), 'md'), `${'x'.repeat(80)}.md`);
    assert.equal(toFileName('\u{1f680}'.repeat(100), 'md'), `${'\u{1f680}'.repeat(80)}.md`);
    assert.equal(toFileName(`${'a'.repeat(79)} b`, 'md'), `${'a'.repeat(79)}.md`);
  });
});
