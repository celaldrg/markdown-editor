import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDemoState, createWorkspace, MAX_IMPORT_LENGTH, STORAGE_KEY, titleFromFileName,
} from '../src/workspace.js';
import { createMemoryBackend, createStorage } from '../src/storage.js';
import { createRng } from '../src/rng.js';
import { DEMO_ANCHOR, SAMPLE_MARKDOWN, SAMPLE_TITLE, SAMPLES } from '../src/sample.js';

/** A workspace on in-memory storage with a seeded RNG and a manual clock. */
function setup({ backend = createMemoryBackend(), seed = 1, ...options } = {}) {
  const clock = { time: 1000 };
  const storage = createStorage(backend);
  const open = () => createWorkspace({ storage, rng: createRng(seed), now: () => clock.time, ...options });
  return { clock, storage, backend, open, workspace: open() };
}

const saved = (storage) => storage.getJSON(STORAGE_KEY);

describe('first visit', () => {
  test('starts with the sample document and saves it', () => {
    const { workspace, storage } = setup();
    const state = workspace.getState();
    assert.equal(state.firstVisit, true);
    assert.equal(state.saveStatus, 'saved');
    assert.equal(state.docs.length, 1);
    const active = workspace.getActive();
    assert.equal(active.id, state.activeId);
    assert.equal(active.title, SAMPLE_TITLE);
    assert.equal(active.content, SAMPLE_MARKDOWN);
    assert.match(active.id, /^doc-[0-9a-z]{8}$/);
    assert.deepEqual(saved(storage), { v: 1, activeId: active.id, docs: [active] });
  });

  test('the sample can be replaced', () => {
    const { workspace } = setup({ sample: '# Hi', sampleTitle: 'Hello' });
    assert.deepEqual([workspace.getActive().title, workspace.getActive().content], ['Hello', '# Hi']);
  });

  test('the next visit loads the saved documents', () => {
    const { workspace, open } = setup();
    workspace.createDocument('Second', 'text');
    const again = open();
    assert.equal(again.getState().firstVisit, false);
    assert.deepEqual(again.getState().docs, workspace.getState().docs);
    assert.deepEqual(again.getActive(), workspace.getActive());
  });
});

describe('editing and saving', () => {
  test('setContent marks the workspace as pending until save()', () => {
    const { workspace, storage, clock } = setup();
    clock.time = 2000;
    assert.equal(workspace.setContent('# New text'), true);
    assert.equal(workspace.getState().saveStatus, 'pending');
    assert.equal(workspace.getActive().updatedAt, 2000);
    assert.equal(saved(storage).docs[0].content, SAMPLE_MARKDOWN);
    assert.equal(workspace.save(), true);
    assert.equal(workspace.getState().saveStatus, 'saved');
    assert.equal(saved(storage).docs[0].content, '# New text');
  });

  test('setting the same text is not a change', () => {
    const { workspace } = setup();
    assert.equal(workspace.setContent(SAMPLE_MARKDOWN), false);
    assert.equal(workspace.getState().saveStatus, 'saved');
  });

  test('a failing storage reports an error but keeps working in memory', () => {
    const backend = createMemoryBackend();
    const { workspace } = setup({ backend });
    backend.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    workspace.setContent('kept in memory');
    assert.equal(workspace.save(), false);
    assert.equal(workspace.getState().saveStatus, 'error');
    assert.equal(workspace.getActive().content, 'kept in memory');
  });

  test('without storage the sample still opens', () => {
    const workspace = createWorkspace({ storage: createStorage(null), rng: createRng(1), now: () => 0 });
    assert.equal(workspace.getActive().content, SAMPLE_MARKDOWN);
    assert.equal(workspace.getState().firstVisit, true);
    assert.equal(workspace.getState().saveStatus, 'error');
  });

  test('getActive returns a copy', () => {
    const { workspace } = setup();
    workspace.getActive().content = 'changed outside';
    assert.equal(workspace.getActive().content, SAMPLE_MARKDOWN);
  });
});

