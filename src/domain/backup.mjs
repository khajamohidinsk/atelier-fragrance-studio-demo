import { CURRENT_SCHEMA_VERSION, LEGACY_COMPANION_STORAGE_KEY, normalizeState, validateState } from './store.mjs';

export const BACKUP_FORMAT = 'atelier-scent-lab-backup';
export const BACKUP_VERSION = 1;

function clone(value) { return JSON.parse(JSON.stringify(value)); }

export function createBackup(state, { exportedAt = new Date().toISOString() } = {}) {
  return { format: BACKUP_FORMAT, backupVersion: BACKUP_VERSION, schemaVersion: CURRENT_SCHEMA_VERSION, application: 'Atelier Scent Lab', exportedAt, state: clone(validateState(state)) };
}

export function serializeBackup(state, options = {}) { return JSON.stringify(createBackup(state, options), null, 2); }

export function validateBackupEnvelope(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Backup must be a JSON object.');
  if (payload.format !== BACKUP_FORMAT) throw new Error('This file is not an Atelier Scent Lab backup.');
  if (payload.backupVersion !== BACKUP_VERSION) throw new Error(`Unsupported backup format version ${payload.backupVersion}.`);
  if (!Number.isInteger(payload.schemaVersion) || payload.schemaVersion < 1) throw new Error('Backup is missing a valid schema version.');
  if (payload.schemaVersion > CURRENT_SCHEMA_VERSION) throw new Error(`Backup uses unsupported future schema version ${payload.schemaVersion}.`);
  if (!payload.state || typeof payload.state !== 'object' || Array.isArray(payload.state)) throw new Error('Backup is missing its state payload.');
  return payload;
}

export function parseBackup(text) {
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error('Backup JSON is malformed.'); }
  validateBackupEnvelope(payload);
  return { ...payload, state: validateState(normalizeState(payload.state)) };
}

function recordKey(record) { return record?.id || ''; }

export function mergeBackup(currentState, backupState) {
  const current = validateState(currentState);
  const incoming = validateState(backupState);
  const collections = ['journalEntries', 'experiments', 'revisions', 'materials', 'batches', 'evaluations', 'stockMovements', 'companionEntries', 'calculations', 'attachments'];
  const merged = { ...current };
  const conflicts = [];
  for (const collection of collections) {
    const records = [...(current[collection] || [])];
    const byId = new Map(records.map(record => [recordKey(record), record]));
    for (const record of incoming[collection] || []) {
      const key = recordKey(record);
      const existing = byId.get(key);
      if (!existing) { records.push(record); byId.set(key, record); continue; }
      if (JSON.stringify(existing) !== JSON.stringify(record)) conflicts.push({ collection, id: key, reason: 'conflicting-record' });
    }
    merged[collection] = records;
  }
  merged.tags = [...new Set([...(current.tags || []), ...(incoming.tags || [])])];
  const validated = validateState(merged);
  return { state: validated, imported: collections.reduce((sum, collection) => sum + (incoming[collection]?.filter(record => !(current[collection] || []).some(item => item.id === record.id)).length || 0), 0), conflicts };
}

export function previewBackupMerge(currentState, backupState) {
  const current = validateState(currentState);
  const incoming = validateState(backupState);
  const collections = ['journalEntries', 'experiments', 'revisions', 'materials', 'batches', 'evaluations', 'stockMovements', 'companionEntries', 'calculations', 'attachments'];
  const conflicts = [];
  let imported = 0;
  for (const collection of collections) {
    const currentRecords = current[collection] || [];
    for (const record of incoming[collection] || []) {
      const existing = currentRecords.find(item => item.id === record.id);
      if (!existing) imported += 1;
      else if (JSON.stringify(existing) !== JSON.stringify(record)) conflicts.push({ collection, id: record.id, reason: 'conflicting-record' });
    }
  }
  return { imported, conflicts, collections: collections.map(collection => ({ collection, incoming: incoming[collection]?.length || 0, current: current[collection]?.length || 0 })) };
}

export function replaceWithBackup(backupState) { return validateState(normalizeState(backupState)); }

export function legacyCompanionKey() { return LEGACY_COMPANION_STORAGE_KEY; }
