import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_FORMAT, createBackup, mergeBackup, parseBackup, previewBackupMerge, serializeBackup } from '../src/domain/backup.mjs';
import { createInitialState } from '../src/domain/store.mjs';

test('backup export and import round-trip preserves collections and IDs', () => {
  const state = createInitialState();
  const payload = parseBackup(serializeBackup(state, { exportedAt: '2026-10-22T00:00:00.000Z' }));
  assert.equal(payload.format, BACKUP_FORMAT);
  assert.equal(payload.schemaVersion, 2);
  assert.deepEqual(payload.state.experiments.map(item => item.id), state.experiments.map(item => item.id));
  assert.deepEqual(payload.state.stockMovements.map(item => item.id), state.stockMovements.map(item => item.id));
});

test('backup parser rejects malformed, wrong-format, and future payloads', () => {
  assert.throws(() => parseBackup('{'), /malformed/);
  assert.throws(() => parseBackup(JSON.stringify({ format: 'other', backupVersion: 1, schemaVersion: 2, state: {} })), /not an Atelier/);
  assert.throws(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, backupVersion: 1, schemaVersion: 99, state: {} })), /future/);
});

test('backup merge imports missing records but reports conflicting IDs without overwriting current data', () => {
  const current = createInitialState();
  const incoming = createInitialState();
  incoming.journalEntries = [{ ...incoming.journalEntries[0], title: 'Conflicting title' }, { id: 'new-entry', title: 'New', observedAt: '2026-10-22T00:00:00.000Z' }];
  const result = mergeBackup(current, incoming);
  assert.equal(result.imported, 1);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.state.journalEntries.find(item => item.id === 'journal-seed-1').title, 'Rain on warm stone');
  assert.ok(result.state.journalEntries.some(item => item.id === 'new-entry'));
});

test('backup envelope rejects missing or invalid schema versions', () => {
  assert.throws(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, backupVersion: 1, state: {} })), /schema version/);
  assert.throws(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, backupVersion: 1, schemaVersion: '2', state: {} })), /schema version/);
  assert.throws(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, backupVersion: 1, schemaVersion: 0, state: {} })), /schema version/);
  assert.throws(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, backupVersion: 1, schemaVersion: 1.5, state: {} })), /schema version/);
});

test('backup envelope rejects a non-object state payload', () => {
  assert.throws(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, backupVersion: 1, schemaVersion: 2, state: [] })), /state payload/);
  assert.throws(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, backupVersion: 1, schemaVersion: 2, state: null })), /state payload/);
  assert.throws(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, backupVersion: 1, schemaVersion: 2, state: 'oops' })), /state payload/);
});

test('parseBackup surfaces a corrupt state payload instead of fabricating records', () => {
  const envelope = { format: BACKUP_FORMAT, backupVersion: 1, schemaVersion: 2, state: { materials: [null] } };
  assert.throws(() => parseBackup(JSON.stringify(envelope)), /Material records/);
});

test('merge rejects corrupt backups before touching current data', () => {
  const current = createInitialState();
  const duplicate = createInitialState();
  duplicate.journalEntries = [
    { ...duplicate.journalEntries[0], title: 'Conflicting' },
    { ...duplicate.journalEntries[0], title: 'Duplicate' }
  ];
  assert.throws(() => mergeBackup(current, duplicate), /Duplicate or missing/);
  const noId = createInitialState();
  noId.journalEntries = [{ title: 'No id', observedAt: '2026-10-22T00:00:00.000Z' }];
  assert.throws(() => mergeBackup(current, noId), /Duplicate or missing/);
});

test('empty state can be exported and imported', () => {
  const empty = createInitialState();
  for (const key of ['journalEntries', 'experiments', 'revisions', 'materials', 'batches', 'evaluations', 'stockMovements', 'companionEntries']) empty[key] = [];
  const parsed = parseBackup(JSON.stringify(createBackup(empty, { exportedAt: '2026-10-22T00:00:00.000Z' })));
  assert.deepEqual(parsed.state.journalEntries, []);
  assert.deepEqual(parsed.state.stockMovements, []);
});

test('backup merge preview reports new records and conflicts before applying', () => {
  const current = createInitialState();
  const incoming = createInitialState();
  incoming.journalEntries = [{ ...incoming.journalEntries[0], title: 'Changed locally elsewhere' }, { id: 'preview-new', title: 'New', observedAt: '2026-10-24T00:00:00.000Z' }];
  const preview = previewBackupMerge(current, incoming);
  assert.equal(preview.imported, 1);
  assert.equal(preview.conflicts.length, 1);
});
