/**
 * The document workspace: a list of Markdown documents with one active
 * document, autosaved through the storage helper. Pure logic; the UI calls
 * these methods and renders getState().
 */
import { lineIndexAt } from './editor-ops.js';
import { createRng } from './rng.js';
import { DEMO_ANCHOR, SAMPLE_MARKDOWN, SAMPLE_TITLE } from './sample.js';
import { createMemoryBackend, createStorage } from './storage.js';

/** localStorage key of the saved workspace. */
export const STORAGE_KEY = 'markdown-editor:v1';

/** Largest importable document, in characters. */
export const MAX_IMPORT_LENGTH = 500000;

const MAX_TITLE_LENGTH = 120;
const RE_MARKDOWN_EXTENSION = /\.(?:md|markdown|mdown|mkd|txt)$/i;
const DEMO_SEED = 20261027;
const DEMO_TIME = Date.UTC(2026, 0, 15, 9, 30);
const HOUR = 3600000;

/**
 * @typedef {object} MarkdownDocument
 * @property {string} id
 * @property {string} title - empty string means "untitled"
 * @property {string} content
 * @property {number} createdAt - ms since epoch
 * @property {number} updatedAt - ms since epoch
 */

/**
 * @typedef {object} WorkspaceState
 * @property {Array<Omit<MarkdownDocument, 'content'>>} docs - most recently updated first
 * @property {string} activeId
 * @property {'saved'|'pending'|'error'} saveStatus
 * @property {boolean} firstVisit - true when nothing was saved before (the sample was created)
 */

/**
 * Creates a workspace and loads the saved documents. On the first visit (or
 * when the saved data is unusable) it starts with the sample document.
 * @param {object} [options]
 * @param {import('./storage.js').SafeStorage} [options.storage] - defaults to localStorage
 * @param {() => number} [options.rng] - random source for document ids
 * @param {() => number} [options.now] - clock in ms
 * @param {string} [options.sample] - Markdown of the first-visit document
 * @param {string} [options.sampleTitle]
 */
export function createWorkspace(options = {}) {
  const storage = options.storage ?? createStorage();
  const now = options.now ?? Date.now;
  const rng = options.rng ?? createRng(now());
  const sample = { title: options.sampleTitle ?? SAMPLE_TITLE, content: options.sample ?? SAMPLE_MARKDOWN };

  const loaded = loadData(storage.getJSON(STORAGE_KEY));
  const firstVisit = loaded === null;
  let docs = loaded ? loaded.docs : [];
  let activeId = loaded ? loaded.activeId : '';
  let saveStatus = 'saved';

  const find = (id) => docs.find((doc) => doc.id === id);
  const active = () => find(activeId);

  const makeDoc = (title, content) => {
    let id = '';
    do {
      id = `doc-${Math.floor(rng() * 36 ** 8).toString(36).padStart(8, '0')}`;
    } while (find(id));
    const time = now();
    return { id, title: cleanTitle(title), content: String(content), createdAt: time, updatedAt: time };
  };

  const workspace = {
    /** @returns {WorkspaceState} */
    getState() {
      return {
        docs: sortByRecent(docs).map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt })),
        activeId,
        saveStatus,
        firstVisit,
      };
    },

    /** @returns {MarkdownDocument} a copy of the active document */
    getActive() {
      return { ...active() };
    },

    /**
     * Updates the active document's text. Saving is left to the caller
     * (debounced autosave), so the status becomes "pending".
     * @param {string} content
     * @returns {boolean} false when the text did not change
     */
    setContent(content) {
      const doc = active();
      const text = String(content);
      if (doc.content === text) return false;
      doc.content = text;
      doc.updatedAt = now();
      saveStatus = 'pending';
      return true;
    },

    /**
     * Writes the workspace to storage.
     * @returns {boolean} false when storage is unavailable or full
     */
    save() {
      const ok = storage.setJSON(STORAGE_KEY, { v: 1, activeId, docs });
      saveStatus = ok ? 'saved' : 'error';
      return ok;
    },

    /**
     * Adds a document, makes it active and saves.
     * @param {string} [title='']
     * @param {string} [content='']
     * @returns {MarkdownDocument}
     */
    createDocument(title = '', content = '') {
      const doc = makeDoc(title, content);
      docs.push(doc);
      activeId = doc.id;
      workspace.save();
      return { ...doc };
    },

    /**
     * @param {string} id
     * @param {string} title - whitespace is collapsed, length limited
     * @returns {boolean} false for an unknown id
     */
    renameDocument(id, title) {
      const doc = find(id);
      if (!doc) return false;
      doc.title = cleanTitle(title);
      doc.updatedAt = now();
      workspace.save();
      return true;
    },

    /**
     * Deletes a document. Deleting the last one leaves a new empty document,
     * so there is always an active document.
     * @param {string} id
     * @returns {boolean} false for an unknown id
     */
    deleteDocument(id) {
      if (!find(id)) return false;
      docs = docs.filter((doc) => doc.id !== id);
      if (docs.length === 0) docs.push(makeDoc('', ''));
      if (activeId === id) activeId = sortByRecent(docs)[0].id;
      workspace.save();
      return true;
    },

    /**
     * @param {string} id
     * @returns {boolean} false for an unknown id
     */
    selectDocument(id) {
      if (!find(id)) return false;
      activeId = id;
      workspace.save();
      return true;
    },

    /**
     * Adds an imported file as a new active document. The title comes from
     * the file name; a byte order mark is dropped and line endings become \n.
     * @param {string} fileName
     * @param {string} text
     * @returns {{ok: true, doc: MarkdownDocument} | {ok: false, reason: 'too-large'}}
     */
    importDocument(fileName, text) {
      const content = String(text).replace(/^\u{FEFF}/u, '').replace(/\r\n?/g, '\n');
      if (content.length > MAX_IMPORT_LENGTH) return { ok: false, reason: 'too-large' };
      return { ok: true, doc: workspace.createDocument(titleFromFileName(fileName), content) };
    },

    /**
     * Replaces every document with a fresh copy of a sample document.
     * @param {{title: string, content: string}} [next] - e.g. the sample in the current interface language; defaults to the workspace's sample
     * @returns {MarkdownDocument}
     */
    reset(next = sample) {
      docs = [];
      return workspace.createDocument(next.title, next.content);
    },
  };

  if (docs.length === 0) {
    const doc = makeDoc(sample.title, sample.content);
    docs = [doc];
    activeId = doc.id;
    workspace.save();
  }
  return workspace;
}

