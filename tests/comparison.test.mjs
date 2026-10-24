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

test('revision comparison includes batch evidence, evaluation provenance, and condition differences', () => {
  const state = createInitialState();
  const baseRevision = state.revisions[0];
  const leftRevision = { ...baseRevision, id: 'rev-left', revision: 1, ingredients: [{ materialId: 'material-seed-1', lotId: 'lot-seed-1', quantity: 20, unit: 'g', role: 'base' }] };
  const rightRevision = { ...baseRevision, id: 'rev-right', revision: 2, supersedesRevisionId: 'rev-left', ingredients: [{ materialId: 'material-seed-1', lotId: 'lot-seed-1', quantity: 18, unit: 'g', role: 'base' }, { materialId: 'material-seed-2', lotId: 'lot-seed-2', quantity: 2, unit: 'g', role: 'diluent' }] };
  state.revisions = [leftRevision, rightRevision]; state.experiments = [{ ...state.experiments[0], formulaRevisionIds: ['rev-left', 'rev-right'], batchIds: ['batch-left', 'batch-right'], evaluationIds: ['eval-left', 'eval-right'] }];
  const leftBatch = { ...state.batches[0], id: 'batch-left', formulaRevisionId: 'rev-left', batchCode: 'LEFT-1' };
  const rightBatch = { ...state.batches[0], id: 'batch-right', formulaRevisionId: 'rev-right', batchCode: 'RIGHT-1', actualAdditions: [{ ...state.batches[0].actualAdditions[0], id: 'right-addition-1', amount: 18, stockMovementId: 'movement-seed-1' }] };
  state.batches = [leftBatch, rightBatch];
  state.evaluations = [
    { ...state.evaluations[0], id: 'eval-left', batchId: 'batch-left', revisionId: 'rev-left', intervalLabel: 'Opening', medium: 'Blotter', environment: '22 C', conditions: 'One spray', provenance: 'subjective', isMeasured: false, subjectiveNotes: 'Bright' },
    { ...state.evaluations[0], id: 'eval-right', batchId: 'batch-right', revisionId: 'rev-right', intervalLabel: '24 hours', medium: 'Skin', environment: '21 C', conditions: 'One spray', provenance: 'measured', isMeasured: true, measuredResults: 'Timed check', subjectiveNotes: 'Softer' }
  ];
  const result = compareRevisions(state, 'rev-left', 'rev-right');
  assert.equal(result.ingredientChanges.length, 2);
  assert.equal(result.leftBatchEvidence.length, 1);
  assert.equal(result.rightEvaluations[0].provenance, 'measured');
  assert.equal(result.conditionDifferences.length, 2);
  assert.ok(result.warnings.some(item => item.includes('controlled trial')));
  assert.ok(result.summary.cannotConclude.some(item => item.includes('causation')));
});

test('revision comparison reports missing physical and sensory evidence', () => {
  const state = createInitialState();
  state.revisions = [{ ...state.revisions[0], id: 'rev-only-a', revision: 1 }, { ...state.revisions[0], id: 'rev-only-b', revision: 2, supersedesRevisionId: 'rev-only-a' }];
  state.experiments = [{ ...state.experiments[0], formulaRevisionIds: ['rev-only-a', 'rev-only-b'], batchIds: [], evaluationIds: [] }];
  const result = compareRevisions(state, 'rev-only-a', 'rev-only-b');
  assert.ok(result.missingEvidence.some(item => item.includes('left revision')));
  assert.ok(result.missingEvidence.some(item => item.includes('right revision')));
  assert.equal(result.leftBatchEvidence.length, 0);
  assert.equal(result.rightEvaluations.length, 0);
});
