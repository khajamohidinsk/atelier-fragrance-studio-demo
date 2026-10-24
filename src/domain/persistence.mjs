import { CURRENT_SCHEMA_VERSION, STORAGE_KEY, createInitialState, loadState, saveState } from './store.mjs';
import { mergeBackup, parseBackup, previewBackupMerge, previewBackupReplace, replaceWithBackup, serializeBackup, validateBackupEnvelope } from './backup.mjs';

export const RECOVERY_STORAGE_KEY = `${STORAGE_KEY}-recovery`;

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
export function applyBackupImport(adapter, pendingBackup, { mode, currentState, locked = false, createRecovery = true } = {}) {
  if (!pendingBackup) return { ok: false, state: null, locked, error: 'No backup is pending.' };
  if (mode === 'merge' && locked) return { ok: false, state: null, locked, error: 'Merge needs your current records, which could not be loaded. Use Replace to restore this backup instead.' };
  try {
    validateBackupEnvelope(pendingBackup);
    const result = mode === 'merge'
      ? mergeBackup(currentState, pendingBackup.state)
      : { state: replaceWithBackup(pendingBackup.state), imported: Object.values(pendingBackup.state).filter(value => Array.isArray(value)).reduce((sum, value) => sum + value.length, 0), conflicts: [] };
    if (mode === 'replace' && !locked && createRecovery) {
      if (typeof adapter.saveRecovery !== 'function') throw new Error('Replacement requires a recoverable backup adapter. No replacement was applied.');
      adapter.saveRecovery(currentState);
    }
    const saved = persistState(adapter, result.state, { locked, allowLocked: mode === 'replace' });
    if (!saved.ok) return { ok: false, state: null, locked, error: saved.error };
    return { ok: true, state: saved.state, locked: false, imported: result.imported, conflicts: result.conflicts, recoveryCreated: mode === 'replace' && !locked && createRecovery, error: '' };
  } catch (error) {
    return { ok: false, state: null, locked, error: error.message };
  }
}

export function previewBackupImport(currentState, pendingBackup, { mode = 'merge', locked = false } = {}) {
  if (!pendingBackup) throw new Error('No backup is pending.');
  validateBackupEnvelope(pendingBackup);
  if (mode === 'merge' && locked) throw new Error('Merge needs your current records, which could not be loaded. Use Replace to restore this backup instead.');
  if (mode === 'replace') return previewBackupReplace(currentState, pendingBackup.state);
  return previewBackupMerge(currentState, pendingBackup.state);
}

export function restoreRecoveryBackup(adapter, { currentState, locked = false } = {}) {
  if (typeof adapter.loadRecovery !== 'function') return { ok: false, state: null, locked, error: 'Recovery is not available for this persistence adapter.' };
  try {
    const recovery = adapter.loadRecovery();
    if (!recovery) return { ok: false, state: null, locked, error: 'No recoverable previous state is available.' };
    return applyBackupImport(adapter, recovery, { mode: 'replace', currentState, locked, createRecovery: false });
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
  const recoveryKey = `${key}-recovery`;
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
    saveRecovery(state) {
      if (!storage) throw new Error('Atelier storage is unavailable in this browser.');
      storage.setItem(recoveryKey, serializeBackup(state));
    },
    loadRecovery() {
      if (!storage) return null;
      const raw = storage.getItem(recoveryKey);
      return raw ? parseBackup(raw) : null;
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
  let recovery = null;
  return {
    load: () => state,
    save: next => { state = next; return state; },
    saveRecovery: next => { recovery = parseBackup(serializeBackup(next)); },
    loadRecovery: () => recovery,
    subscribe: () => () => {},
    schemaVersion: CURRENT_SCHEMA_VERSION
  };
}
