import test from 'node:test';
import assert from 'node:assert/strict';
import { addBatch, addEvaluation, addExperiment, addJournalEntry, addRevision, batchSummary, createInitialState, exportState } from '../src/domain/store.mjs';

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
