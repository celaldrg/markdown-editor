/**
 * Small DOM helpers for the UI modules. Elements are built with
 * createElement / createElementNS and filled through textContent only; no
 * module ever parses an HTML string.
 */
import { ICONS } from './icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Creates an element.
 * @param {Document} doc
 * @param {string} tag
 * @param {{className?: string, text?: string, attrs?: Record<string, string>}} [props]
 * @param {Array<Node|string>} [children] - strings become text nodes
 * @returns {HTMLElement}
 */
export function h(doc, tag, props = {}, children = []) {
  const el = doc.createElement(tag);
  if (props.className) el.className = props.className;
  if (props.text !== undefined) el.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) el.setAttribute(name, value);
  el.append(...children);
  return el;
}

/**
 * Creates a decorative SVG icon from ICONS (hidden from assistive technology).
 * @param {Document} doc
 * @param {string} name - key of ICONS
 * @returns {SVGSVGElement}
 */
export function icon(doc, name) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name] ?? '');
  svg.append(path);
  return svg;
}

/**
 * Puts the icon named by `data-icon` at the start of every such element
 * below root (once).
 * @param {ParentNode} root
 */
export function mountIcons(root) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    if (el.firstElementChild?.classList.contains('icon')) continue;
    el.prepend(icon(el.ownerDocument, el.dataset.icon));
  }
}
