import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { highlight, isHighlighted } from '../src/highlight.js';
import { createRng } from '../src/rng.js';

const join = (tokens) => tokens.map((token) => token.text).join('');
const typed = (tokens, type) => tokens.filter((token) => token.type === type).map((token) => token.text);

describe('highlight', () => {
  test('marks keywords, functions, numbers, strings and comments in JavaScript', () => {
    const tokens = highlight("const n = count('a b'); // two", 'js');
    assert.deepEqual(tokens, [
      { type: 'keyword', text: 'const' },
      { type: 'plain', text: ' n = ' },
      { type: 'function', text: 'count' },
      { type: 'plain', text: '(' },
      { type: 'string', text: "'a b'" },
      { type: 'plain', text: '); ' },
      { type: 'comment', text: '// two' },
    ]);
  });

  test('handles escapes, template strings and block comments', () => {
    const code = 'let s = "say \\"hi\\""; /* note */ `x ${1}`';
    const tokens = highlight(code, 'javascript');
    assert.equal(join(tokens), code);
    assert.deepEqual(typed(tokens, 'string'), ['"say \\"hi\\""', '`x ${1}`']);
    assert.deepEqual(typed(tokens, 'comment'), ['/* note */']);
  });

  test('recognises number forms', () => {
    const tokens = highlight('0xff 0b101 1_000 3.14 2e10 10n', 'ts');
    assert.deepEqual(typed(tokens, 'number'), ['0xff', '0b101', '1_000', '3.14', '2e10', '10n']);
  });

  test('does not split words that contain keywords', () => {
    const tokens = highlight('constant iffy', 'js');
    assert.deepEqual(tokens, [{ type: 'plain', text: 'constant iffy' }]);
  });

  test('highlights Python, shell, CSS and JSON', () => {
    assert.deepEqual(typed(highlight('def add(a, b):\n    return a + b  # sum', 'python'), 'keyword'), ['def', 'return']);
    assert.deepEqual(typed(highlight('def add(a, b):\n    return a + b  # sum', 'py'), 'comment'), ['# sum']);
    assert.deepEqual(typed(highlight('"""doc"""', 'py'), 'string'), ['"""doc"""']);
    assert.deepEqual(typed(highlight('if [ -f "$f" ]; then echo ok; fi # check', 'bash'), 'keyword'), ['if', 'then', 'fi']);
    assert.deepEqual(typed(highlight('echo a#b', 'sh'), 'comment'), []);
    assert.deepEqual(typed(highlight('a { color: #60a5fa; width: 50%; } /* c */', 'css'), 'number'), ['#60a5fa', '50%']);
    assert.deepEqual(typed(highlight('@media print { }', 'css'), 'keyword'), ['@media']);
    assert.deepEqual(typed(highlight('{"a": true, "b": null, "c": 1}', 'json'), 'keyword'), ['true', 'null']);
  });

  test('accepts the language name in any case', () => {
    assert.deepEqual(highlight('return', 'JS'), [{ type: 'keyword', text: 'return' }]);
  });

  test('leaves unknown languages and empty code alone', () => {
    assert.deepEqual(highlight('<b>hi</b>', 'html'), [{ type: 'plain', text: '<b>hi</b>' }]);
    assert.deepEqual(highlight('x', ''), [{ type: 'plain', text: 'x' }]);
    assert.deepEqual(highlight('', 'js'), []);
  });

  test('unterminated strings and comments run to the end without losing text', () => {
    for (const [code, lang] of [['"open', 'js'], ['/* open', 'c'], ["'''open", 'python'], ['`open', 'ts']]) {
      assert.equal(join(highlight(code, lang)), code);
    }
  });

  test('joining the tokens always gives back the code', () => {
    const rng = createRng(11);
    const pieces = ['const', ' ', 'x', '(', ')', '"', "'", '`', '\\', '/', '*', '#', '\n', '1', '.', 'e', '$', '@', '-', '%'];
    const languages = ['js', 'json', 'c', 'python', 'sh', 'css', 'none'];
    for (let i = 0; i < 400; i += 1) {
      const code = Array.from({ length: Math.floor(rng() * 30) }, () => pieces[Math.floor(rng() * pieces.length)]).join('');
      const lang = languages[i % languages.length];
      const tokens = highlight(code, lang);
      assert.equal(join(tokens), code, JSON.stringify({ code, lang }));
      for (let j = 1; j < tokens.length; j += 1) assert.notEqual(tokens[j].type, tokens[j - 1].type);
      for (const token of tokens) assert.notEqual(token.text, '');
    }
  });
});

describe('isHighlighted', () => {
  test('knows the supported languages', () => {
    for (const lang of ['js', 'TypeScript', 'json', 'c++', 'c#', 'go', 'rust', 'py', 'bash', 'css']) assert.ok(isHighlighted(lang), lang);
    for (const lang of ['', 'html', 'markdown', undefined]) assert.ok(!isHighlighted(lang), String(lang));
  });
});
