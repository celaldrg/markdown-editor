/**
 * Table of contents from the headings of a parsed document.
 */
import { inlineText } from './ast.js';

const CONTAINERS = new Set(['blockquote', 'list', 'listItem']);

/**
 * @typedef {object} TocEntry
 * @property {number} level - heading level 1-6
 * @property {number} depth - indentation level, 0 for the highest level used
 * @property {string} text - plain heading text
 * @property {string} id - unique slug, the heading's element id
 * @property {number} line - 0-based source line of the heading
 */

/**
 * Lists every heading of a document in order, including headings inside
 * block quotes and list items.
 * @param {object} doc - document node from parse()
 * @returns {TocEntry[]}
 */
export function buildToc(doc) {
  const headings = [];
  collectHeadings(doc.children, headings);
  const top = Math.min(...headings.map((heading) => heading.level));
  return headings.map((heading) => ({
    level: heading.level,
    depth: heading.level - top,
    text: inlineText(heading.children).replace(/\s+/g, ' ').trim(),
    id: heading.id,
    line: heading.line,
  }));
}

function collectHeadings(nodes, out) {
  for (const node of nodes) {
    if (node.type === 'heading') out.push(node);
    else if (CONTAINERS.has(node.type)) collectHeadings(node.children, out);
  }
}
