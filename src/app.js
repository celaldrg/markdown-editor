/**
 * Starts the editor in the browser: loads the workspace, connects the views
 * and handles the header, document, file and language actions. Everything
 * browser specific arrives through the window passed to startApp(), so this
 * module can be imported anywhere without side effects.
 */
import { createDialogs } from './dialog.js';
import { mountIcons } from './dom.js';
import { toggleTaskAtLine } from './editor-ops.js';
import { createEditorView } from './editor-view.js';
import { exportHtmlDocument, toFileName } from './export.js';
import { copyText, downloadText } from './files.js';
import { formatDate, LANG_STORAGE_KEY, LANGS, normalizeLang, t } from './i18n.js';
import { createLayoutView } from './layout-view.js';
import { parse } from './parser.js';
import { createPreviewView } from './preview-view.js';
import { renderHtml } from './render.js';
import { SAMPLES } from './sample.js';
import { createScrollView } from './scroll-view.js';
import { createSidebarView } from './sidebar-view.js';
import { computeStats } from './stats.js';
import { createMemoryBackend, createStorage } from './storage.js';
import { buildToc } from './toc.js';
import { createDemoState, createWorkspace, MAX_IMPORT_LENGTH } from './workspace.js';

const SAVE_DELAY = 500;
const TOAST_TIME = 2600;
const LARGE_DOCUMENT = 50000;
const STATUS_KEYS = { saved: 'statusSaved', pending: 'statusSaving', error: 'statusError' };
const RE_IMPORTABLE = /\.(?:md|markdown|mdown|mkd|txt)$/i;
// UTF-8 needs at most three bytes per character of a JavaScript string, so a
// larger file cannot fit the import limit and is refused before reading it.
const MAX_IMPORT_BYTES = MAX_IMPORT_LENGTH * 3;

/**
 * Starts the app on the page loaded from index.html. With ?demo it opens a
 * fixed, in-memory example instead of the saved documents.
 * @param {Window} win
 */
