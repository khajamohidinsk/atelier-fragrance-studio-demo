import { CURRENT_SCHEMA_VERSION, LEGACY_COMPANION_STORAGE_KEY, normalizeState, validateState } from './store.mjs';

export const BACKUP_FORMAT = 'atelier-scent-lab-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_COLLECTIONS = ['journalEntries', 'experiments', 'revisions', 'materials', 'batches', 'evaluations', 'stockMovements', 'companionEntries', 'calculations', 'attachments', 'equipment', 'verificationEvents', 'maintenanceEvents', 'measurements', 'purchases', 'purchaseLineItems', 'blindSessions', 'blindSamples'];

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
  if (payload.application !== undefined && (typeof payload.application !== 'string' || !payload.application.trim())) throw new Error('Backup application metadata is invalid.');
  if (payload.exportedAt !== undefined && Number.isNaN(Date.parse(payload.exportedAt))) throw new Error('Backup exportedAt timestamp is invalid.');
  if (!payload.state || typeof payload.state !== 'object' || Array.isArray(payload.state)) throw new Error('Backup is missing its state payload.');
  if (payload.state.version !== undefined && (!Number.isInteger(payload.state.version) || payload.state.version < 1)) throw new Error('Backup state schema version is invalid.');
  if (payload.state.version !== undefined && payload.state.version > payload.schemaVersion) throw new Error('Backup state schema version contradicts the envelope schema version.');
  return payload;
}

export function parseBackup(text) {
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error('Backup JSON is malformed.'); }
  validateBackupEnvelope(payload);
  const migratedFromSchemaVersion = payload.schemaVersion < CURRENT_SCHEMA_VERSION ? payload.schemaVersion : undefined;
  return { ...payload, migratedFromSchemaVersion, state: validateState(normalizeState(payload.state)) };
}

function recordKey(record) { return record?.id || ''; }

export function mergeBackup(currentState, backupState) {
  const current = validateState(currentState);
  const incoming = validateState(backupState);
  const merged = { ...current };
  const conflicts = [];
  for (const collection of BACKUP_COLLECTIONS) {
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
  const incomingMaterials = new Map((incoming.materials || []).map(material => [material.id, material]));
  merged.materials = (merged.materials || []).map(material => {
    const incomingMaterial = incomingMaterials.get(material.id);
    if (!incomingMaterial) return material;
    const incomingLots = new Map((incomingMaterial.lots || []).map(lot => [lot.id, lot]));
    return { ...material, lots: (material.lots || []).map(lot => { const incomingLot = incomingLots.get(lot.id); return incomingLot ? { ...lot, purchaseLineItemIds: [...new Set([...(lot.purchaseLineItemIds || []), ...(incomingLot.purchaseLineItemIds || [])])] } : lot; }) };
  });
  merged.tags = [...new Set([...(current.tags || []), ...(incoming.tags || [])])];
  const validated = validateState(merged);
  return { state: validated, imported: BACKUP_COLLECTIONS.reduce((sum, collection) => sum + (incoming[collection]?.filter(record => !(current[collection] || []).some(item => item.id === record.id)).length || 0), 0), conflicts };
}

export function previewBackupMerge(currentState, backupState) {
  const current = validateState(currentState);
  let incoming;
  try { incoming = validateState(backupState); }
  catch (error) {
    return { mode: 'merge', valid: false, imported: 0, conflicts: [], changedRecords: [], missingReferences: [error.message], overwritten: [], preserved: [], discarded: [], collections: [], error: error.message };
  }
  const conflicts = [];
  const changedRecords = [];
  const preserved = [];
  let imported = 0;
  for (const collection of BACKUP_COLLECTIONS) {
    const currentRecords = current[collection] || [];
    for (const record of incoming[collection] || []) {
      const existing = currentRecords.find(item => item.id === record.id);
      if (!existing) imported += 1;
      else if (JSON.stringify(existing) !== JSON.stringify(record)) {
        const detail = { collection, id: record.id, reason: 'conflicting-record', current: existing, incoming: record };
        conflicts.push(detail); changedRecords.push(detail);
      } else preserved.push({ collection, id: record.id, reason: 'identical-record' });
    }
  }
  return {
    mode: 'merge', valid: true, imported, conflicts, changedRecords, missingReferences: [], overwritten: [], preserved,
    discarded: [], collections: BACKUP_COLLECTIONS.map(collection => ({ collection, incoming: incoming[collection]?.length || 0, current: current[collection]?.length || 0 }))
  };
}

export function previewBackupReplace(currentState, backupState) {
  const preview = previewBackupMerge(currentState, backupState);
  if (!preview.valid) return { ...preview, mode: 'replace' };
  const incomingIds = new Map(BACKUP_COLLECTIONS.flatMap(collection => (backupState[collection] || []).map(record => [`${collection}:${record.id}`, true])));
  const discarded = [];
  for (const collection of BACKUP_COLLECTIONS) for (const record of currentState[collection] || []) if (!incomingIds.has(`${collection}:${record.id}`)) discarded.push({ collection, id: record.id, reason: 'not-in-replacement' });
  return { ...preview, mode: 'replace', overwritten: preview.changedRecords, discarded, recoveryRequired: true };
}

export function replaceWithBackup(backupState) { return validateState(normalizeState(backupState)); }

export function legacyCompanionKey() { return LEGACY_COMPANION_STORAGE_KEY; }
