import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRevisions } from '../src/domain/comparison.mjs';
import { createInitialState } from '../src/domain/store.mjs';
import { summarizeExperiment } from '../src/domain/summaries.mjs';

test('revision comparison is deterministic and reports ingredient changes plus provenance warnings', () => {
  const state = createInitialState();
  state.revisions = [
    { ...state.revisions[0], id: 'rev-a', revision: 1, ingredients: [{ materialId: 'material-seed-1', lotId: 'lot-seed-1', quantity: 2, unit: 'g', role: 'base' }] },
    { ...state.revisions[0], id: 'rev-b', revision: 2, supersedesRevisionId: 'rev-a', ingredients: [{ materialId: 'material-seed-1', lotId: 'lot-seed-1', quantity: 3, unit: 'g', role: 'base' }] }
  ];
  state.experiments = [{ ...state.experiments[0], formulaRevisionIds: ['rev-a', 'rev-b'] }];
  const result = compareRevisions(state, 'rev-a', 'rev-b');
  assert.equal(result.ingredientChanges[0].kind, 'changed');
  assert.equal(result.conditionsCompatible, true);
  assert.ok(Array.isArray(result.warnings));
});

test('experiment summary distinguishes missing evidence from recorded data', () => {
  const state = createInitialState();
  const summary = summarizeExperiment(state, state.experiments[0].id);
  assert.equal(summary.provenance, 'recorded');
  assert.equal(summary.revisions.length, 1);
  assert.equal(summary.batches.length, 1);
  assert.equal(summary.evaluations.length, 1);
  assert.deepEqual(summary.warnings, []);
});
