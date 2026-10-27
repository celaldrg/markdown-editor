import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS, applyAction, continueList, diffRange, indent, lineIndexAt, lineStartOffset, shortcutAction, toggleTaskAtLine,
} from '../src/editor-ops.js';
import { createRng } from '../src/rng.js';
import { parse } from '../src/parser.js';
import { renderHtml } from '../src/render.js';

const state = (text, start, end = start) => ({ text, start, end });
const run = (action, text, start, end, options) => applyAction(state(text, start, end), action, options);

/** Checks a list of [action, before state, expected state] rows. */
function table(rows) {
  for (const [name, action, before, expected] of rows) {
    test(name, () => assert.deepEqual(applyAction(before, action), expected));
  }
}

test('the toolbar actions', () => {
  assert.deepEqual(ACTIONS, ['bold', 'italic', 'heading', 'list', 'task', 'link', 'code', 'quote', 'table']);
  assert.ok(Object.isFrozen(ACTIONS));
  for (const action of ACTIONS) {
    const result = run(action, 'some text', 0, 4);
    assert.equal(typeof result.text, 'string', action);
    assert.ok(result.start <= result.end && result.end <= result.text.length, action);
  }
});

test('an unknown action returns an unchanged copy', () => {
  const before = state('a', 0);
  const after = applyAction(before, 'nope');
  assert.deepEqual(after, before);
  assert.notEqual(after, before);
});

describe('bold and italic', () => {
  table([
    ['wraps the selection', 'bold', state('hello world', 6, 11), state('hello **world**', 8, 13)],
    ['ignores whitespace at the selection edges', 'bold', state('hello world ', 6, 12), state('hello **world** ', 8, 13)],
    ['unwraps a selection inside markers', 'bold', state('hello **world**', 8, 13), state('hello world', 6, 11)],
    ['unwraps a selection including markers', 'bold', state('hello **world**', 6, 15), state('hello world', 6, 11)],
    ['inserts a marker pair at the caret', 'bold', state('ab', 1), state('a****b', 3)],
    ['italic uses underscores', 'italic', state('a b', 2, 3), state('a _b_', 3, 4)],
    ['italic unwraps', 'italic', state('a _b_', 3, 4), state('a b', 2, 3)],
  ]);

  test('wrapping and unwrapping round-trips', () => {
    const wrapped = run('bold', 'make this strong', 5, 9);
    assert.deepEqual(applyAction(wrapped, 'bold'), state('make this strong', 5, 9));
  });
});

describe('heading', () => {
  table([
    ['adds a level 1 heading', 'heading', state('Title', 2), state('# Title', 4)],
    ['level 1 becomes 2', 'heading', state('# Title', 4), state('## Title', 5)],
    ['level 2 becomes 3', 'heading', state('## Title', 5), state('### Title', 6)],
    ['level 3 removes the heading', 'heading', state('### Title', 6), state('Title', 2)],
    ['levels 4 to 6 remove the heading', 'heading', state('##### Title', 8), state('Title', 2)],
    ['works on the caret line only', 'heading', state('a\nTitle\nb', 3), state('a\n# Title\nb', 5)],
  ]);
});

describe('list and task', () => {
  table([
    ['prefixes every non-blank selected line', 'list', state('a\nb\n\nc', 0, 6), state('- a\n- b\n\n- c', 2, 12)],
    ['removes the prefix when every line has it', 'list', state('- a\n- b', 0, 7), state('a\nb', 0, 3)],
    ['turns an ordered list into bullets', 'list', state('1. a\n2. b', 0, 9), state('- a\n- b', 2, 7)],
    ['completes a partly bulleted selection', 'list', state('- a\nb', 0, 5), state('- a\n- b', 0, 7)],
    ['turns a task into a bullet', 'list', state('- [ ] a', 0, 7), state('- a', 2, 3)],
    ['starts a list on an empty line', 'list', state('', 0), state('- ', 2)],
    ['adds task boxes', 'task', state('a\n- b', 0, 5), state('- [ ] a\n- [ ] b', 6, 15)],
    ['removes task boxes', 'task', state('- [ ] a\n- [x] b', 0, 15), state('a\nb', 0, 3)],
    ['keeps the indentation', 'task', state('  - a', 4), state('  - [ ] a', 8)],
  ]);

  test('a selection ending at a line start leaves that line alone', () => {
    assert.deepEqual(run('list', 'a\nb\nc', 0, 4), state('- a\n- b\nc', 2, 8));
  });
});