describe('documents', () => {
  test('createDocument adds an active document and saves', () => {
    const { workspace, storage, clock } = setup();
    clock.time = 5000;
    const doc = workspace.createDocument('  My   notes ', 'body');
    assert.deepEqual(doc, { id: doc.id, title: 'My notes', content: 'body', createdAt: 5000, updatedAt: 5000 });
    assert.equal(workspace.getState().activeId, doc.id);
    assert.equal(saved(storage).activeId, doc.id);
    assert.equal(workspace.createDocument().title, '');
  });

  test('getState lists documents without content, most recent first', () => {
    const { workspace, clock } = setup();
    const first = workspace.getActive().id;
    clock.time = 2000;
    const second = workspace.createDocument('Second').id;
    clock.time = 3000;
    const third = workspace.createDocument('Third').id;
    assert.deepEqual(workspace.getState().docs.map((doc) => doc.id), [third, second, first]);
    assert.ok(workspace.getState().docs.every((doc) => !('content' in doc)));
    workspace.selectDocument(first);
    clock.time = 4000;
    workspace.setContent('edited');
    assert.deepEqual(workspace.getState().docs.map((doc) => doc.id), [first, third, second]);
  });

  test('ids are unique and reproducible with the same seed', () => {
    const a = setup({ seed: 42 }).workspace;
    const b = setup({ seed: 42 }).workspace;
    const ids = (workspace) => [workspace.getActive().id, ...Array.from({ length: 50 }, () => workspace.createDocument().id)];
    const idsA = ids(a);
    assert.deepEqual(idsA, ids(b));
    assert.equal(new Set(idsA).size, idsA.length);
    assert.notDeepEqual(idsA, ids(setup({ seed: 43 }).workspace));
  });

  test('an RNG that repeats itself still gives unique ids', () => {
    const values = [0.5, 0.5, 0.5, 0.25];
    const workspace = createWorkspace({ storage: createStorage(createMemoryBackend()), rng: () => values.shift() ?? 0.75, now: () => 0 });
    const ids = [workspace.getActive().id, workspace.createDocument().id, workspace.createDocument().id];
    assert.equal(new Set(ids).size, 3);
  });

  test('renameDocument cleans the title', () => {
    const { workspace, clock } = setup();
    const { id } = workspace.getActive();
    clock.time = 9000;
    assert.equal(workspace.renameDocument(id, '  Trip\n\tplans  '), true);
    assert.equal(workspace.getActive().title, 'Trip plans');
    assert.equal(workspace.getActive().updatedAt, 9000);
    workspace.renameDocument(id, '\u{1f680}'.repeat(200));
    assert.equal(workspace.getActive().title, '\u{1f680}'.repeat(120));
    assert.equal(workspace.renameDocument('doc-missing', 'x'), false);
  });

  test('selectDocument switches and remembers the active document', () => {
    const { workspace, storage } = setup();
    const first = workspace.getActive().id;
    workspace.createDocument('Second');
    assert.equal(workspace.selectDocument(first), true);
    assert.equal(workspace.getState().activeId, first);
    assert.equal(saved(storage).activeId, first);
    assert.equal(workspace.selectDocument('doc-missing'), false);
    assert.equal(workspace.getState().activeId, first);
  });

  test('deleting the active document opens the most recent other one', () => {
    const { workspace, clock } = setup();
    const first = workspace.getActive().id;
    clock.time = 2000;
    const second = workspace.createDocument('Second').id;
    clock.time = 3000;
    const third = workspace.createDocument('Third').id;
    workspace.selectDocument(second);
    assert.equal(workspace.deleteDocument(second), true);
    assert.equal(workspace.getState().activeId, third);
    assert.equal(workspace.deleteDocument(first), true);
    assert.equal(workspace.getState().activeId, third);
    assert.deepEqual(workspace.getState().docs.map((doc) => doc.id), [third]);
    assert.equal(workspace.deleteDocument('doc-missing'), false);
  });

  test('deleting the last document leaves an empty one', () => {
    const { workspace, storage } = setup();
    const only = workspace.getActive().id;
    workspace.deleteDocument(only);
    const active = workspace.getActive();
    assert.notEqual(active.id, only);
    assert.deepEqual([active.title, active.content], ['', '']);
    assert.equal(saved(storage).docs.length, 1);
  });

  test('reset replaces every document with a fresh sample', () => {
    const { workspace, storage } = setup();
    workspace.createDocument('A');
    workspace.createDocument('B');
    const doc = workspace.reset();
    assert.equal(workspace.getState().docs.length, 1);
    assert.deepEqual(workspace.getActive(), doc);
    assert.equal(doc.content, SAMPLE_MARKDOWN);
    assert.deepEqual(saved(storage).docs, [doc]);
  });

  test('reset can start from another sample, e.g. in the interface language', () => {
    const { workspace, storage } = setup();
    workspace.createDocument('A');
    const doc = workspace.reset(SAMPLES.tr);
    assert.deepEqual([doc.title, doc.content], [SAMPLES.tr.title, SAMPLES.tr.content]);
    assert.deepEqual(saved(storage).docs, [doc]);
    // Without an argument it goes back to the workspace's own sample.
    assert.equal(workspace.reset().content, SAMPLE_MARKDOWN);
  });
});

