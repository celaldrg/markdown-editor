/**
 * The only door to localStorage. Every access is wrapped in try/catch, so
 * private browsing, blocked cookies or a full quota never crash the app;
 * reads then return the fallback and writes report false.
 */

/**
 * @typedef {object} StorageBackend
 * @property {(key: string) => (string|null)} getItem
 * @property {(key: string, value: string) => void} setItem
 */

/**
 * @typedef {object} SafeStorage
 * @property {(key: string) => (string|null)} getText
 * @property {(key: string, value: string) => boolean} setText
 * @property {(key: string, fallback?: any) => any} getJSON
 * @property {(key: string, value: any) => boolean} setJSON
 */

/**
 * Creates the storage helper. Without a backend it uses
 * globalThis.localStorage, looked up lazily on each call.
 * @param {StorageBackend|null} [backend]
 * @returns {SafeStorage}
 */
export function createStorage(backend) {
  const resolve = () => (backend === undefined ? globalThis.localStorage ?? null : backend);

  const getText = (key) => {
    try {
      const store = resolve();
      return store ? store.getItem(key) : null;
    } catch {
      return null;
    }
  };

  const setText = (key, value) => {
    try {
      const store = resolve();
      if (!store) return false;
      store.setItem(key, String(value));
      return true;
    } catch {
      return false;
    }
  };

  return {
    getText,
    setText,
    getJSON(key, fallback = null) {
      const raw = getText(key);
      if (raw === null) return fallback;
      try {
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    setJSON(key, value) {
      try {
        return setText(key, JSON.stringify(value));
      } catch {
        return false;
      }
    },
  };
}

/**
 * An in-memory backend with the localStorage interface, used by the ?demo
 * state (it never touches the visitor's saved documents) and by tests.
 * @returns {StorageBackend}
 */
export function createMemoryBackend() {
  const items = new Map();
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => {
      items.set(key, String(value));
    },
  };
}
