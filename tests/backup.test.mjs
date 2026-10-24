import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_FORMAT, createBackup, mergeBackup, parseBackup, previewBackupMerge, previewBackupReplace, serializeBackup } from '../src/domain/backup.mjs';
import { addBatch, addExperiment, addRevision, createInitialState, recordSensoryEvaluation } from '../src/domain/store.mjs';

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
  assert.throws(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, backupVersion: 1, schemaVersion: 1, state: { version: 2 } })), /contradicts/);
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

test('backup round-trip preserves physical batch metadata, additions, and stock links', () => {
  const seed = createInitialState();
  let state = { ...seed, experiments: [], revisions: [], journalEntries: [], batches: [], evaluations: [], stockMovements: seed.stockMovements.filter(item => item.movementType === 'opening') };
  state = addExperiment(state, { title: 'Backup batch', objective: 'Preserve physical history' });
  const experiment = state.experiments[0];
  state = addRevision(state, experiment.id, { ingredients: [{ materialId: 'material-seed-1', lotId: 'lot-seed-1', quantity: 2, unit: 'g' }] });
  const revision = state.revisions[0];
  state = addBatch(state, experiment.id, { batchCode: 'BATCH-BACKUP-1', formulaRevisionId: revision.id, plannedAmount: 2, unit: 'g', mixingDate: '2026-10-24T12:00:00.000Z', deviations: 'None', actualAdditions: [{ id: 'addition-backup-1', materialId: 'material-seed-1', materialLotId: 'lot-seed-1', amount: 2, unit: 'g', concentration: 100 }] });
  const restored = parseBackup(serializeBackup(state));
  assert.deepEqual(restored.state.batches, state.batches);
  assert.ok(restored.state.stockMovements.some(item => item.additionId === 'addition-backup-1' && item.batchId === state.batches[0].id));
});

test('backup round-trip preserves multi-interval sensory evidence and provenance fields', () => {
  const seed = createInitialState();
  let state = { ...seed, experiments: [], revisions: [], journalEntries: [], batches: [], evaluations: [], stockMovements: seed.stockMovements.filter(item => item.movementType === 'opening') };
  state = addExperiment(state, { title: 'Backup sensory timeline', objective: 'Preserve B5 evidence' });
  const experiment = state.experiments[0];
  state = addRevision(state, experiment.id, { ingredients: [{ materialId: 'material-seed-1', lotId: 'lot-seed-1', quantity: 2, unit: 'g' }] });
  const revision = state.revisions[0];
  state = addBatch(state, experiment.id, { batchCode: 'BATCH-SENSORY-1', formulaRevisionId: revision.id, plannedAmount: 2, unit: 'g', actualAdditions: [{ id: 'addition-sensory-1', materialId: 'material-seed-1', materialLotId: 'lot-seed-1', amount: 2, unit: 'g', concentration: 100 }] });
  const batch = state.batches[0];
  state = recordSensoryEvaluation(state, experiment.id, { batchId: batch.id, evaluatedAt: '2026-10-24T08:00:00.000Z', elapsedMinutes: 10, intervalLabel: 'Opening', subjectiveNotes: 'Bright', predictedOutcome: 'Will soften', provenance: 'subjective' });
  state = recordSensoryEvaluation(state, experiment.id, { batchId: batch.id, evaluatedAt: '2026-10-25T08:00:00.000Z', elapsedMinutes: 1450, intervalLabel: '24 hours', measuredResults: 'Timed blotter check', isMeasured: true, longevityObservation: 'Present', longevityMethod: 'Timed check', projectionObservation: 'Close', projectionMethod: 'Observer estimate', conclusions: 'Recorded persistence', nextSteps: 'Repeat on skin' });
  const restored = parseBackup(serializeBackup(state));
  assert.deepEqual(restored.state.evaluations, state.evaluations);
  assert.equal(restored.state.evaluations[0].provenance, 'measured');
  assert.equal(restored.state.evaluations[1].predictedOutcome, 'Will soften');
});

test('full populated backup round-trip preserves relationships, units, timestamps, planned quantities, and actual additions', () => {
  const state = createInitialState();
  const restored = parseBackup(serializeBackup(state, { exportedAt: '2026-10-25T00:00:00.000Z' })).state;
  assert.deepEqual(restored, state);
  assert.equal(restored.batches[0].plannedAmount, 100);
  assert.equal(restored.batches[0].actualAdditions[0].amount, 20);
  assert.equal(restored.batches[0].actualAdditions[0].unit, 'g');
  assert.equal(restored.evaluations[0].provenance, 'synthetic-demo');
  assert.equal(restored.stockMovements.find(item => item.id === 'movement-seed-1').batchId, restored.batches[0].id);
});

test('supported schema version 1 backup migrates explicitly to the current state schema', () => {
  const legacy = createInitialState();
  legacy.version = 1;
  legacy.stockMovements = undefined;
  legacy.batches = legacy.batches.map(batch => ({ ...batch, actualAdditions: batch.actualAdditions.map(({ stockMovementId, ...addition }) => addition) }));
  const payload = parseBackup(JSON.stringify({ format: BACKUP_FORMAT, backupVersion: 1, schemaVersion: 1, application: 'Atelier Scent Lab', exportedAt: '2026-10-25T00:00:00.000Z', state: legacy }));
  assert.equal(payload.migratedFromSchemaVersion, 1);
  assert.equal(payload.state.version, 2);
  assert.ok(payload.state.stockMovements.some(item => item.provenance === 'migration'));
});

test('re-importing the same backup is duplicate-safe and replacement preview reports destructive records', () => {
  const current = createInitialState();
  const incoming = { ...current, journalEntries: [{ ...current.journalEntries[0], title: 'Changed elsewhere' }, ...current.journalEntries.slice(1)] };
  const first = mergeBackup(current, incoming);
  const second = mergeBackup(first.state, incoming);
  assert.equal(first.imported, 0);
  assert.equal(second.imported, 0);
  assert.equal(new Set(second.state.journalEntries.map(item => item.id)).size, second.state.journalEntries.length);
  const preview = previewBackupReplace(current, incoming);
  assert.equal(preview.mode, 'replace');
  assert.equal(preview.changedRecords.length, 1);
  assert.ok(preview.overwritten.some(item => item.id === current.journalEntries[0].id));
  assert.ok(preview.preserved.length > 0);
});

test('preview reports missing references without applying an invalid backup', () => {
  const current = createInitialState();
  const invalid = { ...current, experiments: [{ ...current.experiments[0], formulaRevisionIds: ['missing-revision'] }] };
  const preview = previewBackupMerge(current, invalid);
  assert.equal(preview.valid, false);
  assert.ok(preview.missingReferences.some(message => message.includes('invalid revision link')));
  assert.equal(current.experiments[0].formulaRevisionIds[0], 'revision-seed-1');
});