describe('importing files', () => {
  test('adds the file as a new active document', () => {
    const { workspace } = setup();
    const result = workspace.importDocument('meeting-notes.md', '\u{feff}# Notes\r\nline two\rline three');
    assert.equal(result.ok, true);
    assert.deepEqual(workspace.getActive(), result.doc);
    assert.equal(result.doc.title, 'meeting-notes');
    assert.equal(result.doc.content, '# Notes\nline two\nline three');
  });

  test('refuses files that are too large', () => {
    const { workspace } = setup();
    assert.deepEqual(workspace.importDocument('big.md', 'x'.repeat(MAX_IMPORT_LENGTH + 1)), { ok: false, reason: 'too-large' });
    assert.equal(workspace.getState().docs.length, 1);
    assert.equal(workspace.importDocument('limit.md', 'x'.repeat(MAX_IMPORT_LENGTH)).ok, true);
  });

  test('titleFromFileName drops Markdown and text extensions', () => {
    const cases = [
      ['notes.md', 'notes'], ['README.MARKDOWN', 'README'], ['a.mdown', 'a'], ['b.mkd', 'b'], ['c.txt', 'c'],
      ['archive.tar.gz', 'archive.tar.gz'], ['notes.md.md', 'notes.md'], ['  spaced   name .md', 'spaced name'],
      ['.md', ''], ['', ''], [undefined, ''],
    ];
    for (const [fileName, title] of cases) assert.equal(titleFromFileName(fileName), title, String(fileName));
  });
});

describe('loading saved data', () => {
  const load = (data) => {
    const backend = createMemoryBackend();
    backend.setItem(STORAGE_KEY, typeof data === 'string' ? data : JSON.stringify(data));
    return setup({ backend }).workspace;
  };
  const doc = (id, updatedAt, extra = {}) => ({ id, title: id, content: `# ${id}`, createdAt: 1, updatedAt, ...extra });

  test('unusable data starts over with the sample', () => {
    const unusable = ['not json', 'null', '[]', { v: 2, activeId: 'a', docs: [doc('a', 1)] }, { v: 1, docs: 'x' }, { v: 1, docs: [] }, { v: 1, docs: [{ id: 'a' }] }];
    for (const data of unusable) {
      const workspace = load(data);
      assert.equal(workspace.getState().firstVisit, true, JSON.stringify(data));
      assert.equal(workspace.getActive().content, SAMPLE_MARKDOWN);
    }
  });

  test('invalid documents and repeated ids are dropped', () => {
    const workspace = load({
      v: 1,
      activeId: 'b',
      docs: [doc('a', 1), doc('b', 2), doc('a', 3), doc('', 4), doc('c', Number.NaN), doc('d', 5, { title: 7 }), null, 'x', doc('e', 6, { extra: 'ignored' })],
    });
    assert.deepEqual(workspace.getState().docs.map((d) => d.id), ['e', 'b', 'a']);
    assert.equal(workspace.getState().activeId, 'b');
    assert.equal(workspace.getActive().content, '# b');
    assert.equal('extra' in workspace.getActive(), false);
  });

  test('an unknown active id falls back to the most recent document', () => {
    const workspace = load({ v: 1, activeId: 'gone', docs: [doc('a', 1), doc('b', 3), doc('c', 2)] });
    assert.equal(workspace.getState().activeId, 'b');
    assert.equal(workspace.getState().firstVisit, false);
  });
});

describe('createDemoState', () => {
  test('opens the sample (Preview tab on phones), scrolled to the table and code', () => {
    const demo = createDemoState();
    assert.equal(demo.tab, 'preview');
    assert.equal(demo.lang, 'en');
    assert.equal(SAMPLE_MARKDOWN.split('\n')[demo.scrollLine], DEMO_ANCHOR);
    const state = demo.workspace.getState();
    assert.equal(state.firstVisit, false);
    assert.equal(state.saveStatus, 'saved');
    assert.deepEqual(state.docs.map((d) => d.title), [SAMPLE_TITLE, 'Release checklist', 'Reading notes']);
    assert.equal(state.activeId, 'doc-welcome');
    assert.equal(demo.workspace.getActive().content, SAMPLE_MARKDOWN);
  });

  test('is deterministic', () => {
    const a = createDemoState();
    const b = createDemoState();
    assert.deepEqual(a.workspace.getState(), b.workspace.getState());
    assert.deepEqual(a.workspace.createDocument('x'), b.workspace.createDocument('x'));
  });

  test('never touches localStorage', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('the demo must not use localStorage');
      },
    });
    try {
      const { workspace } = createDemoState();
      workspace.setContent('changed in the demo');
      assert.equal(workspace.save(), true);
      workspace.createDocument('New');
      assert.equal(createDemoState().workspace.getActive().content, SAMPLE_MARKDOWN);
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete globalThis.localStorage;
    }
  });
});