export function startApp(win) {
  const doc = win.document;
  const byId = (id) => doc.getElementById(id);
  const { search } = win.location;
  const demo = new URLSearchParams(search).has('demo') ? createDemoState() : null;

  // The demo never reads or writes the visitor's saved data.
  const storage = demo ? createStorage(createMemoryBackend()) : createStorage();
  let lang = demo ? demo.lang : normalizeLang(storage.getText(LANG_STORAGE_KEY));
  // A first visit starts with the sample document in the interface language.
  const workspace = demo
    ? demo.workspace
    : createWorkspace({ storage, sample: SAMPLES[lang].content, sampleTitle: SAMPLES[lang].title });
  const timeZone = demo ? 'UTC' : undefined;
  const tr = (key, vars) => t(lang, key, vars);

  const editor = byId('editor');
  const preview = byId('preview');
  const saveStatus = byId('save-status');
  const saveText = byId('save-text');
  const docTitleText = byId('doc-title-text');
  const stats = byId('stats');
  const toastBox = byId('toast');
  const dropHint = byId('drop-hint');
  const importInput = byId('import-input');

  let saveTimer = 0;
  let renderTimer = 0;
  let toastTimer = 0;
  let storageWarned = false;
  let dragDepth = 0;

  const titleOf = (item) => item.title || tr('untitled');

  const toast = (message) => {
    toastBox.textContent = message;
    toastBox.classList.add('show');
    win.clearTimeout(toastTimer);
    toastTimer = win.setTimeout(() => toastBox.classList.remove('show'), TOAST_TIME);
  };

  const dialogs = createDialogs({
    dialog: byId('dialog'),
    form: byId('dialog-form'),
    message: byId('dialog-message'),
    input: byId('dialog-input'),
    ok: byId('dialog-ok'),
    cancel: byId('dialog-cancel'),
  });

  // ---------------------------------------------------------------------------
  // Rendering

  const showStatus = () => {
    const { saveStatus: state } = workspace.getState();
    const text = tr(STATUS_KEYS[state]);
    saveStatus.dataset.state = state;
    saveStatus.title = text;
    saveText.textContent = text;
  };

  const renderDocs = () => {
    const { docs, activeId } = workspace.getState();
    sidebarView.renderDocs(docs, activeId, {
      untitled: tr('untitled'),
      rename: (title) => tr('renameDoc', { title }),
      remove: (title) => tr('deleteDoc', { title }),
      date: (ms) => formatDate(lang, ms, timeZone),
    });
    const title = titleOf(workspace.getActive());
    docTitleText.textContent = title;
    doc.title = `${title} · ${tr('appTitle')}`;
  };

  const renderNow = () => {
    win.clearTimeout(renderTimer);
    const ast = parse(editor.value);
    previewView.render(ast, tr('previewEmpty'));
    sidebarView.renderToc(buildToc(ast).filter((entry) => entry.text !== ''));
    const { words, characters, readingMinutes } = computeStats(ast);
    stats.textContent = [
      tr('statsWords', { count: words }),
      tr('statsChars', { count: characters }),
      tr('statsReading', { count: readingMinutes }),
    ].join(' · ');
    scrollView.invalidate();
  };

  const scheduleRender = () => {
    win.clearTimeout(renderTimer);
    renderTimer = win.setTimeout(renderNow, editor.value.length > LARGE_DOCUMENT ? 250 : 40);
  };

  const applyLang = (next) => {
    lang = normalizeLang(next);
    doc.documentElement.lang = lang;
    for (const el of doc.querySelectorAll('[data-i18n]')) el.textContent = tr(el.dataset.i18n);
    for (const el of doc.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', tr(el.dataset.i18nLabel));
    for (const el of doc.querySelectorAll('[data-i18n-title]')) el.title = tr(el.dataset.i18nTitle);
    for (const el of doc.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = tr(el.dataset.i18nPlaceholder);
  };

  // ---------------------------------------------------------------------------
  // Saving

  const flushSave = () => {
    win.clearTimeout(saveTimer);
    if (workspace.getState().saveStatus === 'saved') return;
    const saved = workspace.save();
    showStatus();
    renderDocs();
    if (!saved && !storageWarned) {
      storageWarned = true;
      toast(tr('statusError'));
    }
  };

  const onEditorChange = (text) => {
    if (workspace.setContent(text)) {
      showStatus();
      win.clearTimeout(saveTimer);
      saveTimer = win.setTimeout(flushSave, SAVE_DELAY);
    }
    scheduleRender();
  };

  // ---------------------------------------------------------------------------
  // Views

  const editorView = createEditorView({
    doc,
    editor,
    toolbar: byId('toolbar'),
    onChange: onEditorChange,
    tableLabels: () => ({ header: tr('tableHeader'), cell: tr('tableCell') }),
  });

  const previewView = createPreviewView({
    doc,
    preview,
    onToggleTask: (line) => {
      editorView.replace(toggleTaskAtLine(editor.value, line));
      renderNow();
      previewView.focusTask(line);
    },
    onJump: (target) => scrollView.scrollToLine(Number(target.dataset.line)),
  });

  const scrollView = createScrollView({
    win,
    editor,
    preview,
    mirror: byId('mirror'),
    onTopLine: (line) => sidebarView.setTopLine(line),
  });

  const openActive = () => {
    editorView.load(workspace.getActive().content);
    preview.scrollTop = 0;
    renderNow();
    renderDocs();
    showStatus();
  };

  const renameDoc = async (id) => {
    const item = workspace.getState().docs.find((entry) => entry.id === id);
    if (!item) return;
    const title = await dialogs.prompt(tr('renamePrompt'), tr('rename'), item.title);
    if (title === null || !workspace.renameDocument(id, title)) return;
    renderDocs();
    showStatus();
  };

  const deleteDoc = async (id) => {
    const item = workspace.getState().docs.find((entry) => entry.id === id);
    if (!item) return;
    const title = titleOf(item);
    if (!(await dialogs.confirm(tr('confirmDelete', { title }), tr('delete'), true))) return;
    const wasActive = id === workspace.getState().activeId;
    if (!workspace.deleteDocument(id)) return;
    if (wasActive) openActive();
    else {
      renderDocs();
      showStatus();
    }
    toast(tr('deleted', { title }));
  };

  const sidebarView = createSidebarView({
    doc,
    docList: byId('doc-list'),
    tocList: byId('toc-list'),
    tocEmpty: byId('toc-empty'),
    onDoc: (action, id) => {
      if (action === 'rename') renameDoc(id);
      else if (action === 'remove') deleteDoc(id);
      else {
        if (id !== workspace.getState().activeId && workspace.selectDocument(id)) openActive();
        layout.closeDrawer();
      }
    },
    onHeading: (line) => {
      layout.closeDrawer();
      scrollView.scrollToLine(line);
    },
  });

  const layout = createLayoutView({
    win,
    root: byId('app'),
    panes: byId('panes'),
    tabs: [byId('tab-edit'), byId('tab-preview')],
    splitter: byId('splitter'),
    menuButton: byId('menu-btn'),
    drawerClose: byId('drawer-close'),
    backdrop: byId('backdrop'),
    covered: [byId('topbar'), byId('workspace'), byId('footer')],
    storage,
    onTab: (tab) => {
      if (tab === layout.tab()) return;
      const line = scrollView.topLine();
      layout.setTab(tab);
      scrollView.scrollToLine(line);
    },
    onModeChange: (isPhone) => scrollView.setLinked(!isPhone),
  });

  // ---------------------------------------------------------------------------
  // Files

  const importFiles = async (files) => {
    for (const file of files) {
      if (!RE_IMPORTABLE.test(file.name) && !file.type.startsWith('text/')) {
        toast(tr('importFailed'));
        continue;
      }
      if (file.size > MAX_IMPORT_BYTES) {
        toast(tr('importTooLarge', { limit: MAX_IMPORT_LENGTH }));
        continue;
      }
      let text = '';
      try {
        text = await file.text();
      } catch {
        toast(tr('importFailed'));
        continue;
      }
      const result = workspace.importDocument(file.name, text);
      if (!result.ok) {
        toast(tr('importTooLarge', { limit: MAX_IMPORT_LENGTH }));
        continue;
      }
      openActive();
      toast(tr('imported', { title: titleOf(result.doc) }));
    }
  };

  const download = (extension, text, type) => {
    const name = toFileName(titleOf(workspace.getActive()), extension);
    downloadText(win, name, text, type);
    toast(tr('downloaded', { file: name }));
  };

  byId('import-btn').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', () => {
    const files = [...importInput.files];
    importInput.value = '';
    layout.closeDrawer();
    importFiles(files);
  });
  byId('export-md').addEventListener('click', () => download('md', editor.value, 'text/markdown;charset=utf-8'));
  byId('export-html').addEventListener('click', () => {
    const title = titleOf(workspace.getActive());
    download('html', exportHtmlDocument(editor.value, { title, lang }), 'text/html;charset=utf-8');
  });
  byId('copy-html').addEventListener('click', async () => {
    toast(tr((await copyText(win, renderHtml(parse(editor.value)))) ? 'copied' : 'copyFailed'));
  });

  // Dropping files anywhere on the page imports them instead of leaving the app.
  const carriesFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
  const hideDropHint = () => {
    dragDepth = 0;
    dropHint.hidden = true;
  };
  doc.addEventListener('dragenter', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    dropHint.hidden = false;
  });
  doc.addEventListener('dragleave', (event) => {
    if (!carriesFiles(event)) return;
    dragDepth -= 1;
    if (dragDepth <= 0) hideDropHint();
  });
  doc.addEventListener('dragover', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  doc.addEventListener('drop', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    hideDropHint();
    importFiles([...event.dataTransfer.files]);
  });
  doc.addEventListener('dragend', hideDropHint);

  // ---------------------------------------------------------------------------
  // Header, documents and keyboard

  byId('new-doc').addEventListener('click', () => {
    workspace.createDocument();
    openActive();
    layout.closeDrawer();
    if (layout.isPhone()) layout.setTab('edit');
    editorView.focus();
  });
  byId('doc-title').addEventListener('click', () => renameDoc(workspace.getState().activeId));
  byId('lang-btn').addEventListener('click', () => {
    applyLang(LANGS.find((code) => code !== lang));
    storage.setText(LANG_STORAGE_KEY, lang);
    renderNow();
    renderDocs();
    showStatus();
  });
  byId('reset-btn').addEventListener('click', async () => {
    if (!(await dialogs.confirm(tr('resetConfirm'), tr('reset'), true))) return;
    workspace.reset(SAMPLES[lang]);
    openActive();
  });

  doc.addEventListener('keydown', (event) => {
    const command = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
    if (command && String(event.key).toLowerCase() === 's') {
      event.preventDefault();
      flushSave();
    }
  });
  win.addEventListener('pagehide', flushSave);
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') flushSave();
  });

  // ---------------------------------------------------------------------------
  // Start

  mountIcons(doc.body);
  applyLang(lang);
  layout.setTab(demo ? demo.tab : 'edit');
  scrollView.setLinked(!layout.isPhone());
  openActive();

  if (demo) {
    // Scroll once styles and images are in, so the measurements are final.
    const showDemo = () => scrollView.scrollToLine(demo.scrollLine);
    if (doc.readyState === 'complete') showDemo();
    else win.addEventListener('load', showDemo, { once: true });
  }
}