/**
 * Derives a document title from an imported file name.
 * @param {string} fileName
 * @returns {string}
 */
export function titleFromFileName(fileName) {
  return cleanTitle(String(fileName ?? '').replace(RE_MARKDOWN_EXTENSION, ''));
}

/**
 * Builds the deterministic ?demo state: an in-memory workspace (the visitor's
 * saved documents are not touched) with the English sample document open,
 * scrolled to its table and code block. Wide screens show the editor and the
 * preview side by side; on phones the Preview tab is open (`tab`), so the
 * rendered table and code are what the visitor sees.
 * @returns {{workspace: ReturnType<typeof createWorkspace>, tab: 'preview', lang: 'en', scrollLine: number}}
 */
export function createDemoState() {
  const storage = createStorage(createMemoryBackend());
  storage.setJSON(STORAGE_KEY, demoData());
  const workspace = createWorkspace({ storage, rng: createRng(DEMO_SEED), now: () => DEMO_TIME });
  return { workspace, tab: 'preview', lang: 'en', scrollLine: lineIndexAt(SAMPLE_MARKDOWN, SAMPLE_MARKDOWN.indexOf(DEMO_ANCHOR)) };
}

function demoData() {
  const doc = (id, title, content, age) => ({ id, title, content, createdAt: DEMO_TIME - age, updatedAt: DEMO_TIME - age });
  return {
    v: 1,
    activeId: 'doc-welcome',
    docs: [
      doc('doc-welcome', SAMPLE_TITLE, SAMPLE_MARKDOWN, 0),
      doc('doc-release', 'Release checklist', '# Release checklist\n\n- [x] Run the tests\n- [x] Update the screenshot\n- [ ] Tag the release\n', 3 * HOUR),
      doc('doc-reading', 'Reading notes', '# Reading notes\n\nShort notes on what I read this week.\n\n- Write first, format later\n- Short paragraphs are easier to scan\n', 30 * HOUR),
    ],
  };
}

function cleanTitle(title) {
  const text = String(title ?? '').replace(/\s+/g, ' ').trim();
  return Array.from(text).slice(0, MAX_TITLE_LENGTH).join('').trim();
}

function sortByRecent(docs) {
  return [...docs].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
}

function isValidDoc(doc) {
  return Boolean(doc) && typeof doc === 'object'
    && typeof doc.id === 'string' && doc.id !== ''
    && typeof doc.title === 'string' && typeof doc.content === 'string'
    && Number.isFinite(doc.createdAt) && Number.isFinite(doc.updatedAt);
}

/** Validates saved data; returns null when nothing usable was saved. */
function loadData(data) {
  if (!data || typeof data !== 'object' || data.v !== 1 || !Array.isArray(data.docs)) return null;
  const seen = new Set();
  const docs = [];
  for (const doc of data.docs) {
    if (!isValidDoc(doc) || seen.has(doc.id)) continue;
    seen.add(doc.id);
    const { id, title, content, createdAt, updatedAt } = doc;
    docs.push({ id, title, content, createdAt, updatedAt });
  }
  if (docs.length === 0) return null;
  const activeId = seen.has(data.activeId) ? data.activeId : sortByRecent(docs)[0].id;
  return { docs, activeId };
}
