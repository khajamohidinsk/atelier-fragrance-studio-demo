import test from 'node:test';
import assert from 'node:assert/strict';
import { addBatch, addExperiment, addRevision, createExperimentDesign, createInitialState, experimentDesignReview, randomizeExperimentDesignRuns, shuffleExperimentRuns, updateExperimentDesignRun } from '../src/domain/store.mjs';
import { mergeBackup, parseBackup, serializeBackup } from '../src/domain/backup.mjs';

function designState() {
  let state = createInitialState();
  state = addExperiment(state, { experimentId: 'EXP-DESIGN', title: 'Repeatability candidate', objective: 'Compare two controlled conditions.' });
  const experiment = state.experiments.find(item => item.experimentId === 'EXP-DESIGN');
  state = addRevision(state, experiment.id, { ingredients: [{ materialId: 'material-seed-2', lotId: 'lot-seed-2', quantity: 1, unit: 'g' }] });
  const revision = state.revisions.find(item => item.experimentId === experiment.id);
  for (let index = 1; index <= 4; index += 1) state = addBatch(state, experiment.id, { id: `batch-design-${index}`, batchCode: `BATCH-D${index}`, formulaRevisionId: revision.id, plannedAmount: 1, unit: 'g', actualAdditions: [{ id: `addition-design-${index}`, materialId: 'material-seed-2', materialLotId: 'lot-seed-2', amount: 1, unit: 'g', concentration: 100 }] });
  return { state, experiment, revision };
}

function makeDesign(state, experiment, revision) {
  return createExperimentDesign(state, { id: 'design-1', name: 'Controlled repeatability design', researchQuestion: 'Does temperature change the recorded intensity?', hypothesis: 'The warm condition will have a higher recorded intensity.', expectedOutcome: 'Descriptive difference only.', experimentId: experiment.id, factors: [{ name: 'Temperature', unit: '°C', levels: [{ label: '20', value: 20 }, { label: '30', value: 30 }] }], conditions: [{ name: 'Baseline', revisionId: revision.id, factorLevelIds: ['20'], replicateCount: 2, controlledConditions: 'Same evaluator and application amount.' }, { name: 'Warm', revisionId: revision.id, factorLevelIds: ['30'], replicateCount: 2, controlledConditions: 'Same evaluator and application amount.' }], responses: [{ name: 'Intensity', kind: 'numeric', source: 'manual', unit: 'score' }, { name: 'Character', kind: 'subjective', source: 'manual' }] });
}

test('experiment design validates conditions, revisions, factors, and replicate counts', () => {
  const { state, experiment, revision } = designState(); const designed = makeDesign(state, experiment, revision);
  assert.equal(designed.experimentDesigns[0].runIds.length, 4); assert.equal(designed.experimentDesignConditions.length, 2);
  assert.throws(() => createExperimentDesign(state, { name: 'Bad', researchQuestion: 'x', hypothesis: 'y', experimentId: experiment.id, factors: [{ name: 'Only one', levels: [{ label: 'one' }] }], conditions: [], responses: [] }), /at least two levels/);
  assert.throws(() => createExperimentDesign(state, { name: 'Bad', researchQuestion: 'x', hypothesis: 'y', experimentId: experiment.id, factors: [{ name: 'Temp', levels: [{ label: '20' }, { label: '30' }] }], conditions: [{ name: 'Bad', revisionId: 'missing', factorLevelIds: ['20'], replicateCount: 1 }, { name: 'Other', revisionId: revision.id, factorLevelIds: ['30'], replicateCount: 0 }], responses: [{ name: 'x', kind: 'subjective', source: 'manual' }] }), /invalid experiment or formula revision/);
});

test('experiment design randomization is unbiased-testable and persists distinct planned and randomized orders', () => {
  const { state, experiment, revision } = designState(); let designed = makeDesign(state, experiment, revision); const runIds = designed.experimentDesignRuns.filter(run => run.designId === 'design-1').map(run => run.id); assert.deepEqual(new Set(shuffleExperimentRuns(runIds, () => 0)), new Set(runIds)); designed = randomizeExperimentDesignRuns(designed, 'design-1', () => 0.4); const design = designed.experimentDesigns.find(item => item.id === 'design-1'); const runs = designed.experimentDesignRuns.filter(item => item.designId === 'design-1'); assert.ok(design.randomizedAt); assert.deepEqual(new Set(runs.map(run => run.randomizedOrder)), new Set([1, 2, 3, 4])); assert.ok(runs.some(run => run.randomizedOrder !== run.plannedOrder)); assert.throws(() => randomizeExperimentDesignRuns(designed, 'design-1', () => 0.2), /already randomized/);
});

test('execution links preserve batch evidence and review summarizes only compatible responses', () => {
  const { state, experiment, revision } = designState(); let designed = makeDesign(state, experiment, revision); const runs = designed.experimentDesignRuns.filter(run => run.designId === 'design-1');
  designed = updateExperimentDesignRun(designed, runs[0].id, { status: 'completed', batchId: 'batch-design-1', startedAt: '2026-10-26T08:00:00.000Z', completedAt: '2026-10-26T08:30:00.000Z', responseValues: [{ responseId: designed.experimentDesignResponses.find(item => item.name === 'Intensity').id, value: 3, unit: 'score' }] });
  designed = updateExperimentDesignRun(designed, runs[1].id, { status: 'completed', batchId: 'batch-design-2', startedAt: '2026-10-26T09:00:00.000Z', completedAt: '2026-10-26T09:30:00.000Z', responseValues: [{ responseId: designed.experimentDesignResponses.find(item => item.name === 'Intensity').id, value: 4, unit: 'score' }] });
  const review = experimentDesignReview(designed, 'design-1'); assert.equal(review.conditions[0].completedReplicates, 2); assert.equal(review.conditions[0].responses[0].summary.mean, 3.5); assert.equal(review.conditions[1].completedReplicates, 0); assert.equal(review.canCompare, false); assert.ok(review.warnings.some(item => item.includes('insufficient')));
  assert.throws(() => updateExperimentDesignRun(designed, runs[2].id, { status: 'completed', batchId: 'batch-design-1' }), /linked to more than one planned run/);
  const restored = parseBackup(serializeBackup(designed)).state; assert.equal(restored.experimentDesignRuns.length, 4); assert.equal(mergeBackup(designed, restored).imported, 0);
  const legacy = createInitialState(); legacy.version = 1; delete legacy.experimentDesigns; delete legacy.experimentDesignRuns; assert.deepEqual(parseBackup(JSON.stringify({ format: 'atelier-scent-lab-backup', backupVersion: 1, schemaVersion: 1, state: legacy })).state.experimentDesigns, []);
});
