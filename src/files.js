/**
 * Browser file helpers: offering a download and copying text to the
 * clipboard. They receive the window, so nothing here runs at import time.
 */

const REVOKE_DELAY = 2000;

/**
 * Offers text as a file download through a temporary object URL.
 * @param {Window} win
 * @param {string} fileName
 * @param {string} text
 * @param {string} type - MIME type, e.g. "text/markdown;charset=utf-8"
 */
export function downloadText(win, fileName, text, type) {
  const doc = win.document;
  const url = win.URL.createObjectURL(new win.Blob([text], { type }));
  const link = doc.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  doc.body.append(link);
  link.click();
  link.remove();
  win.setTimeout(() => win.URL.revokeObjectURL(url), REVOKE_DELAY);
}

/**
 * Copies text to the clipboard with the async Clipboard API, falling back to
 * a hidden textarea and execCommand('copy') where that API is missing or
 * refused.
 * @param {Window} win
 * @param {string} text
 * @returns {Promise<boolean>} whether the text was copied
 */
export async function copyText(win, text) {
  const { clipboard } = win.navigator;
  if (clipboard && win.isSecureContext) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Permission refused: try the fallback below.
    }
  }
  return copyWithSelection(win.document, text);
}

function copyWithSelection(doc, text) {
  const previous = doc.activeElement;
  const area = doc.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.className = 'visually-hidden';
  doc.body.append(area);
  area.select();
  let copied = false;
  try {
    copied = doc.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  previous?.focus?.({ preventScroll: true });
  return copied;
}
