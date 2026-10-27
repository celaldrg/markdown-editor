import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryBackend, createStorage } from '../src/storage.js';

/** A backend whose every method throws, like localStorage in some private modes. */
const throwingBackend = () => ({
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
});

/** Runs fn with globalThis.localStorage replaced, restoring it afterwards. */
function withGlobalLocalStorage(descriptor, fn) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...descriptor });
  try {
    fn();
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
}

describe('createStorage with a working backend', () => {
  test('stores text and JSON', () => {
    const storage = createStorage(createMemoryBackend());
    assert.equal(storage.setText('a', 'hello'), true);
    assert.equal(storage.getText('a'), 'hello');
    assert.equal(storage.setJSON('b', { list: [1, 2], ok: true }), true);
    assert.deepEqual(storage.getJSON('b'), { list: [1, 2], ok: true });
  });

  test('missing keys and invalid JSON give the fallback', () => {
    const backend = createMemoryBackend();
    const storage = createStorage(backend);
    assert.equal(storage.getJSON('missing'), null);
    assert.deepEqual(storage.getJSON('missing', []), []);
    backend.setItem('broken', '{not json');
    assert.equal(storage.getJSON('broken', 'fallback'), 'fallback');
  });

  test('values that cannot be serialized are refused, not thrown', () => {
    const storage = createStorage(createMemoryBackend());
    const circular = {};
    circular.self = circular;
    assert.equal(storage.setJSON('c', circular), false);
    assert.equal(storage.setJSON('d', { big: 1n }), false);
    assert.equal(storage.getText('c'), null);
  });

  test('the memory backend keeps strings, like localStorage', () => {
    const backend = createMemoryBackend();
    backend.setItem('n', 42);
    assert.equal(backend.getItem('n'), '42');
    assert.equal(backend.getItem('other'), null);
  });
});

describe('createStorage never throws', () => {
  test('with a backend that throws everywhere', () => {
    const storage = createStorage(throwingBackend());
    assert.equal(storage.getText('a'), null);
    assert.equal(storage.setText('a', 'x'), false);
    assert.deepEqual(storage.getJSON('a', { fallback: true }), { fallback: true });
    assert.equal(storage.setJSON('a', {}), false);
  });

  test('without any storage', () => {
    const storage = createStorage(null);
    assert.equal(storage.getText('a'), null);
    assert.equal(storage.getJSON('a', 1), 1);
    assert.equal(storage.setText('a', 'x'), false);
    assert.equal(storage.setJSON('a', {}), false);
  });
});

describe('the default backend is globalThis.localStorage, looked up on each call', () => {
  test('missing localStorage', () => {
    withGlobalLocalStorage({ value: undefined }, () => {
      const storage = createStorage();
      assert.equal(storage.getText('a'), null);
      assert.equal(storage.setText('a', 'x'), false);
    });
  });

  test('localStorage that throws on access', () => {
    withGlobalLocalStorage({ get() { throw new Error('SecurityError'); } }, () => {
      const storage = createStorage();
      assert.equal(storage.getJSON('a', 'fallback'), 'fallback');
      assert.equal(storage.setJSON('a', 1), false);
    });
  });

  test('a working localStorage', () => {
    const storage = createStorage();
    const backend = createMemoryBackend();
    withGlobalLocalStorage({ value: backend }, () => {
      assert.equal(storage.setJSON('k', [1]), true);
      assert.deepEqual(storage.getJSON('k'), [1]);
    });
    assert.equal(backend.getItem('k'), '[1]');
  });
});
