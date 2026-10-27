import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8');
const filesIn = (dir, extension) => readdirSync(new URL(dir, ROOT))
  .filter((name) => name.endsWith(extension))
  .map((name) => ({ name: `${dir}${name}`, code: read(`${dir}${name}`) }));

const SOURCES = filesIn('src/', '.js');
const OTHER_FILES = [...filesIn('test/', '.js'), ...filesIn('test/fixtures/', '.json'), ...filesIn('assets/', '.svg')];

test('the logic lives in src/', () => {
  assert.ok(SOURCES.length >= 15, `${SOURCES.length} modules`);
});

test('shipped code never parses HTML strings, evaluates code or logs', () => {
  const forbidden = /\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write|\beval\s*\(|\bnew\s+Function\b|\bconsole\./;
  for (const { name, code } of SOURCES) assert.doesNotMatch(code, forbidden, name);
});

test('localStorage is only used through src/storage.js', () => {
  for (const { name, code } of SOURCES) {
    if (name === 'src/storage.js') continue;
    assert.doesNotMatch(code, /localStorage\s*[.[(?]|sessionStorage|indexedDB/, name);
  }
});

test('modules do not use browser globals', () => {
  for (const { name, code } of SOURCES) {
    assert.doesNotMatch(code, /\b(?:window|document|navigator|location)\.\w/, name);
  }
});

test('modules only import each other', () => {
  for (const { name, code } of SOURCES) {
    for (const [, specifier] of code.matchAll(/\bfrom\s+'([^']+)'/g)) {
      assert.match(specifier, /^\.\/[\w-]+\.js$/, `${name} imports ${specifier}`);
    }
    // JSDoc type references such as {import('./storage.js').SafeStorage} are fine.
    const codeLines = code.split('\n').filter((line) => !/^\s*(?:\/\*|\*|\/\/)/.test(line));
    assert.doesNotMatch(codeLines.join('\n'), /\bimport\s*\(|\brequire\s*\(/, name);
  }
});

test('every module loads outside a browser', async () => {
  for (const { name } of SOURCES) await import(new URL(name, ROOT));
});

test('every export has a doc comment', () => {
  for (const { name, code } of SOURCES) {
    const lines = code.split('\n');
    lines.forEach((line, index) => {
      if (line.startsWith('export ')) assert.match(lines[index - 1] ?? '', /\*\/\s*$/, `${name}:${index + 1}`);
    });
  }
});

test('no invisible or control characters hide in the files', () => {
  const invisible = /[\u{0}-\u{8}\u{b}\u{c}\u{e}-\u{1f}\u{7f}-\u{a0}\u{ad}\u{2000}-\u{200f}\u{2028}-\u{202f}\u{2060}-\u{206f}\u{feff}]/u;
  for (const { name, code } of [...SOURCES, ...OTHER_FILES]) assert.doesNotMatch(code, invisible, name);
});

test('package.json: ES modules, no dependencies, node --test', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts.test, 'node --test');
  assert.equal(pkg.license, 'MIT');
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    assert.equal(pkg[field], undefined, field);
  }
});
