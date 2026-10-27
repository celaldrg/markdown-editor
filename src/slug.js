/**
 * Heading slugs (GitHub style) for ids and the table of contents.
 */

/**
 * Turns heading text into a slug: lower case, punctuation removed, spaces as
 * hyphens. Letters of any script (e.g. Turkish ç, ğ, ı, ö, ş, ü) are kept.
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/\u0307/g, '') // dot left over from lower-casing "İ"
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Creates a slug generator that never returns the same slug twice: repeats
 * get `-1`, `-2`, ... suffixes. Empty slugs become "section".
 * @returns {(text: string) => string}
 */
export function createSlugger() {
  const used = new Set();
  const nextSuffix = new Map();
  return (text) => {
    const base = slugify(text) || 'section';
    let n = nextSuffix.get(base) ?? 0;
    let slug = n === 0 ? base : `${base}-${n}`;
    while (used.has(slug)) {
      n += 1;
      slug = `${base}-${n}`;
    }
    used.add(slug);
    nextSuffix.set(base, n + 1);
    return slug;
  };
}
