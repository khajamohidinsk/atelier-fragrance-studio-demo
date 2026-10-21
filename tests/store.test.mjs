import test from 'node:test';
import assert from 'node:assert/strict';
import { addBatch, addCompanionEntry, addEvaluation, addExperiment, addJournalEntry, addRevision, batchSummary, createInitialState, deleteCompanionEntry, exportState, importLegacyCompanionEntries, saveState, updateCompanionEntry } from '../src/domain/store.mjs';

test('journal, experiment, revision, batch, and evaluation remain linked', () => {
  let state = { ...createInitialState(), experiments: [], revisions: [], journalEntries: [], batches: [], evaluations: [] };
  state = addJournalEntry(state, { title: 'Test memory', purpose: 'Check a citrus opening' });
  state = addExperiment(state, { title: 'Citrus trial', objective: 'Test lift', status: 'Draft' });
  const experiment = state.experiments[0];
  state = addRevision(state, experiment.id, { notes: 'Revision one', ingredients: [{ materialId: 'm1', quantity: 1, unit: 'g' }] });
  const revision = state.revisions[0];
  state = addBatch(state, experiment.id, { formulaRevisionId: revision.id, plannedAmount: 10, unit: 'g', actualAdditions: [{ materialId: 'm1', materialLotId: 'lot-1', amount: 1, unit: 'g', concentration: 100 }] });
  const batch = state.batches[0];
  state = addEvaluation(state, experiment.id, { batchId: batch.id, revisionId: revision.id, subjectiveNotes: 'Brighter than expected' });
  assert.deepEqual(state.experiments[0].formulaRevisionIds, [revision.id]);
  assert.deepEqual(state.experiments[0].batchIds, [batch.id]);
  assert.equal(state.experiments[0].evaluationIds.length, 1);
  assert.equal(state.experiments[0].status, 'Evaluated');
});

test('historical formula revisions are appended, never overwritten', () => {
  let state = createInitialState();
  const experimentId = state.experiments[0].id;
  const firstRevisionId = state.experiments[0].formulaRevisionIds[0];
  state = addRevision(state, experimentId, { notes: 'Second pass', ingredients: [] });
  assert.equal(state.revisions.find(item => item.id === firstRevisionId).revision, 1);
  assert.equal(state.revisions.find(item => item.supersedesRevisionId === firstRevisionId).revision, 2);
});

test('batch summary keeps actual material traceability', () => {
  const batch = { unit: 'g', actualAdditions: [{ materialId: 'a', amount: 2, unit: 'g', concentration: 100 }, { materialId: 'b', amount: 8, unit: 'g', concentration: 0 }] };
  assert.deepEqual(batchSummary(batch), { totalAmount: 10, totalActiveAmount: 2, unit: 'g', byMaterial: { a: 2, b: 8 } });
});

test('state export is portable JSON', () => { const exported = JSON.parse(exportState(createInitialState())); assert.equal(exported.version, 1); assert.ok(exported.exportedAt); });

test('companion observations preserve original and corrected text through edits', () => {
  let state = { ...createInitialState(), companionEntries: [] };
  state = addCompanionEntry(state, { materialName: 'Cedarwood', evaluationType: 'stock dilution', concentration: '10%', originalText: 'Dry and pencil-like', correctedText: 'Dry and pencil-like', source: 'speech' });
  const created = state.companionEntries[0];
  assert.equal(created.originalText, 'Dry and pencil-like');
  state = updateCompanionEntry(state, created.id, { correctedText: 'Dry, pencil-like, and quietly smoky', elapsedTime: '15 minutes' });
  assert.equal(state.companionEntries[0].originalText, 'Dry and pencil-like');
  assert.equal(state.companionEntries[0].correctedText, 'Dry, pencil-like, and quietly smoky');
  assert.equal(state.companionEntries[0].elapsedTime, '15 minutes');
  assert.ok(state.companionEntries[0].updatedAt);
});

test('legacy companion storage imports without losing context or timestamps', () => {
  const legacy = { schemaVersion: 1, entries: [{ id: 'legacy-1', materialName: 'Rose', evaluationType: 'blend', concentration: '5%', evaluationMethod: 'blotter', elapsedTime: '30 minutes', originalText: 'Petal-like', correctedText: 'Petal-like and airy', createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-20T10:05:00.000Z', source: 'typed' }] };
  const storage = { getItem: key => key === 'atelier.scent-companion.v1' ? JSON.stringify(legacy) : null };
  const result = importLegacyCompanionEntries({ ...createInitialState(), companionEntries: [] }, storage);
  assert.equal(result.imported, 1);
  assert.deepEqual({ ...result.state.companionEntries[0], aiSuggestions: undefined }, { ...legacy.entries[0], aiSuggestions: undefined });
});

test('legacy companion import merges older entries even when newer entries already exist', () => {
  const legacy = { schemaVersion: 1, entries: [
    { id: 'legacy-existing', materialName: 'Rose', originalText: 'Already imported', createdAt: '2026-10-20T10:00:00.000Z' },
    { id: 'legacy-older', materialName: 'Iris', originalText: 'Powdery and cool', createdAt: '2026-10-19T10:00:00.000Z' }
  ] };
  const current = { ...createInitialState(), companionEntries: [{ id: 'legacy-existing', materialName: 'Rose', originalText: 'Already imported', correctedText: 'Already imported', createdAt: '2026-10-20T10:00:00.000Z' }, { id: 'new-format', materialName: 'Cedar', originalText: 'Dry', createdAt: '2026-10-21T10:00:00.000Z' }] };
  const storage = { getItem: key => key === 'atelier.scent-companion.v1' ? JSON.stringify(legacy) : null };
  const result = importLegacyCompanionEntries(current, storage);
  assert.equal(result.imported, 1);
  assert.deepEqual(result.state.companionEntries.map(entry => entry.id), ['legacy-existing', 'new-format', 'legacy-older']);
});

test('saveState surfaces storage failures instead of reporting success', () => {
  assert.throws(() => saveState(createInitialState(), { setItem: () => { throw new Error('quota'); } }), /Could not save Atelier data/);
});

test('companion deletion removes only the selected observation', () => {
  let state = { ...createInitialState(), companionEntries: [] };
  state = addCompanionEntry(state, { materialName: 'A', originalText: 'First' });
  state = addCompanionEntry(state, { materialName: 'B', originalText: 'Second' });
  const removedId = state.companionEntries[0].id;
  state = deleteCompanionEntry(state, removedId);
  assert.equal(state.companionEntries.length, 1);
  assert.equal(state.companionEntries[0].materialName, 'A');
});
