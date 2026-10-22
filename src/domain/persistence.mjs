import { CURRENT_SCHEMA_VERSION, STORAGE_KEY, createInitialState, loadState, saveState } from './store.mjs';

// Bootstrapping a session after a failed load must never hand the app a
// writable seed state: saving it would overwrite the unreadable saved data.
// `locked: true` means the caller may display the fallback but must refuse
// every write until the user explicitly replaces the state (backup import).
export function bootstrapState(adapter) {
  try {
    return { state: adapter.load(), locked: false, error: '' };
  } catch (error) {
    return { state: createInitialState(), locked: true, error: error.message };
  }
}

export function createLocalStorageAdapter(storage = globalThis.localStorage, key = STORAGE_KEY) {
  return {
    key,
    storage,
    load() {
      if (!storage) throw new Error('Atelier storage is unavailable in this browser.');
      return loadState({
        getItem(candidate) { return candidate === key ? storage.getItem(candidate) : storage.getItem(candidate); }
      });
    },
    save(state) {
      if (!storage) throw new Error('Atelier storage is unavailable in this browser.');
      return saveState(state, storage);
    },
    subscribe(listener) {
      if (typeof window === 'undefined') return () => {};
      const handler = event => { if (event.key === key) listener(event); };
      window.addEventListener('storage', handler);
      return () => window.removeEventListener('storage', handler);
    },
    schemaVersion: CURRENT_SCHEMA_VERSION
  };
}

export function createMemoryAdapter(initialState) {
  let state = initialState;
  return {
    load: () => state,
    save: next => { state = next; return state; },
    subscribe: () => () => {},
    schemaVersion: CURRENT_SCHEMA_VERSION
  };
}
