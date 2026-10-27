/**
 * A small syntax highlighter for fenced code blocks in the preview. It only
 * splits code into typed tokens; the preview wraps them in spans through
 * textContent, so highlighting can never inject markup. Joining the token
 * texts always gives back the original code.
 */

/** @typedef {{type: 'plain'|'comment'|'string'|'number'|'keyword'|'function', text: string}} Token */

const words = (list) => new Set(list.split(' '));

// Capture groups: 1 comment, 2 string, 3 number, 4 word.
const SLASH_FAMILY = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:\\[\s\S]|[^\\'\n])*'?|"(?:\\[\s\S]|[^\\"\n])*"?|`(?:\\[\s\S]|[^\\`])*`?)|(\b(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)n?\b)|([A-Za-z_$][\w$]*)/g;
const PYTHON = /(#[^\n]*)|("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|'(?:\\[\s\S]|[^\\'\n])*'?|"(?:\\[\s\S]|[^\\"\n])*"?)|(\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?j?\b)|([A-Za-z_]\w*)/g;
const SHELL = /((?:^|[ \t])#[^\n]*)|('[^']*'?|"(?:\\[\s\S]|[^\\"])*"?)|(\b\d+\b)|([A-Za-z_][\w-]*)/gm;
const CSS = /(\/\*[\s\S]*?(?:\*\/|$))|('(?:\\[\s\S]|[^\\'\n])*'?|"(?:\\[\s\S]|[^\\"\n])*"?)|(#[\da-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:[a-z]+|%)?)|(@?[A-Za-z_-][\w-]*)/g;

const LANGUAGES = [
  {
    names: ['js', 'javascript', 'jsx', 'mjs', 'cjs', 'ts', 'typescript', 'tsx'],
    pattern: SLASH_FAMILY,
    keywords: words('as async await break case catch class const continue debugger default delete do else enum export extends false finally for from function if implements import in instanceof interface let new null of private protected public readonly return static super switch this throw true try type typeof undefined var void while with yield'),
  },
  {
    names: ['json', 'jsonc', 'json5'],
    pattern: SLASH_FAMILY,
    keywords: words('true false null'),
  },
  {
    names: ['c', 'h', 'cpp', 'c++', 'cs', 'c#', 'csharp', 'java', 'kotlin', 'kt', 'go', 'rust', 'rs', 'swift', 'php', 'dart', 'scala'],
    pattern: SLASH_FAMILY,
    keywords: words('abstract bool boolean break byte case catch char class const continue default defer do double else enum extends false final finally float fn for func if impl implements import in int interface let long loop match mod mut namespace new nil null package private protected pub public return self static string struct super switch this throw throws true try type typedef union unsigned use using var void volatile where while'),
  },
  {
    names: ['py', 'python'],
    pattern: PYTHON,
    keywords: words('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield'),
  },
  {
    names: ['sh', 'bash', 'shell', 'zsh', 'console'],
    pattern: SHELL,
    keywords: words('case do done elif else esac exit export fi for function if in local return then until while'),
  },
  {
    names: ['css', 'scss', 'less'],
    pattern: CSS,
    keywords: words('@container @font-face @import @keyframes @layer @media @supports important inherit initial none unset'),
  },
];

const BY_NAME = new Map(LANGUAGES.flatMap((language) => language.names.map((name) => [name, language])));
const CALL = /[ \t]*\(/y;

/**
 * Splits code into highlighted tokens. Unknown languages give one plain
 * token; empty code gives no tokens.
 * @param {string} code
 * @param {string} lang - fence language, e.g. "js" (case-insensitive)
 * @returns {Token[]}
 */
export function highlight(code, lang) {
  const text = String(code ?? '');
  const language = BY_NAME.get(String(lang ?? '').toLowerCase());
  if (text === '') return [];
  if (!language) return [{ type: 'plain', text }];
  const tokens = [];
  const push = (type, value) => {
    if (value === '') return;
    const last = tokens[tokens.length - 1];
    if (last && last.type === type) last.text += value;
    else tokens.push({ type, text: value });
  };
  let index = 0;
  for (const match of text.matchAll(language.pattern)) {
    push('plain', text.slice(index, match.index));
    push(tokenType(language, match, text), match[0]);
    index = match.index + match[0].length;
  }
  push('plain', text.slice(index));
  return tokens;
}

/**
 * Tells whether a fence language is highlighted.
 * @param {string} lang
 * @returns {boolean}
 */
export function isHighlighted(lang) {
  return BY_NAME.has(String(lang ?? '').toLowerCase());
}

function tokenType(language, match, text) {
  if (match[1] !== undefined) return 'comment';
  if (match[2] !== undefined) return 'string';
  if (match[3] !== undefined) return 'number';
  const word = match[4];
  if (language.keywords.has(word)) return 'keyword';
  CALL.lastIndex = match.index + word.length;
  return CALL.test(text) ? 'function' : 'plain';
}
