import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, WORDS_PER_MINUTE } from '../src/stats.js';
import { parse } from '../src/parser.js';
import { SAMPLE_MARKDOWN } from '../src/sample.js';

const stats = (md) => computeStats(parse(md));

describe('computeStats', () => {
  test('an empty document has no words and no reading time', () => {
    assert.deepEqual(stats(''), { words: 0, characters: 0, readingMinutes: 0 });
    assert.deepEqual(stats('\n\n   \n'), { words: 0, characters: 0, readingMinutes: 0 });
  });

  test('counts the rendered text, not the Markdown syntax', () => {
    assert.deepEqual(stats('Hello world'), { words: 2, characters: 11, readingMinutes: 1 });
    assert.deepEqual(stats('**Hello** _world_'), stats('Hello world'));
    assert.deepEqual(stats('# Hello world'), stats('Hello world'));
    assert.deepEqual(stats('> - ~~Hello~~ `world`'), stats('Hello world'));
  });

  test('link URLs are not counted, image alt text is', () => {
    assert.deepEqual(stats('[link text](https://example.com/a/very/long/url "Title")'), { words: 2, characters: 9, readingMinutes: 1 });
    assert.deepEqual(stats('![a cat](cat.png)'), { words: 2, characters: 5, readingMinutes: 1 });
  });

  test('code blocks and table cells are counted', () => {
    assert.deepEqual(stats('```js\nconst x = 1;\n```'), { words: 3, characters: 12, readingMinutes: 1 });
    assert.deepEqual(stats('| a | b |\n|-|-|\n| c | d |'), { words: 4, characters: 4, readingMinutes: 1 });
  });

  test('line breaks between blocks are not characters, breaks inside a paragraph are', () => {
    assert.equal(stats('# A\n\nB').characters, 2);
    assert.equal(stats('A\nB').characters, 3);
    assert.equal(stats('A\\\nB').characters, 3);
  });

  test('apostrophes, hyphens and dots inside a word keep it together', () => {
    assert.equal(stats("don't e-mail 3.14 it\u{2019}s").words, 4);
    assert.equal(stats('end. Next - word').words, 3);
  });

  test('punctuation and symbols alone are not words', () => {
    assert.deepEqual(stats('\u{2014} \u{2026} !!! \u{1f600}'), { words: 0, characters: 9, readingMinutes: 0 });
  });

  test('letters of every script count, characters are code points', () => {
    assert.deepEqual(stats('\u{c7}al\u{131}\u{15f}kan \u{f6}\u{11f}renciler'), { words: 2, characters: 19, readingMinutes: 1 });
    assert.deepEqual(stats('\u{65e5}\u{672c}\u{8a9e} \u{30c6}\u{30ad}\u{30b9}\u{30c8}'), { words: 2, characters: 8, readingMinutes: 1 });
    assert.equal(stats('\u{1f600}\u{1f600}').characters, 2);
  });

  test('reading time rounds up at 200 words per minute', () => {
    assert.equal(WORDS_PER_MINUTE, 200);
    const minutes = (count) => stats('word '.repeat(count)).readingMinutes;
    assert.deepEqual([1, 200, 201, 400, 1000, 1001].map(minutes), [1, 1, 2, 2, 5, 6]);
  });

  test('the sample document', () => {
    const { words, characters, readingMinutes } = stats(SAMPLE_MARKDOWN);
    assert.ok(words > 150 && words < 600, `${words} words`);
    assert.ok(characters > words);
    assert.ok(characters < SAMPLE_MARKDOWN.length);
    assert.ok(readingMinutes >= 1 && readingMinutes <= 3);
  });
});
