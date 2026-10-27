import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { ACTIONS } from '../src/editor-ops.js';
import { STRINGS } from '../src/i18n.js';
import { ICONS } from '../src/icons.js';

const ROOT = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8');
const lines = (text) => text.split(/\r?\n/);

const HTML = read('index.html');
const BODY = HTML.slice(HTML.indexOf('<body>'), HTML.indexOf('</body>'));
const CSS = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '');
const README = read('README.md');
const SOURCES = readdirSync(new URL('src/', ROOT))
  .filter((name) => name.endsWith('.js'))
  .map((name) => ({ name: `src/${name}`, code: read(`src/${name}`) }));

/** Lists the opening tags of some markup with their attributes. */
function tags(markup) {
  return [...markup.matchAll(/<([a-z][\w-]*)\b([^>]*)>/g)].map(([, name, rest]) => ({
    name,
    attrs: Object.fromEntries([...rest.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)].map(([, key, value]) => [key, value ?? ''])),
  }));
}

const meta = (attr, key) => tags(HTML).find((tag) => tag.name === 'meta' && tag.attrs[attr] === key)?.attrs.content;

describe('index.html', () => {
  test('has the required head tags', () => {
    assert.match(HTML, /^<!doctype html>\r?\n<html lang="en">/i);
    assert.ok(tags(HTML).some((tag) => tag.name === 'meta' && tag.attrs.charset === 'utf-8'), 'charset');
    assert.equal(meta('name', 'viewport'), 'width=device-width, initial-scale=1');
    assert.match(HTML, /<title>Markdown Editor<\/title>/);
    assert.ok(meta('name', 'description').length > 40, 'description');
    assert.equal(meta('property', 'og:title'), 'Markdown Editor');
    assert.equal(meta('property', 'og:description'), meta('name', 'description'));
    assert.equal(meta('property', 'og:url'), 'https://celaldrg.github.io/markdown-editor/');
    assert.equal(meta('property', 'og:image'), 'https://celaldrg.github.io/markdown-editor/docs/screenshot.png');
    const favicon = tags(HTML).find((tag) => tag.name === 'link' && tag.attrs.rel === 'icon');
    assert.match(favicon.attrs.href, /^data:image\/svg\+xml,/);
  });

  test('loads one module script and nothing from other sites', () => {
    const scripts = tags(HTML).filter((tag) => tag.name === 'script');
    assert.deepEqual(scripts.map((tag) => tag.attrs), [{ type: 'module', src: 'src/main.js' }]);
    assert.doesNotMatch(HTML, /<script\b[^>]*>[^<]/, 'inline script');
    assert.doesNotMatch(HTML, /<style\b|\sstyle="|\son[a-z]+="/i, 'inline style or handler');
    for (const tag of tags(HTML)) {
      if (tag.name === 'a') continue;
      for (const attr of ['src', 'href']) {
        if (tag.attrs[attr] !== undefined) assert.doesNotMatch(tag.attrs[attr], /^(?:[a-z]+:)?\/\//i, `${tag.name} ${attr}`);
      }
    }
    const policy = meta('http-equiv', 'Content-Security-Policy');
    for (const rule of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "connect-src 'none'", "object-src 'none'"]) {
      assert.ok(policy.includes(rule), rule);
    }
  });

  test('every element the app looks up exists once, and every ARIA reference resolves', () => {
    const ids = tags(BODY).map((tag) => tag.attrs.id).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, 'ids are unique');
    const wanted = [...read('src/app.js').matchAll(/byId\('([\w-]+)'\)/g)].map((match) => match[1]);
    assert.ok(wanted.length >= 30, `${wanted.length} lookups`);
    for (const id of wanted) assert.ok(ids.includes(id), id);
    for (const tag of tags(BODY)) {
      for (const attr of ['aria-controls', 'aria-labelledby', 'aria-describedby']) {
        if (tag.attrs[attr]) assert.ok(ids.includes(tag.attrs[attr]), `${attr}="${tag.attrs[attr]}"`);
      }
    }
  });

  test('buttons never submit by accident', () => {
    for (const tag of tags(BODY).filter((item) => item.name === 'button')) {
      const expected = tag.attrs.id === 'dialog-ok' ? 'submit' : 'button';
      assert.equal(tag.attrs.type, expected, tag.attrs.id ?? tag.attrs['data-action']);
    }
  });

  test('the toolbar has one button per action, in order', () => {
    const tools = tags(BODY).filter((tag) => tag.attrs['data-action']);
    assert.deepEqual(tools.map((tag) => tag.attrs['data-action']), [...ACTIONS]);
    for (const tag of tools) assert.equal(tag.attrs['data-icon'], tag.attrs['data-action']);
    assert.ok(BODY.includes('role="toolbar"'));
  });

  test('every icon name exists and every icon is used', () => {
    const named = tags(BODY).map((tag) => tag.attrs['data-icon']).filter(Boolean);
    for (const name of named) assert.ok(Object.hasOwn(ICONS, name), name);
    const code = SOURCES.map((source) => source.code).join('\n');
    for (const name of Object.keys(ICONS)) {
      assert.ok(named.includes(name) || code.includes(`icon(doc, '${name}')`), name);
    }
  });

  test('the footer links to the source', () => {
    const link = tags(BODY).find((tag) => tag.name === 'a' && tag.attrs.class === 'footer-link');
    assert.equal(link.attrs.href, 'https://github.com/celaldrg/markdown-editor');
    assert.equal(link.attrs.rel, 'noopener noreferrer');
  });
});