describe('quote', () => {
  table([
    ['quotes every line, blank ones with a bare >', 'quote', state('a\n\nb', 0, 4), state('> a\n>\n> b', 2, 9)],
    ['unquotes when every line is quoted', 'quote', state('> a\n>\n> b', 0, 9), state('a\n\nb', 0, 4)],
  ]);
});

describe('code', () => {
  table([
    ['wraps a word in backticks', 'code', state('use npm now', 4, 7), state('use `npm` now', 5, 8)],
    ['unwraps inline code', 'code', state('use `npm` now', 5, 8), state('use npm now', 4, 7)],
    ['uses a longer fence around backticks', 'code', state('a `b` c', 2, 5), state('a `` `b` `` c', 5, 8)],
    ['inserts an empty code span at the caret', 'code', state('ab', 1), state('a``b', 2)],
    ['fences a multi-line selection', 'code', state('a\nb', 0, 3), state('```\na\nb\n```', 4, 7)],
    ['fences around existing fences', 'code', state('```\nx\n```', 0, 9), state('````\n```\nx\n```\n````', 5, 14)],
    ['opens a code block on a blank line', 'code', state('a\n\nb', 2), state('a\n```\n\n```\nb', 6)],
  ]);

  test('the produced Markdown renders as code', () => {
    assert.equal(renderHtml(parse(run('code', 'a `b` c', 2, 5).text)), '<p>a <code>`b`</code> c</p>\n');
    assert.equal(renderHtml(parse(run('code', '```\nx\n```', 0, 9).text)), '<pre><code>```\nx\n```\n</code></pre>\n');
  });
});

describe('link', () => {
  table([
    ['links the selected text and selects the URL', 'link', state('see docs', 4, 8), state('see [docs](https://)', 11, 19)],
    ['turns a selected URL into the target', 'link', state('see https://x.example', 4, 21), state('see [](https://x.example)', 5)],
    ['completes a www address', 'link', state('www.x.example', 0, 13), state('[](https://www.x.example)', 1)],
    ['inserts an empty link at the caret', 'link', state('ab', 1), state('a[](https://)b', 2)],
  ]);
});

describe('table', () => {
  const TABLE = '| Header | Header |\n| ------ | ------ |\n| Cell   | Cell   |\n| Cell   | Cell   |';
  table([
    ['goes below the caret line, after a blank line', 'table', state('x', 1), state(`x\n\n${TABLE}\n`, 5, 11)],
    ['fills an empty document', 'table', state('', 0), state(`${TABLE}\n`, 2, 8)],
    ['keeps a blank line before the next block', 'table', state('a\nb', 0), state(`a\n\n${TABLE}\n\nb`, 5, 11)],
    ['reuses an existing blank line', 'table', state('a\n\nb', 0), state(`a\n\n${TABLE}\n\nb`, 5, 11)],
    ['never starts indented', 'table', state('    ', 4), state(`${TABLE}\n`, 2, 8)],
  ]);

  test('uses translated labels and pads the columns', () => {
    const result = run('table', '', 0, 0, { labels: { header: 'Ba\u{15f}l\u{131}k', cell: 'H\u{fc}cre' } });
    assert.equal(result.text, '| Ba\u{15f}l\u{131}k | Ba\u{15f}l\u{131}k |\n| ------ | ------ |\n| H\u{fc}cre  | H\u{fc}cre  |\n| H\u{fc}cre  | H\u{fc}cre  |\n');
    assert.equal(result.text.slice(result.start, result.end), 'Ba\u{15f}l\u{131}k');
  });

  test('the template renders as a table', () => {
    const html = renderHtml(parse(run('table', 'Intro', 5).text));
    assert.match(html, /<table>\n<thead>\n<tr>\n<th>Header<\/th>\n<th>Header<\/th>/);
    assert.equal(html.match(/<td>Cell<\/td>/g).length, 4);
  });
});

