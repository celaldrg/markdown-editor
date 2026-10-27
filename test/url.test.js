import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeUrl, escapeHtml, sanitizeUrl } from '../src/url.js';
import { decodeEntities, decodeEntity } from '../src/entities.js';

// Unicode spaces that String#trim() removes but a URL parser keeps.
const UNICODE_SPACES = [0x1680, ...Array.from({ length: 11 }, (_, i) => 0x2000 + i), 0x202f, 0x205f, 0x3000];
const HIDDEN_SCHEMES = ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)'];

/** A character as itself and as hex and decimal character references. */
const spellings = (code) => [String.fromCodePoint(code), `&#x${code.toString(16)};`, `&#${code};`];
const label = (code) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;

describe('escapeHtml', () => {
  test('escapes the characters that end text or a quoted attribute', () => {
    assert.equal(escapeHtml('<a href="x">Tom & Jerry</a>'), '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&lt;/a&gt;');
    assert.equal(escapeHtml('&amp;'), '&amp;amp;');
    assert.equal(escapeHtml("it's"), "it's");
  });

  test('turns any value into a string', () => {
    assert.equal(escapeHtml(42), '42');
    assert.equal(escapeHtml(null), 'null');
  });
});

describe('sanitizeUrl', () => {
  test('keeps http, https, mailto and relative URLs', () => {
    const safe = [
      'https://example.com', 'HTTP://EXAMPLE.COM', 'mailto:a@b.example', '/root', 'page.html',
      './a', '../b', '#top', '?q=1', '//cdn.example/x.png', '', 'a/b:c', 'https://example.com/?x=javascript:1',
    ];
    for (const url of safe) assert.equal(sanitizeUrl(url), url, url);
  });

  test('trims surrounding whitespace', () => {
    assert.equal(sanitizeUrl('  https://example.com  '), 'https://example.com');
  });

  test('rejects every other scheme, however it is disguised', () => {
    const unsafe = [
      'javascript:alert(1)', 'JAVASCRIPT:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)',
      'java\nscript:alert(1)', 'java\u{0}script:alert(1)', '\u{200b}javascript:alert(1)',
      '\u{feff}javascript:alert(1)', 'java\u{ad}script:alert(1)', '&#106;avascript:alert(1)',
      '&#x6a;avascript:alert(1)', 'javascript&colon;alert(1)', 'java&Tab;script:alert(1)',
      '&amp;#106;avascript:alert(1)', '&amp;amp;#106;avascript:alert(1)', 'vbscript:msgbox(1)',
      'data:text/html,<script>alert(1)</script>', 'Data:image/png;base64,AAAA', 'file:///etc/passwd',
      'tel:123', 'ftp://example.com', 'blob:https://example.com/id', 'C:/Windows',
    ];
    for (const url of unsafe) assert.equal(sanitizeUrl(url), null, JSON.stringify(url));
  });

  test('rejects a scheme behind any Unicode space, raw or as a character reference', () => {
    for (const code of UNICODE_SPACES) {
      for (const space of spellings(code)) {
        const urls = [`java${space}script:alert(1)`, ...HIDDEN_SCHEMES.flatMap((s) => [space + s, `${space}${space} ${s}`])];
        for (const url of urls) assert.equal(sanitizeUrl(url), null, `${label(code)} ${JSON.stringify(url)}`);
      }
    }
  });

  test('checks the string it returns: nothing that trim() removes can hide a scheme', () => {
    let tested = 0;
    for (let code = 0; code <= 0xffff; code += 1) {
      const ch = String.fromCharCode(code);
      if (`${ch}a`.trim() !== 'a') continue;
      tested += 1;
      assert.equal(sanitizeUrl(`${ch}javascript:alert(1)`), null, label(code));
      assert.equal(sanitizeUrl(`${ch}https://example.com${ch}`), 'https://example.com', label(code));
    }
    assert.ok(tested >= 25, `${tested} characters`);
  });

  test('a kept URL never resolves to another scheme', () => {
    // Every BMP character in front of a scheme, then parsed the way a browser parses an href.
    for (let code = 0; code <= 0xffff; code += 1) {
      const kept = sanitizeUrl(`${String.fromCharCode(code)}javascript:alert(1)`);
      if (kept === null) continue;
      assert.equal(new URL(encodeUrl(kept), 'https://base.example/').protocol, 'https:', label(code));
    }
  });

  test('rejects values that are not strings', () => {
    assert.equal(sanitizeUrl(undefined), null);
    assert.equal(sanitizeUrl(null), null);
    assert.equal(sanitizeUrl({ toString: () => 'javascript:alert(1)' }), null);
  });
});

describe('encodeUrl', () => {
  test('percent-encodes characters that are not allowed in a URL', () => {
    assert.equal(encodeUrl('my file.md'), 'my%20file.md');
    assert.equal(encodeUrl('a"b<c>d\\e`f{g}h|i^j'), 'a%22b%3Cc%3Ed%5Ce%60f%7Bg%7Dh%7Ci%5Ej');
    assert.equal(encodeUrl('[x]'), '%5Bx%5D');
    assert.equal(encodeUrl('\u{fc}ber/\u{1f600}'), '%C3%BCber/%F0%9F%98%80');
  });

  test('keeps URL delimiters and existing escapes', () => {
    const url = "https://user@example.com:8080/a;b/c?d=1&e=%20f+g,h$i!j~k*l'm(n)#o";
    assert.equal(encodeUrl(url), url);
  });

  test('escapes a percent sign that does not start an escape', () => {
    assert.equal(encodeUrl('100%'), '100%25');
    assert.equal(encodeUrl('%zz%41'), '%25zz%41');
  });

  test('replaces a lone surrogate instead of throwing', () => {
    assert.equal(encodeUrl('a\u{d800}b'), 'a%EF%BF%BDb');
  });
});

describe('character references', () => {
  test('decodes numeric and named references', () => {
    assert.equal(decodeEntity('&#35;'), '#');
    assert.equal(decodeEntity('&#x22;'), '"');
    assert.equal(decodeEntity('&#X1F600;'), '\u{1f600}');
    assert.equal(decodeEntity('&amp;'), '&');
    assert.equal(decodeEntity('&copy;'), '\u{a9}');
    assert.equal(decodeEntity('&nbsp;'), '\u{a0}');
  });

  test('invalid code points become U+FFFD', () => {
    for (const ref of ['&#0;', '&#xD800;', '&#x110000;', '&#9999999;']) assert.equal(decodeEntity(ref), '\u{fffd}', ref);
  });

  test('unknown names are left alone, including inherited object keys', () => {
    assert.equal(decodeEntity('&nosuchentity;'), null);
    assert.equal(decodeEntity('&constructor;'), null);
    assert.equal(decodeEntities('&nosuchentity; &toString; &amp;'), '&nosuchentity; &toString; &');
  });

  test('decodes every reference in a text once', () => {
    assert.equal(decodeEntities('&lt;b&gt; &#65;&#x42; &amp;amp;'), '<b> AB &amp;');
    assert.equal(decodeEntities('no references'), 'no references');
    assert.equal(decodeEntities('&amp without semicolon'), '&amp without semicolon');
  });
});
