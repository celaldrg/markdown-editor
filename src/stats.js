/**
 * Document statistics: words, characters and reading time of the rendered
 * text (Markdown syntax is not counted).
 */
import { toPlainText } from './ast.js';

/** Reading speed used for the reading time estimate. */
export const WORDS_PER_MINUTE = 200;

// A word is a run of letters, digits and marks; an apostrophe, hyphen or dot
// between two such runs keeps them together ("don't", "e-mail", "3.14").
const RE_WORD = /[\p{L}\p{N}\p{M}]+(?:['\u{2019}.-][\p{L}\p{N}\p{M}]+)*/gu;

/**
 * Counts the words and characters of a parsed document and estimates the
 * reading time.
 * @param {object} doc - document node from parse()
 * @returns {{words: number, characters: number, readingMinutes: number}}
 */
export function computeStats(doc) {
  const text = toPlainText(doc);
  const words = (text.match(RE_WORD) ?? []).length;
  const characters = Array.from(text.replace(/\n/g, '')).length;
  const readingMinutes = words === 0 ? 0 : Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
  return { words, characters, readingMinutes };
}