describe('indent', () => {
  test('Tab inserts two spaces at the caret', () => {
    assert.deepEqual(indent(state('ab', 1)), state('a  b', 3));
    assert.deepEqual(indent(state('abc', 1, 2)), state('a  c', 3));
  });

  test('Tab indents every non-blank line of a multi-line selection', () => {
    assert.deepEqual(indent(state('a\n\nb', 0, 4)), state('  a\n\n  b', 2, 8));
  });

  test('Shift+Tab removes a tab or up to two spaces', () => {
    assert.deepEqual(indent(state('  a\n\tb\n   c\nd', 0, 13), true), state('a\nb\n c\nd', 0, 8));
    assert.deepEqual(indent(state('  a', 3), true), state('a', 1));
    assert.deepEqual(indent(state('a', 1), true), state('a', 1));
  });
});

describe('shortcutAction', () => {
  const cases = [
    [{ key: 'b', ctrlKey: true }, 'bold'],
    [{ key: 'B', metaKey: true }, 'bold'],
    [{ key: 'i', ctrlKey: true }, 'italic'],
    [{ key: '\u{131}', ctrlKey: true }, 'italic'],
    [{ key: 'k', ctrlKey: true }, 'link'],
    [{ key: 'b' }, null],
    [{ key: 'b', ctrlKey: true, shiftKey: true }, null],
    [{ key: 'b', ctrlKey: true, altKey: true }, null],
    [{ key: 'x', ctrlKey: true }, null],
  ];
  for (const [event, action] of cases) {
    test(JSON.stringify(event), () => assert.equal(shortcutAction(event), action));
  }
});

describe('toggleTaskAtLine', () => {
  test('flips the box of the task on that line', () => {
    assert.equal(toggleTaskAtLine('- [ ] a', 0), '- [x] a');
    assert.equal(toggleTaskAtLine('- [X] a', 0), '- [ ] a');
    assert.equal(toggleTaskAtLine('- [ ] a\n> 1. [x] b\nc', 1), '- [ ] a\n> 1. [ ] b\nc');
  });

  test('leaves other lines and missing lines alone', () => {
    assert.equal(toggleTaskAtLine('- [ ] a\nc', 1), '- [ ] a\nc');
    assert.equal(toggleTaskAtLine('- [ ] a', 5), '- [ ] a');
    assert.equal(toggleTaskAtLine('[ ] not a list item', 0), '[ ] not a list item');
  });

  test('the data-line of a rendered task item finds its source line', () => {
    const source = '# Tasks\n\n- [ ] one\n- [x] two\n  - [ ] nested\n\n> 3. [ ] quoted\n\n* [ ] star';
    const lines = [...renderHtml(parse(source), { sourceLines: true }).matchAll(/<li class="task-list-item" data-line="(\d+)">/g)]
      .map((m) => Number(m[1]));
    assert.equal(lines.length, 5);
    for (const line of lines) {
      const toggled = toggleTaskAtLine(source, line);
      assert.notEqual(toggled, source);
      assert.equal(toggleTaskAtLine(toggled, line), source);
    }
    const checked = (text) => [...renderHtml(parse(text)).matchAll(/<input type="checkbox"( checked)?/g)].map((m) => Boolean(m[1]));
    assert.deepEqual(checked(toggleTaskAtLine(source, lines[0])), [true, true, false, false, false]);
  });
});

describe('line helpers', () => {
  test('lineIndexAt', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 9].map((offset) => lineIndexAt('a\nb\nc', offset)), [0, 0, 1, 1, 2, 2]);
  });

  test('lineStartOffset', () => {
    assert.deepEqual([0, 1, 2, 3].map((line) => lineStartOffset('a\nb\nc', line)), [0, 2, 4, 5]);
  });
});

