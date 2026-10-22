import { CURRENT_SCHEMA_VERSION, STORAGE_KEY, createInitialState, loadState, saveState } from './store.mjs';
import { mergeBackup, replaceWithBackup } from './backup.mjs';

// Writes are refused while the session is locked, because the app only holds a
// fallback state in that case and saving it would destroy the unreadable saved
// data. The single sanctioned exception is an explicit backup Replace, which
// is the user's own decision to discard what could not be read.
export function persistState(adapter, next, { locked = false, allowLocked = false } = {}) {
  if (locked && !allowLocked) return { ok: false, state: null, error: 'Your saved Atelier data could not be loaded, so editing is disabled to protect it. Import a valid backup and choose Replace to recover.' };
  return { ok: true, state: adapter.save(next), error: '' };
}

// Applying an imported backup. A merge needs readable current records to merge
// into, so it is refused while locked; a replace restores the backup outright
// and is allowed to clear the lock.
export function applyBackupImport(adapter, pendingBackup, { mode, currentState, locked = false }) {
  if (!pendingBackup) return { ok: false, state: null, locked, error: 'No backup is pending.' };
  if (mode === 'merge' && locked) return { ok: false, state: null, locked, error: 'Merge needs your current records, which could not be loaded. Use Replace to restore this backup instead.' };
  try {
    const result = mode === 'merge'
      ? mergeBackup(currentState, pendingBackup.state)
      : { state: replaceWithBackup(pendingBackup.state), imported: pendingBackup.state.journalEntries.length, conflicts: [] };
    const saved = persistState(adapter, result.state, { locked, allowLocked: mode === 'replace' });
    if (!saved.ok) return { ok: false, state: null, locked, error: saved.error };
    return { ok: true, state: saved.state, locked: false, imported: result.imported, conflicts: result.conflicts, error: '' };
  } catch (error) {
    return { ok: false, state: null, locked, error: error.message };
  }
}

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
