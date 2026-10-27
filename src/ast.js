/**
 * Small helpers for reading the Markdown AST produced by parser.js.
 *
 * Block nodes: document, paragraph, heading, thematicBreak, codeBlock,
 * blockquote, list, listItem, table, tableRow, tableCell.
 * Inline nodes: text, softbreak, break, emphasis, strong, delete, inlineCode,
 * link, image.
 */

/**
 * Returns the plain text of a list of inline nodes (line breaks become spaces,
 * images contribute their alt text).
 * @param {Array<object>} nodes
 * @returns {string}
 */
export function inlineText(nodes) {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'inlineCode') out += node.value;
    else if (node.type === 'softbreak' || node.type === 'break') out += ' ';
    else if (node.type === 'image') out += node.alt;
    else if (node.children) out += inlineText(node.children);
  }
  return out;
}

/**
 * Returns the readable text of a document, one block per line. Code blocks
 * are included, thematic breaks and markup are not.
 * @param {object} node - usually the document node
 * @returns {string}
 */
export function toPlainText(node) {
  const parts = [];
  collectText(node, parts);
  return parts.join('\n');
}

function collectText(node, parts) {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
    case 'tableCell':
      parts.push(inlineText(node.children));
      return;
    case 'codeBlock':
      parts.push(node.value.replace(/\n$/, ''));
      return;
    default:
      for (const child of node.children ?? []) collectText(child, parts);
  }
}
