/**
 * HTML character reference decoding used by the Markdown parser.
 *
 * Numeric references are always decoded. Named references are decoded from a
 * curated table (ASCII punctuation, typography, arrows, maths, Latin and
 * Turkish letters). Unknown names are left untouched, so the renderer escapes
 * them and they show up literally.
 */

const NAMED = {
  // ASCII and control characters (also used to obfuscate URLs).
  Tab: '\t', NewLine: '\n', excl: '!', quot: '"', QUOT: '"', num: '#', dollar: '$',
  percnt: '%', amp: '&', AMP: '&', apos: "'", lpar: '(', rpar: ')', ast: '*',
  midast: '*', plus: '+', comma: ',', period: '.', sol: '/', colon: ':', semi: ';',
  lt: '<', LT: '<', equals: '=', gt: '>', GT: '>', quest: '?', commat: '@',
  lsqb: '[', lbrack: '[', bsol: '\\', rsqb: ']', rbrack: ']', Hat: '^', lowbar: '_',
  UnderBar: '_', grave: '`', DiacriticalGrave: '`', lcub: '{', lbrace: '{',
  verbar: '|', vert: '|', VerticalLine: '|', rcub: '}', rbrace: '}',
  // Spaces and typography.
  nbsp: '\u00a0', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', shy: '\u00ad',
  zwj: '\u200d', zwnj: '\u200c', copy: '©', COPY: '©', reg: '®',
  REG: '®', trade: '™', TRADE: '™', hellip: '…', mldr: '…',
  mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', sbquo: '‚',
  ldquo: '“', rdquo: '”', bdquo: '„', laquo: '«', raquo: '»',
  lsaquo: '‹', rsaquo: '›', bull: '•', bullet: '•',
  middot: '·', centerdot: '·', dagger: '†', Dagger: '‡',
  permil: '‰', prime: '′', Prime: '″', sect: '§', para: '¶',
  iexcl: '¡', iquest: '¿', ordf: 'ª', ordm: 'º', loz: '◊',
  check: '✓', checkmark: '✓', cross: '✗', star: '☆', starf: '★',
  spades: '♠', clubs: '♣', hearts: '♥', diams: '♦',
  // Currency.
  cent: '¢', pound: '£', yen: '¥', euro: '€', curren: '¤',
  // Maths and arrows.
  deg: '°', plusmn: '±', pm: '±', times: '×', divide: '÷',
  div: '÷', minus: '−', micro: 'µ', not: '¬', infin: '∞',
  ne: '≠', le: '≤', ge: '≥', asymp: '≈', equiv: '≡',
  sum: '∑', prod: '∏', radic: '√', part: '∂', frac12: '½',
  half: '½', frac14: '¼', frac34: '¾', sup1: '¹', sup2: '²',
  sup3: '³', larr: '←', rarr: '→', uarr: '↑', darr: '↓',
  harr: '↔', lArr: '⇐', rArr: '⇒', uArr: '⇑', dArr: '⇓',
  hArr: '⇔', macr: '¯', acute: '´', cedil: '¸', uml: '¨',
  // Latin letters, including all Turkish ones.
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä',
  Aring: 'Å', AElig: 'Æ', Ccedil: 'Ç', Egrave: 'È', Eacute: 'É',
  Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î',
  Iuml: 'Ï', Ntilde: 'Ñ', Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô',
  Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø', Ugrave: 'Ù', Uacute: 'Ú',
  Ucirc: 'Û', Uuml: 'Ü', Yacute: 'Ý', szlig: 'ß', agrave: 'à',
  aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å',
  aelig: 'æ', ccedil: 'ç', egrave: 'è', eacute: 'é', ecirc: 'ê',
  euml: 'ë', igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï',
  ntilde: 'ñ', ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ',
  ouml: 'ö', oslash: 'ø', ugrave: 'ù', uacute: 'ú', ucirc: 'û',
  uuml: 'ü', yacute: 'ý', yuml: 'ÿ', Gbreve: 'Ğ', gbreve: 'ğ',
  Idot: 'İ', imath: 'ı', inodot: 'ı', Scedil: 'Ş', scedil: 'ş',
  // Greek letters.
  Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ',
  Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ',
  Omega: 'Ω', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
  epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π',
  rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', psi: 'ψ',
  omega: 'ω',
};

/** Source of a regular expression matching one character reference. */
export const ENTITY_SOURCE = '&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});';

const RE_ENTITIES = new RegExp(ENTITY_SOURCE, 'g');

/**
 * Decodes a single character reference such as `&amp;`, `&#35;` or `&#x22;`.
 * Invalid code points become U+FFFD.
 * @param {string} ref - the full reference including `&` and `;`
 * @returns {string|null} the decoded text, or null for an unknown name
 */
export function decodeEntity(ref) {
  const body = ref.slice(1, -1);
  if (body[0] !== '#') {
    return Object.prototype.hasOwnProperty.call(NAMED, body) ? NAMED[body] : null;
  }
  const hex = body[1] === 'x' || body[1] === 'X';
  const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
  const invalid = code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff);
  return String.fromCodePoint(invalid ? 0xfffd : code);
}

/**
 * Replaces every known character reference in a string.
 * @param {string} text
 * @returns {string}
 */
export function decodeEntities(text) {
  if (!text.includes('&')) return text;
  return text.replace(RE_ENTITIES, (ref) => decodeEntity(ref) ?? ref);
}