describe('translations in the page', () => {
  const KEY_ATTRS = { 'data-i18n': null, 'data-i18n-label': 'aria-label', 'data-i18n-title': 'title', 'data-i18n-placeholder': 'placeholder' };

  test('every key the page uses exists, and the markup holds the English text', () => {
    for (const tag of tags(BODY)) {
      for (const [attr, target] of Object.entries(KEY_ATTRS)) {
        const key = tag.attrs[attr];
        if (key === undefined) continue;
        assert.ok(Object.hasOwn(STRINGS.en, key), `${attr}="${key}"`);
        if (target) assert.equal(tag.attrs[target], STRINGS.en[key], `${target} of ${key}`);
      }
    }
    for (const [, key, text] of BODY.matchAll(/data-i18n="(\w+)"[^>]*>([^<]*)</g)) assert.equal(text, STRINGS.en[key], key);
  });

  test('every visible text, label, title and placeholder is translated', () => {
    const filledByScript = new Set(['save-text', 'save-status']);
    const markup = BODY.replace(/<svg[\s\S]*?<\/svg>/g, '');
    for (const [, tag, text] of markup.matchAll(/(<[^>]*>)([^<]*)/g)) {
      if (/^[\s·]*$/u.test(text)) continue;
      const id = /\sid="([\w-]+)"/.exec(tag)?.[1];
      assert.ok(/\sdata-i18n="/.test(tag) || filledByScript.has(id), `${tag}${text.trim()}`);
    }
    for (const { name, attrs } of tags(markup)) {
      if (filledByScript.has(attrs.id)) continue;
      if (attrs['aria-label'] !== undefined) assert.ok(attrs['data-i18n-label'], `${name} aria-label="${attrs['aria-label']}"`);
      if (attrs.title !== undefined) assert.ok(attrs['data-i18n-title'], `${name} title="${attrs.title}"`);
      if (attrs.placeholder !== undefined) assert.ok(attrs['data-i18n-placeholder'], `${name} placeholder`);
    }
  });

  test('every key the code asks for exists', () => {
    for (const { name, code } of SOURCES) {
      for (const [, key] of code.matchAll(/\btr?\((?:\w+, )?'(\w+)'/g)) assert.ok(Object.hasOwn(STRINGS.en, key), `${name}: ${key}`);
    }
  });

  test('every string in the tables is used', () => {
    const users = [HTML, ...SOURCES.filter((source) => source.name !== 'src/i18n.js').map((source) => source.code)].join('\n');
    for (const key of Object.keys(STRINGS.en)) {
      if (key.endsWith('_one') && Object.hasOwn(STRINGS.en, key.slice(0, -4))) continue;
      assert.ok(users.includes(`'${key}'`) || users.includes(`"${key}"`), key);
    }
  });
});

describe('style.css', () => {
  test('defines the theme tokens', () => {
    const root = /:root\s*\{([^}]*)\}/.exec(CSS)[1];
    for (const token of ['--bg', '--surface', '--line', '--text', '--muted', '--accent', '--radius', '--fast', '--slow']) {
      assert.ok(root.includes(`${token}:`), token);
    }
    assert.match(root, /--accent:\s*#60a5fa;/);
    assert.match(root, /--radius:\s*12px;/);
    assert.match(CSS, /color-scheme:\s*dark/);
  });

  test('transitions take 150 to 250 ms and stop for reduced motion', () => {
    assert.match(CSS, /--fast:\s*150ms;/);
    assert.match(CSS, /--slow:\s*250ms;/);
    for (const [, value] of CSS.matchAll(/transition:([^;]+);/g)) {
      assert.doesNotMatch(value.replace(/var\(--(?:fast|slow|ease)\)|\b0s\b/g, ''), /\d(?:ms|s)\b/, value.trim());
    }
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*transition-duration: 1ms !important;/);
  });

  test('is mobile first: a phone layout and only the splitter turns off touch gestures', () => {
    assert.match(CSS, /@media \(max-width: 767px\)/);
    const rules = [...CSS.matchAll(/([^{}]*)\{[^}]*touch-action:\s*none/g)].map((match) => match[1].trim());
    assert.deepEqual(rules, ['.splitter']);
  });

  test('loads nothing from other sites', () => {
    assert.doesNotMatch(CSS, /@import|url\(/);
  });
});

describe('repository files', () => {
  test('MIT license and GitHub Pages files', () => {
    assert.deepEqual(lines(read('LICENSE')).slice(0, 3), ['MIT License', '', 'Copyright (c) 2026 Celalettin Durgaç']);
    assert.equal(read('.nojekyll'), '');
    assert.deepEqual(lines(read('.gitignore').trim()), ['node_modules/', '.DS_Store']);
  });

  test('CI runs node --test on Node 22', () => {
    const workflow = lines(read('.github/workflows/test.yml'));
    assert.equal(workflow[0], 'name: tests');
    for (const line of ['  push:', '  pull_request:', '    runs-on: ubuntu-latest', '      - uses: actions/checkout@v4',
      '      - uses: actions/setup-node@v4', '          node-version: 22', '      - run: node --test']) {
      assert.ok(workflow.includes(line), line);
    }
  });

  test('README: English first, then Turkish', () => {
    const text = lines(README);
    assert.match(text[0], /^# Markdown Editor - \S/);
    assert.ok(README.includes('[![tests](https://github.com/celaldrg/markdown-editor/actions/workflows/test.yml/badge.svg)](https://github.com/celaldrg/markdown-editor/actions/workflows/test.yml)'));
    assert.match(README, /\[!\[[^\]]+\]\(https:\/\/img\.shields\.io\/badge\/License-MIT-[^)]+\)\]\(LICENSE\)/);
    const order = ['**▶ Open the app: https://celaldrg.github.io/markdown-editor/**', '![screenshot](docs/screenshot.png)',
      '## Features', '## How to use', '## Run locally', '## Tests', '## Project structure', '## License', '## Türkçe',
      '**▶ Uygulamayı aç: https://celaldrg.github.io/markdown-editor/**', '### Özellikler', '### Nasıl kullanılır',
      '### Yerelde çalıştırma', '### Testler', '### Lisans'];
    let previous = 0;
    for (const line of order) {
      const index = text.indexOf(line);
      assert.ok(index > previous, line);
      previous = index;
    }
    assert.ok(text.includes('npx serve .'), 'run command');
    assert.ok(text.includes('node --test'), 'test command');
  });

  test('the screenshot is a 1200 x 800 PNG', () => {
    const png = readFileSync(new URL('docs/screenshot.png', ROOT));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.toString('latin1', 12, 16), 'IHDR');
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 800);
  });

  test('no invisible characters hide in the page, the styles or the docs', () => {
    const invisible = /[\u{0}-\u{8}\u{b}\u{c}\u{e}-\u{1f}\u{7f}-\u{a0}\u{ad}\u{2000}-\u{200f}\u{2028}-\u{202f}\u{2060}-\u{206f}\u{feff}]/u;
    for (const name of ['index.html', 'style.css', 'README.md', 'LICENSE', '.gitignore', '.github/workflows/test.yml']) {
      assert.doesNotMatch(read(name), invisible, name);
    }
  });
});
