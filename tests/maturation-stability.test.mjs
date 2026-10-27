import test from 'node:test';
import assert from 'node:assert/strict';
import { addBatch, addExperiment, addRevision, createInitialState, createMaturationPlan, maturationPlanTimeline, recordMaturationObservation } from '../src/domain/store.mjs';
import { parseBackup, serializeBackup, mergeBackup } from '../src/domain/backup.mjs';

function stateWithBatch() {
  let state = createInitialState();
  state = addExperiment(state, { experimentId: 'EXP-MAT', title: 'Maturation candidate', objective: 'Observe a physical batch over time.' });
  const experiment = state.experiments.find(item => item.experimentId === 'EXP-MAT');
  state = addRevision(state, experiment.id, { ingredients: [{ materialId: 'material-seed-2', lotId: 'lot-seed-2', quantity: 10, unit: 'g' }] });
  const revision = state.revisions.find(item => item.experimentId === experiment.id);
  return addBatch(state, experiment.id, { id: 'batch-maturation', batchCode: 'BATCH-MAT', formulaRevisionId: revision.id, plannedAmount: 10, unit: 'g', mixingDate: '2026-10-20T10:00:00.000Z', actualAdditions: [{ id: 'addition-maturation', materialId: 'material-seed-2', materialLotId: 'lot-seed-2', amount: 10, unit: 'g', concentration: 100 }] });
}

test('maturation plan preserves exact batch links and orders custom checkpoints', () => {
  const state = stateWithBatch(); const batch = state.batches.find(item => item.id === 'batch-maturation'); const experiment = state.experiments.find(item => item.id === batch.experimentId); const revision = state.revisions.find(item => item.id === batch.formulaRevisionId);
  const next = createMaturationPlan(state, { id: 'plan-mat-1', name: 'Custom stability log', purpose: 'Document visible changes without a scientific verdict.', batchId: batch.id, experimentId: experiment.id, revisionId: revision.id, checkpoints: [{ label: '7d', offsetMinutes: 10080, order: 3 }, { label: '0h', offsetMinutes: 0, order: 1 }, { label: '24h', offsetMinutes: 1440, order: 2 }], storageConditions: 'Dark, sealed glass' });
  assert.deepEqual(next.maturationPlans[0].checkpointIds.map(id => next.maturationCheckpoints.find(item => item.id === id).label), ['0h', '24h', '7d']);
  assert.equal(next.maturationPlans[0].batchId, batch.id); assert.equal(next.maturationPlans[0].revisionId, revision.id);
  assert.throws(() => createMaturationPlan(state, { name: 'Bad', purpose: 'Bad', batchId: batch.id, experimentId: 'wrong', revisionId: revision.id, checkpoints: [{ label: '0h', offsetMinutes: 0 }] }), /does not match/);
});

test('maturation observations preserve planned versus actual timing, conditions, and evidence types', () => {
  const planState = createMaturationPlan(stateWithBatch(), { id: 'plan-mat-2', name: 'Timeline', purpose: 'Compare baseline and later record.', batchId: 'batch-maturation', checkpoints: [{ label: '0h', offsetMinutes: 0 }, { label: '24h', offsetMinutes: 1440 }, { label: '7d', offsetMinutes: 10080 }] });
  const plan = planState.maturationPlans[0]; const baseline = plan.checkpointIds[0]; const later = plan.checkpointIds[1];
  let state = recordMaturationObservation(planState, plan.id, baseline, { observedAt: '2026-10-20T10:15:00.000Z', appearance: 'Clear', color: 'Pale gold', clarity: 'Transparent', subjectiveOdour: 'Soft citrus', storageTemperature: 20, storageTemperatureUnit: '°C', storageLocation: 'Cabinet A', containerType: 'Amber vial', closureSeal: 'Screw cap', lightExposure: 'Dark', measuredValues: [{ label: 'Density', value: 0.92, unit: 'g/mL' }] });
  state = recordMaturationObservation(state, plan.id, later, { observedAt: '2026-10-21T12:00:00.000Z', appearance: 'Slight haze', clarity: 'Cloudy', subjectiveOdour: 'Drier', deviations: 'Observed two hours late', evidenceStatus: 'incomplete' });
  const timeline = maturationPlanTimeline(state, plan.id, { asOf: '2026-10-22T00:00:00.000Z' });
  assert.equal(timeline.checkpoints[0].status, 'completed'); assert.equal(timeline.checkpoints[1].status, 'completed'); assert.equal(timeline.checkpoints[2].status, 'upcoming'); assert.equal(timeline.evidenceStatus, 'Incomplete evidence'); assert.equal(timeline.baseline.appearance, 'Clear'); assert.equal(timeline.observations[1].elapsedMinutes, 1560);
  const dueTimeline = maturationPlanTimeline(planState, plan.id, { asOf: '2026-10-20T10:00:00.000Z' }); assert.equal(dueTimeline.checkpoints[0].status, 'due');
  const overdueTimeline = maturationPlanTimeline(planState, plan.id, { asOf: '2026-10-22T00:00:00.000Z' }); assert.equal(overdueTimeline.checkpoints[1].status, 'overdue');
  assert.equal(timeline.observations[0].measuredValues[0].unit, 'g/mL'); assert.equal(timeline.observations[0].subjectiveOdour, 'Soft citrus');
  assert.throws(() => recordMaturationObservation(state, plan.id, 'unknown-checkpoint', { observedAt: '2026-10-22T00:00:00.000Z' }), /not found/);
});

test('maturation records round-trip, merge idempotently, and legacy backups default empty collections', () => {
  const state = createMaturationPlan(stateWithBatch(), { id: 'plan-mat-3', name: 'Backup plan', purpose: 'Round trip', batchId: 'batch-maturation', checkpoints: [{ label: '0h', offsetMinutes: 0 }] });
  const restored = parseBackup(serializeBackup(state)).state; assert.deepEqual(restored.maturationPlans, state.maturationPlans); assert.deepEqual(restored.maturationCheckpoints, state.maturationCheckpoints);
  const merged = mergeBackup(state, restored); assert.equal(merged.imported, 0);
  const legacy = createInitialState(); legacy.version = 1; delete legacy.maturationPlans; delete legacy.maturationCheckpoints; delete legacy.maturationObservations;
  const legacyRestored = parseBackup(JSON.stringify({ format: 'atelier-scent-lab-backup', backupVersion: 1, schemaVersion: 1, state: legacy })).state; assert.deepEqual(legacyRestored.maturationPlans, []); assert.deepEqual(legacyRestored.maturationObservations, []);
});
