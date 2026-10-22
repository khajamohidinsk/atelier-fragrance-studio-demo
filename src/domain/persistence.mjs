import { CURRENT_SCHEMA_VERSION, STORAGE_KEY, loadState, saveState } from './store.mjs';

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