describe('continueList (Enter)', () => {
  const caretAtEnd = (text) => state(text, text.length);
  const rows = [
    ['continues a bullet', caretAtEnd('- item'), state('- item\n- ', 9)],
    ['keeps the bullet character and spacing', caretAtEnd('*   wide'), state('*   wide\n*   ', 13)],
    ['counts an ordered list up', caretAtEnd('1. one'), state('1. one\n2. ', 10)],
    ['keeps the ordered delimiter', caretAtEnd('9) nine'), state('9) nine\n10) ', 12)],
    ['adds an unchecked box after a task', caretAtEnd('- [x] done'), state('- [x] done\n- [ ] ', 17)],
    ['continues a quote', caretAtEnd('> quoted'), state('> quoted\n> ', 11)],
    ['continues a list inside a quote', caretAtEnd('> - nested'), state('> - nested\n> - ', 15)],
    ['keeps the indentation of a nested item', caretAtEnd('  - deeper'), state('  - deeper\n  - ', 15)],
    ['splits an item at the caret', state('- ab', 3), state('- a\n- b', 6)],
    ['ends the list on an empty item', caretAtEnd('- a\n- '), state('- a\n', 4)],
    ['ends the list on an empty task', caretAtEnd('- [ ] '), state('', 0)],
    ['ends the quote on an empty quote line', caretAtEnd('> a\n> '), state('> a\n', 4)],
    ['keeps the quote when an item inside it is empty', caretAtEnd('> - a\n> - '), state('> - a\n> ', 8)],
    ['continues after a closed code fence', caretAtEnd('```\ncode\n```\n- item'), state('```\ncode\n```\n- item\n- ', 22)],
  ];
  for (const [name, before, expected] of rows) {
    test(name, () => assert.deepEqual(continueList(before), expected));
  }

  const plain = [
    ['a selection', state('- item', 2, 4)],
    ['the caret inside the marker', state('- item', 1)],
    ['a paragraph', caretAtEnd('just text')],
    ['a thematic break', caretAtEnd('- - -')],
    ['a dash without a space', caretAtEnd('-')],
    ['a line inside a code fence', caretAtEnd('```\n- item')],
    ['a line inside a tilde fence', caretAtEnd('~~~~\n> quote')],
  ];
  for (const [name, before] of plain) {
    test(`leaves ${name} to the browser`, () => assert.equal(continueList(before), null));
  }
});

describe('diffRange', () => {
  const apply = (before, { from, to, insert }) => before.slice(0, from) + insert + before.slice(to);
  const rows = [
    ['no change', 'abc', 'abc', { from: 3, to: 3, insert: '' }],
    ['an insertion', 'abc', 'abXc', { from: 2, to: 2, insert: 'X' }],
    ['a deletion', 'abXc', 'abc', { from: 2, to: 3, insert: '' }],
    ['a replacement', 'hello world', 'hello there', { from: 6, to: 11, insert: 'there' }],
    ['a repeated character', 'aaa', 'aaaa', { from: 3, to: 3, insert: 'a' }],
    ['from empty', '', 'new', { from: 0, to: 0, insert: 'new' }],
    ['to empty', 'old', '', { from: 0, to: 3, insert: '' }],
    ['a changed emoji keeps its high surrogate', 'x\u{1F600}y', 'x\u{1F603}y', { from: 1, to: 3, insert: '\u{1F603}' }],
    ['a changed high surrogate keeps its low surrogate', '\u{D83D}\u{DE00}', '\u{D83C}\u{DE00}', { from: 0, to: 2, insert: '\u{D83C}\u{DE00}' }],
  ];
  for (const [name, before, after, expected] of rows) {
    test(name, () => {
      const range = diffRange(before, after);
      assert.deepEqual(range, expected);
      assert.equal(apply(before, range), after);
    });
  }

  test('always rebuilds the new text and never splits a surrogate pair', () => {
    const rng = createRng(7);
    const alphabet = ['a', 'b', '\n', ' ', '\u{1F600}', '\u{1F603}', '\u{E9}'];
    const word = () => Array.from({ length: Math.floor(rng() * 8) }, () => alphabet[Math.floor(rng() * alphabet.length)]).join('');
    // With the u flag a valid pair is one code point, so this only finds lone halves.
    const lone = /[\u{D800}-\u{DFFF}]/u;
    for (let i = 0; i < 500; i += 1) {
      const before = word() + word();
      const chars = Array.from(before);
      const after = chars.slice(0, Math.floor(rng() * chars.length)).join('') + word();
      const range = diffRange(before, after);
      assert.equal(apply(before, range), after);
      assert.doesNotMatch(range.insert, lone, JSON.stringify({ before, after }));
      assert.ok(range.from <= range.to && range.to <= before.length);
    }
  });
});
